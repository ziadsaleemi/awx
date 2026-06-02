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

import hashlib
import json
import logging
import re
from urllib.parse import quote

import requests
from django.conf import settings
from django.utils.translation import gettext_lazy as _
from rest_framework.exceptions import PermissionDenied
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from awx.api.permissions import IsSystemAdmin as IsSuperUser
from awx.main import models
from awx.main.models import ActivityStream
from awx.main.tasks.policy import OPA_AUTH_TYPES, opa_cert_file

logger = logging.getLogger('awx.api.opa')

OPA_POLICY_ID_PATTERN = re.compile(r'^(?!.*\.\.)[A-Za-z0-9_.@/-]+$')

DEFAULT_POLICIES = [
    {
        'id': 'job_launch',
        'path': 'awx/job_launch/allow',
        'description': 'Controls which job templates may be launched by which users',
        'input_example': {
            'action': 'launch',
            'source': 'api',
            'user': {'id': 1, 'username': 'admin', 'is_superuser': True},
            'template': {'id': 1, 'name': 'Deploy App', 'type': 'jobtemplate', 'organization': 1, 'playbook': 'site.yml'},
            'inventory': {'id': 1, 'name': 'Production', 'organization': 1},
            'credentials': [{'id': 1, 'name': 'Machine', 'credential_type': 'Machine', 'credential_type_id': 1}],
            'launch': {'extra_var_keys': ['env'], 'limit': '', 'verbosity': 0, 'job_type': 'run'},
            'metadata': {},
        },
    },
    {
        'id': 'inventory_access',
        'path': 'awx/inventory_access/allow',
        'description': 'Controls inventory read and update access',
        'input_example': {
            'action': 'read',
            'source': 'api',
            'user': {'id': 1, 'username': 'admin', 'is_superuser': True},
            'inventory': {'id': 1, 'name': 'Production', 'organization': 1},
        },
    },
    {
        'id': 'credential_use',
        'path': 'awx/credential_use/allow',
        'description': 'Controls which credentials may be attached to job templates',
        'input_example': {
            'action': 'attach',
            'source': 'api',
            'user': {'id': 1, 'username': 'admin', 'is_superuser': True},
            'credential': {'id': 1, 'credential_type': 'Machine'},
            'target': {'resource_type': 'job_template', 'id': 1},
        },
    },
    {
        'id': 'ai_action',
        'path': 'awx/ai_action/allow',
        'description': 'Controls which AI-triggered actions are permitted',
        'input_example': {
            'triggered_by': 'ai_resource_action',
            'source': 'workflow_ai_task',
            'mode': 'apply',
            'human_approved': True,
            'approval_required': True,
            'approval': {'workflow_job_node': 1, 'workflow_job': 1, 'workflow_job_template': 1, 'approved_by': 1},
            'user': {'id': 1, 'username': 'admin', 'is_superuser': True},
            'operation': 'update',
            'resource_type': 'inventory',
            'object_id': 1,
            'destructive': True,
            'privileged': False,
            'data': {'name': 'Production'},
        },
    },
    {
        'id': 'gatekeeper_resource',
        'path': 'awx/gatekeeper_resource/allow',
        'description': 'Controls dry-run and apply actions for Gatekeeper ConstraintTemplates, Constraints, and Configs',
        'input_example': {
            'triggered_by': 'gatekeeper_policy_manager',
            'source': 'gatekeeper_apply',
            'mode': 'apply',
            'human_approved': True,
            'approval_required': True,
            'user': {'id': 1, 'username': 'admin', 'is_superuser': True},
            'operation': 'update',
            'resource_type': 'gatekeeper_resource',
            'destructive': True,
            'privileged': True,
            'target': {
                'api_version': 'templates.gatekeeper.sh/v1',
                'kind': 'ConstraintTemplate',
                'name': 'k8srequiredlabels',
                'resource': 'constrainttemplates',
                'object_path': '/apis/templates.gatekeeper.sh/v1/constrainttemplates/k8srequiredlabels',
            },
        },
    },
]


