"""
G6a — OPA (Open Policy Agent) Guardrails Integration for AWX.

Provides:
  - `OPAPolicyEngine` — thin client that evaluates policies against OPA server
  - `check_opa_policy(input_data, policy_path)` — utility used by views/tasks
  - `OPAPolicyView` — REST endpoint to evaluate a policy check interactively
  - `OPAPolicyListView` — list configured policy bundles/paths

Configuration (in AWX settings):
  OPA_HOST            — OPA server hostname; empty disables policy checks
  OPA_PORT            — OPA server port, e.g. 8181
  OPA_SSL             — whether to use https
  OPA_REQUEST_TIMEOUT — request timeout in seconds

OPA input schema for job launch checks:
  {
    "user": {"username": ..., "is_superuser": ...},
    "template": {"id": ..., "name": ..., "playbook": ..., "extra_vars": ...},
    "inventory": {"id": ..., "name": ...},
    "credentials": [{"id": ..., "name": ..., "credential_type": ...}]
  }
"""

import logging
import re

import requests
from django.conf import settings
from django.utils.translation import gettext_lazy as _
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from awx.api.permissions import IsSystemAdmin as IsSuperUser
from awx.main.tasks.policy import OPA_AUTH_TYPES, opa_cert_file

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
        self.host = getattr(settings, 'OPA_HOST', '')
        self.port = getattr(settings, 'OPA_PORT', 8181)
        self.ssl = bool(getattr(settings, 'OPA_SSL', False))
        self.timeout = getattr(settings, 'OPA_REQUEST_TIMEOUT', 1.5)
        self.base_url = self._build_base_url()

    def is_available(self) -> bool:
        return bool(self.host)

    def _build_base_url(self) -> str:
        if not self.host:
            return ''
        protocol = 'https' if self.ssl else 'http'
        return f'{protocol}://{self.host}:{self.port}'

    def _headers(self) -> dict:
        headers = {'Content-Type': 'application/json'}
        headers.update(getattr(settings, 'OPA_AUTH_CUSTOM_HEADERS', {}) or {})
        if getattr(settings, 'OPA_AUTH_TYPE', OPA_AUTH_TYPES.NONE) == OPA_AUTH_TYPES.TOKEN:
            headers['Authorization'] = f"Bearer {getattr(settings, 'OPA_AUTH_TOKEN', '')}"
        return headers

    def validate_configuration(self):
        auth_type = getattr(settings, 'OPA_AUTH_TYPE', OPA_AUTH_TYPES.NONE)
        if auth_type == OPA_AUTH_TYPES.CERTIFICATE and not self.ssl:
            raise ValueError(_('OPA_AUTH_TYPE=Certificate requires OPA_SSL to be enabled.'))

        if auth_type == OPA_AUTH_TYPES.CERTIFICATE:
            missing = [key for key in ('OPA_AUTH_CLIENT_CERT', 'OPA_AUTH_CLIENT_KEY', 'OPA_AUTH_CA_CERT') if not getattr(settings, key, '')]
            if missing:
                raise ValueError(_('Following certificate settings are missing for OPA_AUTH_TYPE=Certificate: {}').format(missing))

    def evaluate(self, policy_path: str, input_data: dict) -> dict:
        """
        POST input_data to /v1/data/<policy_path> and return the OPA result dict.
        Returns {'result': True} if OPA is disabled (fail-open).
        Raises requests.RequestException on connection errors.
        """
        if not self.is_available():
            return {'result': True}

        self.validate_configuration()
        url = f'{self.base_url}/v1/data/{policy_path}'
        try:
            with opa_cert_file() as cert_files:
                cert, verify = cert_files
                resp = requests.post(
                    url,
                    json={'input': input_data},
                    timeout=self.timeout,
                    headers=self._headers(),
                    cert=cert,
                    verify=verify,
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
    try:
        result = engine.evaluate(policy_path, input_data)
    except Exception as exc:
        logger.error('OPA policy check failed (%s): %s — defaulting to allow', policy_path, exc)
        return True
    return opa_response_allows(result)


def opa_response_allows(opa_response: dict) -> bool:
    result = opa_response.get('result', True)
    if isinstance(result, dict) and 'allowed' in result:
        return bool(result['allowed'])
    return bool(result)


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
        return Response(
            {
                'enabled': engine.is_available(),
                'server_url': engine.base_url,
                'policies': DEFAULT_POLICIES,
            }
        )


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

    permission_classes = [IsSuperUser]

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

        # Restrict path to prevent SSRF — only allow alphanumeric + slash + underscore.
        if not re.match(r'^[a-zA-Z0-9_/]+$', policy_path):
            return Response(
                {'detail': _('policy_path contains invalid characters.')},
                status=status.HTTP_400_BAD_REQUEST,
            )

        engine = OPAPolicyEngine()
        if not engine.is_available():
            return Response(
                {
                    'result': None,
                    'allowed': True,
                    'opa_response': None,
                    'detail': 'OPA is not enabled or configured.',
                }
            )

        try:
            engine.validate_configuration()
            opa_resp = engine.evaluate(policy_path, input_data)
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as exc:
            return Response(
                {'detail': f'OPA evaluation error: {exc}'},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        allowed = opa_response_allows(opa_resp)
        return Response(
            {
                'result': opa_resp.get('result'),
                'allowed': allowed,
                'opa_response': opa_resp,
            }
        )
