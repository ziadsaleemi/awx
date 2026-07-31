"""
G6a — OPA (Open Policy Agent) Guardrails Integration for Capstan.

Provides:
  - `OPAPolicyEngine` — thin client that evaluates policies against OPA server
  - `check_opa_policy(input_data, policy_path)` — utility used by views/tasks
  - `OPAPolicyView` — REST endpoint to evaluate a policy check interactively
  - `OPAPolicyListView` — list configured policy bundles/paths

Configuration (in Capstan settings):
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
from pathlib import Path, PurePosixPath
from urllib.parse import quote

import requests
from django.conf import settings
from django.utils.translation import gettext_lazy as _
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from awx.api.views.policy_permissions import PolicyAsCodeAuthorPermission, PolicyAsCodeOperatePermission, PolicyAsCodeViewPermission
from awx.main import models
from awx.main.models import ActivityStream, Project
from awx.main.tasks.policy import OPA_AUTH_TYPES, opa_cert_file

logger = logging.getLogger('awx.api.opa')

OPA_POLICY_ID_PATTERN = re.compile(r'^(?!.*\.\.)[A-Za-z0-9_.@/-]+$')
OPA_PROJECT_SYNC_MODES = ('preview', 'dry_run', 'apply')
OPA_PROJECT_SYNC_DEFAULT_PATTERNS = ('opa/**/*.rego', 'policies/**/*.rego', 'policy/**/*.rego', 'rego/**/*.rego', '*.rego')
OPA_PROJECT_SYNC_ALLOWED_SUFFIXES = ('.rego',)
OPA_PROJECT_SYNC_MAX_FILES = 100
OPA_PROJECT_SYNC_MAX_FILE_BYTES = 512 * 1024

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
        'description': 'Controls dry-run, apply, delete, rollback, and AI remediation actions for Gatekeeper-managed Kubernetes resources',
        'input_example': {
            'triggered_by': 'gatekeeper_policy_manager',
            'source': 'gatekeeper_remediation',
            'mode': 'apply',
            'human_approved': True,
            'approval_required': True,
            'user': {'id': 1, 'username': 'admin', 'is_superuser': True},
            'operation': 'update',
            'resource_type': 'gatekeeper_resource',
            'destructive': True,
            'privileged': True,
            'target': {
                'api_version': 'v1',
                'kind': 'Namespace',
                'name': 'default',
                'resource': 'namespaces',
                'object_path': '/api/v1/namespaces/default',
            },
            'patch': {'metadata': {'labels': {'owner': 'awx-remediated'}}},
        },
    },
]


def opa_module_enabled():
    return bool(getattr(settings, 'MODULE_OPA_ENABLED', True))


class OPAModuleAPIView(APIView):
    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if not opa_module_enabled():
            raise PermissionDenied(_('Open Policy Agent module is disabled.'))


class OPAPolicyEngine:
    """Thin client for the OPA REST API."""

    def __init__(self):
        self.module_enabled = opa_module_enabled()
        self.host = getattr(settings, 'OPA_HOST', '') if self.module_enabled else ''
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

    def _get(self, path: str, content_type='application/json'):
        self.validate_configuration()
        url = f'{self.base_url}{path}'
        with opa_cert_file() as cert_files:
            cert, verify = cert_files
            resp = requests.get(
                url,
                timeout=self.timeout,
                headers=self._headers(content_type=content_type),
                cert=cert,
                verify=verify,
            )
        resp.raise_for_status()
        return resp

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

        This uses OPA's real Policy API; Capstan only stores/syncs the admin-managed
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

    def version(self) -> dict:
        """
        Return OPA build metadata.

        OPA deployments do not all expose the same version endpoint. Newer
        server builds commonly return build data at `/version`, while the
        runtime used by our dev deployment exposes the version in `/v1/config`
        labels and on the root HTML page.
        """
        self.validate_configuration()
        if not self.is_available():
            raise ValueError(_('OPA is not enabled or configured.'))

        errors = []

        try:
            resp = self._get('/version')
            if getattr(resp, 'content', b''):
                payload = resp.json()
                return payload if isinstance(payload, dict) else {'version': str(payload)}
            return {}
        except (ValueError, requests.RequestException) as exc:
            errors.append(str(exc))

        try:
            resp = self._get('/v1/config')
            payload = resp.json() if getattr(resp, 'content', b'') else {}
            result = payload.get('result') if isinstance(payload, dict) else {}
            labels = result.get('labels') if isinstance(result, dict) else {}
            detail = {
                'source': '/v1/config',
                'labels': labels if isinstance(labels, dict) else {},
            }
            version = detail['labels'].get('version')
            if version:
                detail['Version'] = str(version)
            return detail
        except (ValueError, requests.RequestException) as exc:
            errors.append(str(exc))

        try:
            resp = self._get('/', content_type='text/plain')
            text = getattr(resp, 'text', '') or ''
            detail = {'source': '/'}
            for raw_line in re.sub(r'<br\s*/?>', '\n', text, flags=re.IGNORECASE).splitlines():
                line = re.sub(r'<[^>]+>', '', raw_line).strip()
                if not line or ':' not in line:
                    continue
                key, value = [part.strip() for part in line.split(':', 1)]
                if key in ('Version', 'Build Commit', 'Build Timestamp') and value:
                    detail[key] = value
            if detail.get('Version'):
                return detail
        except requests.RequestException as exc:
            errors.append(str(exc))

        raise ValueError('; '.join(error for error in errors if error) or _('Unable to read OPA version.'))


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


def _opa_version_summary(engine):
    summary = {'version': '', 'version_detail': {}, 'version_error': ''}
    if not engine.is_available():
        return summary
    try:
        version_detail = engine.version()
    except (ValueError, requests.RequestException) as exc:
        summary['version_error'] = str(exc)
        return summary

    if isinstance(version_detail, dict):
        summary['version_detail'] = version_detail
        summary['version'] = str(version_detail.get('Version') or version_detail.get('version') or '').strip()
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


def _audit_opa_policy_module(request, operation, policy_id, before=None, after=None, error='', source='opa_policy_modules', extra=None):
    changes = {
        'triggered_by': 'opa_policy_module_manager',
        'source': source,
        'policy_id': policy_id,
        'is_error': bool(error),
        'before': _opa_policy_module_summary(before, include_raw=True) if before else None,
        'after': _opa_policy_module_summary(after, include_raw=True) if after else None,
    }
    if extra:
        changes.update(extra)
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


def _opa_policy_module_activity_changes(entry):
    changes = entry.changes
    if isinstance(changes, dict):
        return changes
    if not changes:
        return {}
    try:
        parsed = json.loads(changes)
    except (TypeError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _opa_policy_module_snapshot_summary(snapshot, include_raw=False):
    if not isinstance(snapshot, dict):
        return None
    if 'raw' in snapshot:
        return _opa_policy_module_summary(snapshot, include_raw=include_raw)

    allowed = {'id', 'package', 'rules', 'decision_paths', 'size', 'line_count', 'sha256', 'awx_managed'}
    return {key: snapshot.get(key) for key in allowed if key in snapshot}


def _public_opa_policy_module_version(entry):
    changes = _opa_policy_module_activity_changes(entry)
    before = changes.get('before') if isinstance(changes.get('before'), dict) else None
    after = changes.get('after') if isinstance(changes.get('after'), dict) else None
    actor = getattr(entry, 'actor', None)
    return {
        'activity_stream_id': entry.pk,
        'operation': entry.operation,
        'timestamp': entry.timestamp.isoformat() if getattr(entry, 'timestamp', None) else '',
        'actor': {'id': actor.pk, 'username': actor.username} if actor else None,
        'before': _opa_policy_module_snapshot_summary(before),
        'after': _opa_policy_module_snapshot_summary(after),
        'can_restore_before': bool(before and before.get('raw')),
        'can_restore_after': bool(after and after.get('raw')),
    }


def _opa_policy_module_history(policy_id, limit=25):
    try:
        limit = int(limit)
    except (TypeError, ValueError):
        limit = 25
    limit = min(max(limit, 1), 100)
    return ActivityStream.objects.filter(object1='opa_policy_module', object2=policy_id).order_by('-timestamp', '-id')[:limit]


def _opa_policy_module_project_source(policy_id):
    for entry in _opa_policy_module_history(policy_id, 100):
        project_source = _opa_policy_module_activity_changes(entry).get('project_source')
        if isinstance(project_source, dict):
            return project_source
    return None


def _project_sync_patterns(value):
    if value in (None, ''):
        return list(OPA_PROJECT_SYNC_DEFAULT_PATTERNS), None
    if isinstance(value, str):
        raw_patterns = [part.strip() for part in re.split(r'[\n,]+', value) if part.strip()]
    elif isinstance(value, list):
        raw_patterns = [str(part or '').strip() for part in value if str(part or '').strip()]
    else:
        return None, _('path must be a string or list of strings.')
    if not raw_patterns:
        return None, _('path must include at least one Rego file or glob.')

    patterns = []
    for pattern in raw_patterns:
        pattern = pattern.replace('\\', '/')
        while pattern.startswith('./'):
            pattern = pattern[2:]
        pure_path = PurePosixPath(pattern)
        if pure_path.is_absolute() or '..' in pure_path.parts:
            return None, _('Project Rego paths must be relative and cannot include parent directory traversal.')
        if any(part.startswith('.') for part in pure_path.parts):
            return None, _('Project Rego paths cannot include hidden files or directories.')
        if not any(char in pattern for char in '*?[') and Path(pattern).suffix and Path(pattern).suffix.lower() not in OPA_PROJECT_SYNC_ALLOWED_SUFFIXES:
            return None, _('Project policy files must be Rego files.')
        patterns.append(pattern)
    return patterns, None


def _project_for_opa_sync(user, project_id):
    try:
        project_id = int(project_id)
    except (TypeError, ValueError):
        return None, _('project is required.')
    project = Project.accessible_objects(user, 'read_role').filter(pk=project_id).first()
    if project is None:
        return None, _('Project was not found or you do not have access to it.')
    project_path = project.get_project_path()
    if not project_path:
        return None, _('Project has not been synced to a local checkout yet.')
    return project, None


def _project_source(project, requested_path):
    return {
        'project_id': project.pk,
        'project_name': project.name,
        'scm_type': project.scm_type or '',
        'scm_url': project.scm_url or '',
        'scm_branch': project.scm_branch or '',
        'scm_revision': project.scm_revision or '',
        'path': requested_path,
    }


def _discover_project_rego_files(project, requested_path):
    patterns, error = _project_sync_patterns(requested_path)
    if error:
        return None, error

    root = Path(project.get_project_path()).resolve(strict=True)
    discovered = []
    seen = set()
    for pattern in patterns:
        candidates = sorted(root.glob(pattern)) if any(char in pattern for char in '*?[') else [root / pattern]
        for candidate in candidates:
            try:
                resolved = candidate.resolve(strict=True)
            except OSError:
                continue
            if not str(resolved).startswith(f'{root}/') and resolved != root:
                return None, _('Project Rego path escapes the project checkout.')
            if resolved.is_dir():
                for nested in sorted(resolved.rglob('*')):
                    try:
                        nested_resolved = nested.resolve(strict=True)
                    except OSError:
                        continue
                    try:
                        relative_parts = nested_resolved.relative_to(root).parts
                    except ValueError:
                        return None, _('Project Rego path escapes the project checkout.')
                    if any(part.startswith('.') for part in relative_parts):
                        continue
                    if nested_resolved.is_file() and nested_resolved.suffix.lower() in OPA_PROJECT_SYNC_ALLOWED_SUFFIXES:
                        if str(nested_resolved).startswith(f'{root}/') and nested_resolved not in seen:
                            discovered.append(nested_resolved)
                            seen.add(nested_resolved)
                            if len(discovered) > OPA_PROJECT_SYNC_MAX_FILES:
                                return None, _('Project Rego sync is limited to %(count)s files.') % {'count': OPA_PROJECT_SYNC_MAX_FILES}
                continue
            if not resolved.is_file() or resolved.suffix.lower() not in OPA_PROJECT_SYNC_ALLOWED_SUFFIXES:
                continue
            if resolved not in seen:
                discovered.append(resolved)
                seen.add(resolved)
            if len(discovered) > OPA_PROJECT_SYNC_MAX_FILES:
                return None, _('Project Rego sync is limited to %(count)s files.') % {'count': OPA_PROJECT_SYNC_MAX_FILES}
    return sorted(discovered, key=lambda path: str(path.relative_to(root))), None


def _policy_id_from_project_file(project, relative_path, policy_id_prefix):
    relative_policy_id = str(PurePosixPath(relative_path).with_suffix('')).replace('\\', '/')
    prefix = policy_id_prefix.strip().strip('/') if isinstance(policy_id_prefix, str) and policy_id_prefix.strip() else f'awx/projects/{project.pk}'
    policy_id = f'{prefix}/{relative_policy_id}'.strip('/')
    return _validate_policy_id(policy_id)


def _load_project_opa_modules(project, requested_path, policy_id_prefix):
    root = Path(project.get_project_path()).resolve(strict=True)
    files, error = _discover_project_rego_files(project, requested_path)
    if error:
        return None, error
    if not files:
        return None, _('No Rego files matched the project path.')

    entries = []
    for file_path in files:
        relative_path = str(file_path.relative_to(root))
        try:
            if file_path.stat().st_size > OPA_PROJECT_SYNC_MAX_FILE_BYTES:
                return None, _('Project Rego file %(path)s exceeds the size limit.') % {'path': relative_path}
            raw = file_path.read_text(encoding='utf-8')
        except (OSError, UnicodeDecodeError) as exc:
            return None, _('Could not read project Rego file %(path)s: %(error)s') % {'path': relative_path, 'error': exc}

        if not raw.strip():
            return None, _('Project Rego file %(path)s is empty.') % {'path': relative_path}
        policy_id, policy_error = _policy_id_from_project_file(project, relative_path, policy_id_prefix)
        if policy_error:
            return None, _('Project Rego file %(path)s maps to an invalid policy id: %(error)s') % {
                'path': relative_path,
                'error': policy_error,
            }
        entries.append(
            {
                'file_path': relative_path,
                'policy_id': policy_id,
                'policy_text': raw,
                'module': _opa_policy_module_summary({'id': policy_id, 'raw': raw, 'ast': {}}),
            }
        )
    return entries, None


def _activity_changes(entry):
    changes = getattr(entry, 'changes', None)
    if isinstance(changes, dict):
        return changes
    if not changes:
        return {}
    try:
        parsed = json.loads(changes)
    except (TypeError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _activity_has_opa_signal(entry, changes):
    haystack = ' '.join(
        str(value or '')
        for value in (
            getattr(entry, 'object1', ''),
            getattr(entry, 'object2', ''),
            getattr(entry, 'operation', ''),
            changes.get('triggered_by'),
            changes.get('source'),
            changes.get('policy_id'),
            changes.get('error'),
        )
    ).lower()
    return 'opa' in haystack or 'policy' in haystack or changes.get('opa_allowed') is not None


def _activity_is_opa_denial(changes):
    error = str(changes.get('error') or changes.get('detail') or '').lower()
    return changes.get('opa_allowed') is False or changes.get('allowed') is False or 'denied by opa' in error or 'opa policy guardrail' in error


def _public_opa_activity_entry(entry):
    changes = _activity_changes(entry)
    actor = getattr(entry, 'actor', None)
    before = changes.get('before') if isinstance(changes.get('before'), dict) else None
    after = changes.get('after') if isinstance(changes.get('after'), dict) else None
    policy_id = changes.get('policy_id') or (after or {}).get('id') or (before or {}).get('id') or getattr(entry, 'object2', '')
    project_source = changes.get('project_source') if isinstance(changes.get('project_source'), dict) else None
    summary = changes.get('error') or changes.get('source') or changes.get('triggered_by') or getattr(entry, 'operation', '')
    return {
        'activity_stream_id': entry.pk,
        'operation': entry.operation,
        'timestamp': entry.timestamp.isoformat() if getattr(entry, 'timestamp', None) else '',
        'actor': {'id': actor.pk, 'username': actor.username} if actor else None,
        'object1': entry.object1,
        'object2': entry.object2,
        'source': changes.get('source') or '',
        'summary': str(summary or ''),
        'policy_id': str(policy_id or ''),
        'opa_allowed': changes.get('opa_allowed'),
        'allowed': False if _activity_is_opa_denial(changes) else changes.get('allowed'),
        'is_denial': _activity_is_opa_denial(changes),
        'project_source': project_source,
        'error': str(changes.get('error') or ''),
        'before': _opa_policy_module_snapshot_summary(before),
        'after': _opa_policy_module_snapshot_summary(after),
    }


def _opa_activity(limit=100):
    try:
        limit = int(limit)
    except (TypeError, ValueError):
        limit = 100
    limit = min(max(limit, 1), 200)
    candidates = ActivityStream.objects.order_by('-timestamp', '-id')[: max(limit * 3, 100)]
    decisions = []
    for entry in candidates:
        changes = _activity_changes(entry)
        if not _activity_has_opa_signal(entry, changes):
            continue
        decisions.append(_public_opa_activity_entry(entry))
        if len(decisions) >= limit:
            break
    denials = [decision for decision in decisions if decision['is_denial']]
    return decisions, denials


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
    Build a secret-safe OPA input for any Capstan launch surface.

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


class OPAPolicyListView(OPAModuleAPIView):
    """
    GET /api/v2/opa/policies/

    List configured OPA policy paths.
    """

    permission_classes = [PolicyAsCodeViewPermission]

    def get(self, request, *args, **kwargs):
        engine = OPAPolicyEngine()
        include_version = str(request.query_params.get('include_version') or '').strip().lower() in ('1', 'true', 'yes', 'on')
        policy_bundle = getattr(settings, 'OPA_POLICY_BUNDLE', '') or ''
        policy_bundle_configured = bool(policy_bundle.strip())
        return Response(
            {
                'enabled': engine.is_available(),
                'server_url': engine.base_url,
                **(_opa_version_summary(engine) if include_version else {'version': '', 'version_detail': {}, 'version_error': ''}),
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


class OPAPolicyModuleListView(OPAModuleAPIView):
    """
    GET /api/v2/opa/policy-modules/
    POST /api/v2/opa/policy-modules/

    Manage live OPA policy modules through OPA's Policy API.
    """

    permission_classes = [PolicyAsCodeAuthorPermission]

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


class OPAPolicyModuleDetailView(OPAModuleAPIView):
    """
    GET /api/v2/opa/policy-modules/<policy_id>/
    PUT /api/v2/opa/policy-modules/<policy_id>/
    DELETE /api/v2/opa/policy-modules/<policy_id>/
    """

    permission_classes = [PolicyAsCodeAuthorPermission]

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

        response = _opa_policy_module_summary(module, include_raw=True)
        response['project_source'] = _opa_policy_module_project_source(policy_id)
        return Response(response)

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


class OPAPolicyModuleVersionsView(OPAModuleAPIView):
    """
    GET /api/v2/opa/policy-modules/<policy_id>/versions/

    Return Activity Stream-backed OPA Rego module history. Raw Rego stays redacted
    from this list; rollback endpoints restore from audited snapshots server-side.
    """

    permission_classes = [PolicyAsCodeAuthorPermission]

    def get(self, request, policy_id=None, *args, **kwargs):
        policy_id, error = _validate_policy_id(policy_id)
        if error:
            return Response({'detail': error}, status=status.HTTP_400_BAD_REQUEST)

        versions = [_public_opa_policy_module_version(entry) for entry in _opa_policy_module_history(policy_id, request.query_params.get('limit'))]
        return Response({'policy_id': policy_id, 'count': len(versions), 'versions': versions})


class OPAPolicyModuleRollbackView(OPAModuleAPIView):
    """
    POST /api/v2/opa/policy-modules/<policy_id>/rollback/

    Restore a previous audited Rego snapshot to live OPA.
    """

    permission_classes = [PolicyAsCodeAuthorPermission]

    def post(self, request, policy_id=None, *args, **kwargs):
        policy_id, error = _validate_policy_id(policy_id)
        if error:
            return Response({'detail': error}, status=status.HTTP_400_BAD_REQUEST)

        activity_stream_id = request.data.get('activity_stream_id')
        version = request.data.get('version', 'before')
        if version not in {'before', 'after'}:
            return Response({'detail': _('version must be "before" or "after".')}, status=status.HTTP_400_BAD_REQUEST)
        try:
            activity_stream_id = int(activity_stream_id)
        except (TypeError, ValueError):
            return Response({'detail': _('activity_stream_id must be an integer.')}, status=status.HTTP_400_BAD_REQUEST)

        entry = ActivityStream.objects.filter(pk=activity_stream_id, object1='opa_policy_module', object2=policy_id).first()
        if entry is None:
            return Response({'detail': _('OPA policy module version was not found.')}, status=status.HTTP_404_NOT_FOUND)

        changes = _opa_policy_module_activity_changes(entry)
        snapshot = changes.get(version)
        raw = snapshot.get('raw') if isinstance(snapshot, dict) else None
        if not raw:
            return Response({'detail': _('Selected OPA policy version does not include restorable raw Rego.')}, status=status.HTTP_400_BAD_REQUEST)

        engine = OPAPolicyEngine()
        if not engine.is_available():
            return Response({'detail': _('OPA is not enabled or configured.')}, status=status.HTTP_400_BAD_REQUEST)

        before = None
        try:
            before = _get_policy_or_none(engine, policy_id)
            opa_response = engine.put_policy(policy_id, raw)
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except requests.RequestException as exc:
            _audit_opa_policy_module(
                request,
                'update',
                policy_id,
                before=before,
                error=exc,
                source='opa_policy_module_rollback',
                extra={'rollback_source_activity_stream_id': activity_stream_id, 'rollback_version': version},
            )
            payload, status_code = _opa_http_error_payload(exc)
            return Response(payload, status=status_code)

        after = {'id': policy_id, 'raw': raw, 'ast': snapshot.get('ast') if isinstance(snapshot.get('ast'), dict) else {}}
        audit = _audit_opa_policy_module(
            request,
            'update' if before else 'create',
            policy_id,
            before=before,
            after=after,
            source='opa_policy_module_rollback',
            extra={'rollback_source_activity_stream_id': activity_stream_id, 'rollback_version': version},
        )
        return Response(
            {
                'changed': True,
                'policy_id': policy_id,
                'version': version,
                'source_activity_stream_id': activity_stream_id,
                'module': _opa_policy_module_summary(after, include_raw=True),
                'previous_sha256': _opa_policy_module_summary(before)['sha256'] if before else '',
                'restored_sha256': _opa_policy_module_summary(after)['sha256'],
                'opa_response': opa_response,
                'audit': audit,
            }
        )


class OPAActivityView(OPAModuleAPIView):
    """
    GET /api/v2/opa/activity/

    Return recent OPA decisions and denial evidence from Activity Stream.
    """

    permission_classes = [PolicyAsCodeOperatePermission]

    def get(self, request, *args, **kwargs):
        decisions, denials = _opa_activity(request.query_params.get('limit'))
        return Response(
            {
                'count': len(decisions),
                'denial_count': len(denials),
                'decisions': decisions,
                'denials': denials,
            }
        )


class OPAActivityDetailView(OPAModuleAPIView):
    """
    GET /api/v2/opa/activity/<pk>/

    Return one OPA decision or denial from Activity Stream.
    """

    permission_classes = [PolicyAsCodeOperatePermission]

    def get(self, request, pk, *args, **kwargs):
        try:
            entry = ActivityStream.objects.select_related('actor').get(pk=pk)
        except ActivityStream.DoesNotExist as exc:
            raise NotFound(_('OPA decision not found.')) from exc

        if not _activity_has_opa_signal(entry, _activity_changes(entry)):
            raise NotFound(_('OPA decision not found.'))

        return Response(_public_opa_activity_entry(entry))


class OPAPolicyModuleProjectSyncView(OPAModuleAPIView):
    """
    GET, POST /api/v2/opa/policy-modules/project-sync/

    Discover Rego modules from an already-synced Capstan Project checkout and
    preview, dry-run, or apply them through OPA's Policy API.
    """

    permission_classes = [PolicyAsCodeAuthorPermission]

    def _project_payload(self, project):
        return {
            'id': project.pk,
            'name': project.name,
            'scm_type': project.scm_type or '',
            'scm_url': project.scm_url or '',
            'scm_branch': project.scm_branch or '',
            'scm_revision': project.scm_revision or '',
            'status': project.status or '',
        }

    def get(self, request, *args, **kwargs):
        project_id = request.query_params.get('project') or request.query_params.get('project_id')
        project, error = _project_for_opa_sync(request.user, project_id)
        if error:
            return Response({'detail': error}, status=status.HTTP_400_BAD_REQUEST)

        requested_path = request.query_params.get('path') or ''
        policy_id_prefix = request.query_params.get('policy_id_prefix') or ''
        entries, error = _load_project_opa_modules(project, requested_path, policy_id_prefix)
        if error:
            return Response({'detail': error}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            {
                'count': len(entries),
                'project': self._project_payload(project),
                'project_source': _project_source(project, requested_path or ','.join(OPA_PROJECT_SYNC_DEFAULT_PATTERNS)),
                'results': [
                    {
                        'file_path': entry['file_path'],
                        'policy_id': entry['policy_id'],
                        'policy_text': entry['policy_text'],
                        'module': entry['module'],
                    }
                    for entry in entries
                ],
            }
        )

    def post(self, request, *args, **kwargs):
        mode = str(request.data.get('mode') or 'preview').strip().lower()
        if mode not in OPA_PROJECT_SYNC_MODES:
            return Response({'detail': _('mode must be preview, dry_run, or apply.')}, status=status.HTTP_400_BAD_REQUEST)

        project_id = request.data.get('project') or request.data.get('project_id')
        project, error = _project_for_opa_sync(request.user, project_id)
        if error:
            return Response({'detail': error}, status=status.HTTP_400_BAD_REQUEST)

        requested_path = request.data.get('path') or request.data.get('rego_path') or ''
        policy_id_prefix = request.data.get('policy_id_prefix') or ''
        entries, error = _load_project_opa_modules(project, requested_path, policy_id_prefix)
        if error:
            return Response({'detail': error}, status=status.HTTP_400_BAD_REQUEST)

        requested_policy_id = request.data.get('policy_id')
        if requested_policy_id not in (None, ''):
            if len(entries) != 1:
                return Response(
                    {'detail': _('policy_id can only be specified when one Rego file is selected.')},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            requested_policy_id, error = _validate_policy_id(requested_policy_id)
            if error:
                return Response({'detail': error}, status=status.HTTP_400_BAD_REQUEST)
            entries[0]['policy_id'] = requested_policy_id
            entries[0]['module'] = _opa_policy_module_summary({'id': requested_policy_id, 'raw': entries[0]['policy_text'], 'ast': {}})

        project_source = _project_source(project, requested_path or ','.join(OPA_PROJECT_SYNC_DEFAULT_PATTERNS))
        engine = OPAPolicyEngine()
        if mode == 'apply' and not engine.is_available():
            return Response({'detail': _('OPA is not enabled or configured.')}, status=status.HTTP_400_BAD_REQUEST)

        results = []
        for entry in entries:
            policy_id = entry['policy_id']
            policy_text = entry['policy_text']
            after = {'id': policy_id, 'raw': policy_text, 'ast': {}}
            before = None
            if engine.is_available():
                try:
                    before = _get_policy_or_none(engine, policy_id)
                except ValueError as exc:
                    return Response({'detail': str(exc), 'policy_id': policy_id, 'file_path': entry['file_path']}, status=status.HTTP_400_BAD_REQUEST)
                except requests.RequestException as exc:
                    payload, status_code = _opa_http_error_payload(exc)
                    payload.update({'policy_id': policy_id, 'file_path': entry['file_path']})
                    return Response(payload, status=status_code)

            before_summary = _opa_policy_module_summary(before) if before else None
            after_summary = _opa_policy_module_summary(after)
            unchanged = bool(before_summary and before_summary.get('sha256') == after_summary.get('sha256'))
            operation = 'noop' if unchanged else ('update' if before else 'create')
            item_project_source = {**project_source, 'file_path': entry['file_path']}
            result = {
                'file_path': entry['file_path'],
                'policy_id': policy_id,
                'mode': mode,
                'operation': operation,
                'changed': False,
                'persisted': False,
                'before_exists': before is not None,
                'before': before_summary,
                'after': after_summary,
                'project_source': item_project_source,
                'audit': None,
            }

            if mode == 'dry_run':
                if not unchanged:
                    result['audit'] = _audit_opa_policy_module(
                        request,
                        'update' if before else 'create',
                        policy_id,
                        before=before,
                        after=after,
                        source='opa_project_sync',
                        extra={'mode': mode, 'project_source': item_project_source, 'dry_run': True},
                    )
                results.append(result)
                continue

            if mode == 'apply' and not unchanged:
                try:
                    opa_response = engine.put_policy(policy_id, policy_text)
                except ValueError as exc:
                    return Response({'detail': str(exc), 'policy_id': policy_id, 'file_path': entry['file_path']}, status=status.HTTP_400_BAD_REQUEST)
                except requests.RequestException as exc:
                    _audit_opa_policy_module(
                        request,
                        'update' if before else 'create',
                        policy_id,
                        before=before,
                        after=after,
                        error=exc,
                        source='opa_project_sync',
                        extra={'mode': mode, 'project_source': item_project_source},
                    )
                    payload, status_code = _opa_http_error_payload(exc)
                    payload.update({'policy_id': policy_id, 'file_path': entry['file_path']})
                    return Response(payload, status=status_code)

                result['changed'] = True
                result['persisted'] = True
                result['opa_response'] = opa_response
                result['audit'] = _audit_opa_policy_module(
                    request,
                    'update' if before else 'create',
                    policy_id,
                    before=before,
                    after=after,
                    source='opa_project_sync',
                    extra={'mode': mode, 'project_source': item_project_source},
                )

            results.append(result)

        return Response(
            {
                'changed': mode == 'apply' and any(result['changed'] for result in results),
                'persisted': mode == 'apply' and any(result['persisted'] for result in results),
                'dry_run': mode == 'dry_run',
                'mode': mode,
                'project': self._project_payload(project),
                'project_source': project_source,
                'policy_id_prefix': (
                    policy_id_prefix.strip().strip('/') if isinstance(policy_id_prefix, str) and policy_id_prefix.strip() else f'awx/projects/{project.pk}'
                ),
                'counts': {
                    'files': len({entry['file_path'] for entry in entries}),
                    'modules': len(results),
                    'created': len([result for result in results if result['operation'] == 'create']),
                    'updated': len([result for result in results if result['operation'] == 'update']),
                    'unchanged': len([result for result in results if result['operation'] == 'noop']),
                },
                'results': results,
            }
        )


class OPAPolicyEvaluateView(OPAModuleAPIView):
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

    permission_classes = [PolicyAsCodeOperatePermission]

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


class OPAPolicySyncView(OPAModuleAPIView):
    """
    POST /api/v2/opa/policies/sync/

    Sync the configured Capstan-managed Rego source to the configured OPA server
    through OPA's Policy API.
    """

    permission_classes = [PolicyAsCodeAuthorPermission]

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