class OPAPolicyEngine:
    """Thin client for the OPA REST API."""

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

    def _headers(self, content_type='application/json') -> dict:
        headers = {'Content-Type': content_type}
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

    def put_policy(self, policy_id: str, policy_text: str) -> dict:
        """
        PUT Rego module text to /v1/policies/<policy_id>.

        This uses OPA's real Policy API; AWX only stores/syncs the admin-managed
        Rego source and does not evaluate policy locally.
        """
        self.validate_configuration()
        if not self.is_available():
            raise ValueError(_('OPA is not enabled or configured.'))

        quoted_policy_id = quote(policy_id.strip('/'), safe='/')
        url = f'{self.base_url}/v1/policies/{quoted_policy_id}'
        with opa_cert_file() as cert_files:
            cert, verify = cert_files
            resp = requests.put(
                url,
                data=policy_text,
                timeout=self.timeout,
                headers=self._headers(content_type='text/plain'),
                cert=cert,
                verify=verify,
            )
        resp.raise_for_status()
        if getattr(resp, 'content', b''):
            try:
                return resp.json()
            except ValueError:
                return {'status_code': resp.status_code}
        return {'status_code': resp.status_code}

    def list_policies(self) -> list:
        """
        GET /v1/policies and return OPA policy modules.
        """
        self.validate_configuration()
        if not self.is_available():
            raise ValueError(_('OPA is not enabled or configured.'))

        url = f'{self.base_url}/v1/policies'
        with opa_cert_file() as cert_files:
            cert, verify = cert_files
            resp = requests.get(
                url,
                timeout=self.timeout,
                headers=self._headers(),
                cert=cert,
                verify=verify,
            )
        resp.raise_for_status()
        data = resp.json()
        return data.get('result') or []

    def get_policy(self, policy_id: str) -> dict:
        """
        GET /v1/policies/<policy_id> and return one OPA policy module.
        """
        self.validate_configuration()
        if not self.is_available():
            raise ValueError(_('OPA is not enabled or configured.'))

        quoted_policy_id = quote(policy_id.strip('/'), safe='/')
        url = f'{self.base_url}/v1/policies/{quoted_policy_id}'
        with opa_cert_file() as cert_files:
            cert, verify = cert_files
            resp = requests.get(
                url,
                timeout=self.timeout,
                headers=self._headers(),
                cert=cert,
                verify=verify,
            )
        resp.raise_for_status()
        data = resp.json()
        return data.get('result') or {}

    def delete_policy(self, policy_id: str) -> dict:
        """
        DELETE Rego module from /v1/policies/<policy_id>.
        """
        self.validate_configuration()
        if not self.is_available():
            raise ValueError(_('OPA is not enabled or configured.'))

        quoted_policy_id = quote(policy_id.strip('/'), safe='/')
        url = f'{self.base_url}/v1/policies/{quoted_policy_id}'
        with opa_cert_file() as cert_files:
            cert, verify = cert_files
            resp = requests.delete(
                url,
                timeout=self.timeout,
                headers=self._headers(),
                cert=cert,
                verify=verify,
            )
        resp.raise_for_status()
        if getattr(resp, 'content', b''):
            try:
                return resp.json()
            except ValueError:
                return {'status_code': resp.status_code}
        return {'status_code': resp.status_code}


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
    if 'result' not in opa_response:
        return False

    result = opa_response['result']
    if isinstance(result, dict):
        has_clear_denial_key = False

        for deny_key in ('deny', 'denied'):
            if deny_key in result:
                has_clear_denial_key = True
                if _opa_decision_has_entries(result[deny_key]):
                    return False

        for violation_key in ('violations', 'violation', 'errors'):
            if violation_key in result:
                has_clear_denial_key = True
                if _opa_decision_has_entries(result[violation_key]):
                    return False

        for allow_key in ('allow', 'allowed', 'authorized', 'permitted'):
            if allow_key in result:
                return bool(result[allow_key])

        if has_clear_denial_key:
            return True

        return False
    return bool(result)


