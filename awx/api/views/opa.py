"""
G6a — OPA (Open Policy Agent) Guardrails Integration for AWX.

Provides:
  - `OPAPolicyEngine` — thin client that evaluates policies against OPA server
  - `check_opa_policy(input_data, policy_path)` — utility used by views/tasks
  - `OPAPolicyView` — REST endpoint to evaluate a policy check interactively
  - `OPAPolicyListView` — list configured policy bundles/paths

Configuration (in AWX settings):
  OPA_SERVER_URL     — base URL of the OPA server, e.g. http://opa:8181
  OPA_ENABLED        — bool, whether to enforce OPA checks (default False)
  OPA_TIMEOUT        — request timeout in seconds (default 5)

OPA input schema for job launch checks:
  {
    "user": {"username": ..., "is_superuser": ...},
    "template": {"id": ..., "name": ..., "playbook": ..., "extra_vars": ...},
    "inventory": {"id": ..., "name": ...},
    "credentials": [{"id": ..., "name": ..., "credential_type": ...}]
  }
"""

import logging

import requests
from django.conf import settings
from django.utils.translation import gettext_lazy as _
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from rest_framework.permissions import IsAuthenticated
from awx.api.permissions import IsSystemAdmin as IsSuperUser

logger = logging.getLogger('awx.api.opa')

DEFAULT_POLICIES = [
    {
        'id': 'job_launch',
        'path': 'awx/job_launch/allow',
        'description': 'Controls which job templates may be launched by which users',
    },
    {
        'id': 'inventory_access',
        'path': 'awx/inventory_access/allow',
        'description': 'Controls inventory read and update access',
    },
    {
        'id': 'credential_use',
        'path': 'awx/credential_use/allow',
        'description': 'Controls which credentials may be attached to job templates',
    },
    {
        'id': 'ai_action',
        'path': 'awx/ai_action/allow',
        'description': 'Controls which AI-triggered actions are permitted',
    },
]


class OPAPolicyEngine:
    """Thin client for the OPA REST API (v1 data API)."""

    def __init__(self):
        self.base_url = getattr(settings, 'OPA_SERVER_URL', '').rstrip('/')
        self.timeout = int(getattr(settings, 'OPA_TIMEOUT', 5))
        self.enabled = bool(getattr(settings, 'OPA_ENABLED', False))

    def is_available(self) -> bool:
        return self.enabled and bool(self.base_url)

    def evaluate(self, policy_path: str, input_data: dict) -> dict:
        """
        POST input_data to /v1/data/<policy_path> and return the OPA result dict.
        Returns {'result': True} if OPA is disabled (fail-open).
        Raises requests.RequestException on connection errors.
        """
        if not self.is_available():
            return {'result': True}

        url = f'{self.base_url}/v1/data/{policy_path}'
        try:
            resp = requests.post(
                url,
                json={'input': input_data},
                timeout=self.timeout,
                headers={'Content-Type': 'application/json'},
            )
            resp.raise_for_status()
            return resp.json()
        except requests.Timeout:
            logger.warning('OPA policy check timed out for path %s — defaulting to allow', policy_path)
            return {'result': True}
        except requests.RequestException as exc:
            logger.error('OPA server unreachable (%s): %s — defaulting to allow', policy_path, exc)
            return {'result': True}


def check_opa_policy(policy_path: str, input_data: dict) -> bool:
    """
    Evaluate an OPA policy.  Returns True if the action is allowed.
    Fails open (returns True) if OPA is not configured or unreachable.
    """
    engine = OPAPolicyEngine()
    result = engine.evaluate(policy_path, input_data)
    # OPA returns {"result": <value>}; treat truthy as allow
    return bool(result.get('result', True))


# ---------------------------------------------------------------------------
# Views
# ---------------------------------------------------------------------------

class OPAPolicyListView(APIView):
    """
    GET /api/v2/opa/policies/

    List configured OPA policy paths.
    """
    permission_classes = [IsSuperUser]

    def get(self, request, *args, **kwargs):
        engine = OPAPolicyEngine()
        return Response({
            'enabled': engine.is_available(),
            'server_url': getattr(settings, 'OPA_SERVER_URL', ''),
            'policies': DEFAULT_POLICIES,
        })


class OPAPolicyEvaluateView(APIView):
    """
    POST /api/v2/opa/evaluate/

    Interactively evaluate an OPA policy check.

    Body:
        {
            "policy_path": "awx/job_launch/allow",
            "input": { ... }
        }

    Returns:
        {
            "result": true/false,
            "allowed": true/false,
            "opa_response": { ... }
        }
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, *args, **kwargs):
        policy_path = request.data.get('policy_path')
        input_data = request.data.get('input', {})

        if not policy_path or not isinstance(policy_path, str):
            return Response(
                {'detail': _('policy_path is required and must be a string.')},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not isinstance(input_data, dict):
            return Response(
                {'detail': _('"input" must be a JSON object.')},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Restrict path to prevent SSRF — only allow alphanumeric + slash + underscore
        import re
        if not re.match(r'^[a-zA-Z0-9_/]+$', policy_path):
            return Response(
                {'detail': _('policy_path contains invalid characters.')},
                status=status.HTTP_400_BAD_REQUEST,
            )

        engine = OPAPolicyEngine()
        if not engine.is_available():
            return Response({
                'result': None,
                'allowed': True,
                'opa_response': None,
                'detail': 'OPA is not enabled or configured.',
            })

        try:
            opa_resp = engine.evaluate(policy_path, input_data)
        except Exception as exc:
            return Response(
                {'detail': f'OPA evaluation error: {exc}'},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        allowed = bool(opa_resp.get('result', True))
        return Response({
            'result': opa_resp.get('result'),
            'allowed': allowed,
            'opa_response': opa_resp,
        })