def _opa_decision_has_entries(value) -> bool:
    if isinstance(value, (list, tuple, set, dict)):
        return len(value) > 0
    return bool(value)


def _validate_policy_id(policy_id):
    if not isinstance(policy_id, str) or not policy_id.strip():
        return None, _('policy_id must be a non-empty string.')
    policy_id = policy_id.strip().strip('/')
    if not OPA_POLICY_ID_PATTERN.match(policy_id):
        return None, _('policy_id contains invalid characters.')
    return policy_id, None


def _rego_package_from_raw(raw):
    match = re.search(r'(?m)^\s*package\s+([A-Za-z0-9_.]+)\s*$', raw or '')
    return match.group(1) if match else ''


def _rego_rules_from_raw(raw):
    rules = []
    for match in re.finditer(r'(?m)^\s*(?:default\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[|\{|:=|=|\bif\b)', raw or ''):
        name = match.group(1)
        if name in {'package', 'import', 'else'} or name in rules:
            continue
        rules.append(name)
    return rules


def _rego_package_from_ast(ast):
    package_path = ((ast or {}).get('package') or {}).get('path') or []
    parts = []
    for item in package_path:
        value = item.get('value') if isinstance(item, dict) else None
        if value == 'data' and not parts:
            continue
        if value:
            parts.append(str(value))
    return '.'.join(parts)


def _rego_rules_from_ast(ast):
    rules = []
    for rule in (ast or {}).get('rules') or []:
        head = rule.get('head') if isinstance(rule, dict) else {}
        name = head.get('name') if isinstance(head, dict) else None
        if not name and isinstance(head, dict):
            ref = head.get('ref') or []
            if isinstance(ref, list) and ref:
                last = ref[-1]
                if isinstance(last, dict):
                    name = last.get('value')
        if name and name not in rules:
            rules.append(str(name))
    return rules


def _opa_policy_module_summary(module, include_raw=False):
    raw = module.get('raw') or ''
    ast = module.get('ast') if isinstance(module.get('ast'), dict) else {}
    package = _rego_package_from_ast(ast) or _rego_package_from_raw(raw)
    rules = _rego_rules_from_ast(ast) or _rego_rules_from_raw(raw)
    decision_prefix = package.replace('.', '/') if package else ''
    summary = {
        'id': module.get('id') or '',
        'package': package,
        'rules': rules,
        'decision_paths': [f'{decision_prefix}/{rule}' for rule in rules] if decision_prefix else [],
        'size': len(raw),
        'line_count': raw.count('\n') + 1 if raw else 0,
        'sha256': hashlib.sha256(raw.encode()).hexdigest() if raw else '',
        'awx_managed': str(module.get('id') or '').startswith('awx/'),
    }
    if include_raw:
        summary['raw'] = raw
        summary['ast'] = ast
    return summary


def _opa_http_error_payload(exc):
    response = getattr(exc, 'response', None)
    if response is None:
        return {'detail': _('OPA policy module operation failed.'), 'opa_error': str(exc)}, status.HTTP_502_BAD_GATEWAY

    try:
        opa_error = response.json()
    except ValueError:
        opa_error = getattr(response, 'text', '') or str(exc)
    if response.status_code == 404:
        status_code = status.HTTP_404_NOT_FOUND
    elif response.status_code == 400:
        status_code = status.HTTP_400_BAD_REQUEST
    else:
        status_code = status.HTTP_502_BAD_GATEWAY
    return {
        'detail': _('OPA policy module operation failed.'),
        'status_code': response.status_code,
        'opa_error': opa_error,
    }, status_code


def _get_policy_or_none(engine, policy_id):
    try:
        return engine.get_policy(policy_id)
    except requests.HTTPError as exc:
        response = getattr(exc, 'response', None)
        if response is not None and response.status_code == 404:
            return None
        raise


def _audit_opa_policy_module(request, operation, policy_id, before=None, after=None, error=''):
    changes = {
        'triggered_by': 'opa_policy_module_manager',
        'source': 'opa_policy_modules',
        'policy_id': policy_id,
        'is_error': bool(error),
        'before': _opa_policy_module_summary(before) if before else None,
        'after': _opa_policy_module_summary(after) if after else None,
    }
    if error:
        changes['error'] = str(error)
    entry = ActivityStream.objects.create(
        operation=operation,
        object1='opa_policy_module',
        object2=policy_id,
        changes=json.dumps(changes),
        actor=request.user,
    )
    entry.user.add(request.user)
    return {
        'activity_stream_id': entry.pk,
        'activity_stream_url': f'/api/v2/activity_stream/{entry.pk}/',
    }


def _save_opa_policy_module(request, policy_id, policy_text):
    if not isinstance(policy_text, str) or not policy_text.strip():
        return Response({'detail': _('policy_text must be non-empty Rego text.')}, status=status.HTTP_400_BAD_REQUEST)

    engine = OPAPolicyEngine()
    if not engine.is_available():
        return Response({'detail': _('OPA is not enabled or configured.')}, status=status.HTTP_400_BAD_REQUEST)

    before = None
    try:
        before = _get_policy_or_none(engine, policy_id)
        opa_response = engine.put_policy(policy_id, policy_text)
    except ValueError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    except requests.RequestException as exc:
        _audit_opa_policy_module(request, 'update', policy_id, before=before, error=exc)
        payload, status_code = _opa_http_error_payload(exc)
        return Response(payload, status=status_code)

    after = {'id': policy_id, 'raw': policy_text, 'ast': {}}
    audit = _audit_opa_policy_module(
        request,
        'update' if before else 'create',
        policy_id,
        before=before,
        after=after,
    )
    previous_sha256 = _opa_policy_module_summary(before)['sha256'] if before else ''
    summary = _opa_policy_module_summary(after, include_raw=True)
    return Response(
        {
            'changed': True,
            'created': before is None,
            'module': summary,
            'previous_sha256': previous_sha256,
            'opa_response': opa_response,
            'audit': audit,
        }
    )


def _safe_opa_id(value):
    return getattr(value, 'pk', value)


def _extra_var_keys(raw_extra_vars):
    if isinstance(raw_extra_vars, dict):
        return sorted(str(key) for key in raw_extra_vars.keys())
    if isinstance(raw_extra_vars, str) and raw_extra_vars.strip().startswith('{'):
        try:
            parsed = json.loads(raw_extra_vars)
        except ValueError:
            return []
        if isinstance(parsed, dict):
            return sorted(str(key) for key in parsed.keys())
    return []


def _inventory_summary(inventory):
    if inventory is None:
        return None
    return {
        'id': inventory.pk,
        'name': inventory.name,
        'organization': _safe_opa_id(getattr(inventory, 'organization_id', None)),
    }


def _template_summary(template):
    return {
        'id': template.pk,
        'name': getattr(template, 'name', ''),
        'type': template._meta.model_name,
        'organization': _safe_opa_id(getattr(template, 'organization_id', None)),
        'playbook': getattr(template, 'playbook', ''),
        'job_type': getattr(template, 'job_type', ''),
        'terraform_operation': getattr(template, 'terraform_operation', ''),
    }


def build_opa_launch_input(request, template, launch_kwargs=None, source='api', action='launch', metadata=None):
    """
    Build a secret-safe OPA input for any AWX launch surface.

    OPA gets stable context: user, template, inventory, credential ids/types,
    launch intent, and extra-var keys. Launch values are intentionally omitted.
    """
    launch_kwargs = launch_kwargs or {}
    inventory = launch_kwargs.get('inventory') or launch_kwargs.get('target_inventory') or getattr(template, 'inventory', None)
    inventory_id = launch_kwargs.get('inventory_id') or launch_kwargs.get('target_inventory_id')
    if inventory is None and inventory_id:
        inventory = models.Inventory.objects.filter(pk=inventory_id).first()
    credentials = []
    if hasattr(template, 'credentials'):
        credentials = [
            {
                'id': credential.pk,
                'name': credential.name,
                'credential_type': getattr(credential.credential_type, 'name', ''),
                'credential_type_id': credential.credential_type_id,
            }
            for credential in template.credentials.all()
        ]

    return {
        'action': action,
        'source': source,
        'user': {
            'id': request.user.pk,
            'username': request.user.username,
            'is_superuser': request.user.is_superuser,
        },
        'template': _template_summary(template),
        'inventory': _inventory_summary(inventory),
        'credentials': credentials,
        'launch': {
            'extra_var_keys': _extra_var_keys(launch_kwargs.get('extra_vars')),
            'limit': launch_kwargs.get('limit', ''),
            'verbosity': launch_kwargs.get('verbosity', ''),
            'job_type': launch_kwargs.get('job_type', ''),
            'terraform_operation': launch_kwargs.get('terraform_operation', ''),
            'inventory': _safe_opa_id(launch_kwargs.get('inventory_id') or launch_kwargs.get('target_inventory_id')),
        },
        'metadata': metadata or {},
    }


def enforce_opa_launch_policy(request, template, launch_kwargs=None, source='api', action='launch', metadata=None):
    input_data = build_opa_launch_input(
        request,
        template,
        launch_kwargs=launch_kwargs,
        source=source,
        action=action,
        metadata=metadata,
    )
    if not check_opa_policy('awx/job_launch/allow', input_data):
        raise PermissionDenied(_('This launch was denied by an OPA policy guardrail.'))
    return input_data


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
        policy_bundle = getattr(settings, 'OPA_POLICY_BUNDLE', '') or ''
        policy_bundle_configured = bool(policy_bundle.strip())
        return Response(
            {
                'enabled': engine.is_available(),
                'server_url': engine.base_url,
                'policies': DEFAULT_POLICIES,
                'policy_bundle': {
                    'configured': policy_bundle_configured,
                    'size': len(policy_bundle),
                    'line_count': policy_bundle.count('\n') + 1 if policy_bundle_configured else 0,
                    'sha256': hashlib.sha256(policy_bundle.encode()).hexdigest() if policy_bundle_configured else '',
                    'sync_endpoint': '/api/v2/opa/policies/sync/',
                },
            }
        )


class OPAPolicyModuleListView(APIView):
    """
    GET /api/v2/opa/policy-modules/
    POST /api/v2/opa/policy-modules/

    Manage live OPA policy modules through OPA's Policy API.
    """

    permission_classes = [IsSuperUser]

    def get(self, request, *args, **kwargs):
        engine = OPAPolicyEngine()
        if not engine.is_available():
            return Response({'enabled': False, 'server_url': '', 'count': 0, 'modules': []})

        try:
            modules = engine.list_policies()
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except requests.RequestException as exc:
            payload, status_code = _opa_http_error_payload(exc)
            return Response(payload, status=status_code)

        summaries = sorted(
            [_opa_policy_module_summary(module) for module in modules if isinstance(module, dict)],
            key=lambda module: module['id'],
        )
        return Response(
            {
                'enabled': True,
                'server_url': engine.base_url,
                'count': len(summaries),
                'modules': summaries,
            }
        )

    def post(self, request, *args, **kwargs):
        policy_id, error = _validate_policy_id(request.data.get('policy_id'))
        if error:
            return Response({'detail': error}, status=status.HTTP_400_BAD_REQUEST)

        return _save_opa_policy_module(request, policy_id, request.data.get('policy_text'))


class OPAPolicyModuleDetailView(APIView):
    """
    GET /api/v2/opa/policy-modules/<policy_id>/
    PUT /api/v2/opa/policy-modules/<policy_id>/
    DELETE /api/v2/opa/policy-modules/<policy_id>/
    """

    permission_classes = [IsSuperUser]

    def get(self, request, policy_id=None, *args, **kwargs):
        policy_id, error = _validate_policy_id(policy_id)
        if error:
            return Response({'detail': error}, status=status.HTTP_400_BAD_REQUEST)

        engine = OPAPolicyEngine()
        if not engine.is_available():
            return Response({'detail': _('OPA is not enabled or configured.')}, status=status.HTTP_400_BAD_REQUEST)

        try:
            module = engine.get_policy(policy_id)
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except requests.RequestException as exc:
            payload, status_code = _opa_http_error_payload(exc)
            return Response(payload, status=status_code)

        return Response(_opa_policy_module_summary(module, include_raw=True))

    def put(self, request, policy_id=None, *args, **kwargs):
        policy_id, error = _validate_policy_id(policy_id)
        if error:
            return Response({'detail': error}, status=status.HTTP_400_BAD_REQUEST)
        return _save_opa_policy_module(request, policy_id, request.data.get('policy_text'))

    def delete(self, request, policy_id=None, *args, **kwargs):
        policy_id, error = _validate_policy_id(policy_id)
        if error:
            return Response({'detail': error}, status=status.HTTP_400_BAD_REQUEST)

        engine = OPAPolicyEngine()
        if not engine.is_available():
            return Response({'detail': _('OPA is not enabled or configured.')}, status=status.HTTP_400_BAD_REQUEST)

        before = None
        try:
            before = _get_policy_or_none(engine, policy_id)
            opa_response = engine.delete_policy(policy_id)
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except requests.RequestException as exc:
            _audit_opa_policy_module(request, 'delete', policy_id, before=before, error=exc)
            payload, status_code = _opa_http_error_payload(exc)
            return Response(payload, status=status_code)

        audit = _audit_opa_policy_module(request, 'delete', policy_id, before=before)
        return Response(
            {
                'changed': True,
                'policy_id': policy_id,
                'previous': _opa_policy_module_summary(before) if before else None,
                'opa_response': opa_response,
                'audit': audit,
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


class OPAPolicySyncView(APIView):
    """
    POST /api/v2/opa/policies/sync/

    Sync the configured AWX-managed Rego source to the configured OPA server
    through OPA's Policy API.
    """

    permission_classes = [IsSuperUser]

    def post(self, request, *args, **kwargs):
        policy_id = request.data.get('policy_id', 'awx/managed')
        policy_bundle = getattr(settings, 'OPA_POLICY_BUNDLE', '') or ''

        if not isinstance(policy_id, str) or not policy_id.strip():
            return Response({'detail': _('policy_id must be a non-empty string.')}, status=status.HTTP_400_BAD_REQUEST)

        policy_id = policy_id.strip().strip('/')
        if not re.match(r'^[a-zA-Z0-9_/-]+$', policy_id):
            return Response({'detail': _('policy_id contains invalid characters.')}, status=status.HTTP_400_BAD_REQUEST)

        if not policy_bundle.strip():
            return Response({'detail': _('OPA_POLICY_BUNDLE is empty. Save Rego policy text before syncing.')}, status=status.HTTP_400_BAD_REQUEST)

        engine = OPAPolicyEngine()
        if not engine.is_available():
            return Response({'detail': _('OPA is not enabled or configured.')}, status=status.HTTP_400_BAD_REQUEST)

        try:
            result = engine.put_policy(policy_id, policy_bundle)
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except requests.RequestException as exc:
            logger.error('OPA policy bundle sync failed: %s', exc)
            return Response({'detail': _('OPA policy sync failed. Check OPA settings and server connectivity.')}, status=status.HTTP_502_BAD_GATEWAY)

        return Response(
            {
                'changed': True,
                'policy_id': policy_id,
                'size': len(policy_bundle),
                'line_count': policy_bundle.count('\n') + 1,
                'sha256': hashlib.sha256(policy_bundle.encode()).hexdigest(),
                'opa_response': result,
            }
        )
