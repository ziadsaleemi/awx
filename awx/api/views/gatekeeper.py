"""Gatekeeper Policy Manager style API for AWX."""

import ast
import difflib
import hashlib
import json
import re
from pathlib import Path, PurePosixPath
from urllib.parse import urljoin

import requests
import yaml
from django.conf import settings
from django.utils.translation import gettext_lazy as _
from rest_framework import status
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from awx.api.views.policy_permissions import GatekeeperGovernedWritePermission, PolicyAsCodeAuthorPermission, PolicyAsCodeOperatePermission
from awx.api.views.ai import (
    AIProviderError,
    _PROVIDER_DEFAULTS,
    _ai_authoring_context,
    _call_ai_provider,
    _check_rate_limit,
    _json_safe,
    _openai_codex_effective_default_model,
)
from awx.api.views.opa import check_opa_policy
from awx.main.models import ActivityStream, Project

GATEKEEPER_TEMPLATE_VERSIONS = ('v1', 'v1beta1')
GATEKEEPER_CONFIG_PATH = '/apis/config.gatekeeper.sh/v1alpha1/configs'
GATEKEEPER_CONSTRAINT_GROUP_PATH = '/apis/constraints.gatekeeper.sh'
GATEKEEPER_APPLY_MODES = ('preview', 'dry_run', 'apply')
GATEKEEPER_DELETE_MODES = ('preview', 'dry_run', 'delete')
GATEKEEPER_ROLLBACK_MODES = ('preview', 'dry_run', 'apply')
GATEKEEPER_REMEDIATION_MODES = ('preview', 'dry_run', 'apply')
GATEKEEPER_APPLY_STRATEGIES = ('update', 'server_side')
GATEKEEPER_FIELD_MANAGER_RE = re.compile(r'^[A-Za-z0-9_.:/-]{1,128}$')
GATEKEEPER_AI_PROMPT_LIMIT = 4000
GATEKEEPER_REMEDIATION_TEXT_LIMIT = 2000
GATEKEEPER_PROJECT_SYNC_DEFAULT_PATTERNS = ('gatekeeper/**/*.yml', 'gatekeeper/**/*.yaml', 'gatekeeper/**/*.json')
GATEKEEPER_PROJECT_SYNC_ALLOWED_SUFFIXES = ('.yml', '.yaml', '.json')
GATEKEEPER_PROJECT_SYNC_MAX_FILES = 50
GATEKEEPER_PROJECT_SYNC_MAX_DOCS = 200
GATEKEEPER_PROJECT_SYNC_MAX_FILE_BYTES = 512 * 1024


def gatekeeper_module_enabled():
    return bool(getattr(settings, 'MODULE_GATEKEEPER_ENABLED', True))


class GatekeeperModuleAPIView(APIView):
    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if not gatekeeper_module_enabled():
            raise PermissionDenied(_('Gatekeeper module is disabled.'))


def _gatekeeper_bool(value, default=True):
    if isinstance(value, bool):
        return value
    if value in (None, ''):
        return default
    if isinstance(value, str):
        return value.strip().lower() in ('1', 'true', 'yes', 'on')
    return bool(value)


def _safe_gatekeeper_legacy_literal(value):
    def convert(node):
        if isinstance(node, ast.Expression):
            return convert(node.body)
        if isinstance(node, ast.Constant):
            return node.value
        if isinstance(node, ast.Dict):
            return {convert(key): convert(val) for key, val in zip(node.keys, node.values)}
        if isinstance(node, (ast.List, ast.Tuple)):
            return [convert(item) for item in node.elts]
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
            operand = convert(node.operand)
            return -operand if isinstance(operand, (int, float)) else None
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == 'OrderedDict' and len(node.args) == 1 and not node.keywords:
            ordered_value = convert(node.args[0])
            if isinstance(ordered_value, dict):
                return ordered_value
            if isinstance(ordered_value, list):
                return dict(ordered_value)
        raise ValueError('Unsupported Gatekeeper context literal')

    return convert(ast.parse(value, mode='eval'))


def _gatekeeper_context_map():
    configured = getattr(settings, 'GATEKEEPER_K8S_CONTEXTS', {}) or {}
    if isinstance(configured, str):
        configured = configured.strip()
        if not configured or configured.startswith('$encrypted$'):
            return {}
        try:
            configured = json.loads(configured)
        except (TypeError, ValueError):
            try:
                configured = _safe_gatekeeper_legacy_literal(configured)
            except (SyntaxError, ValueError, TypeError):
                return {}
    if not isinstance(configured, dict):
        return {}

    contexts = {}
    for raw_name, raw_config in configured.items():
        name = str(raw_name or '').strip()
        if not name or not isinstance(raw_config, dict):
            continue
        contexts[name] = {
            'server_url': str(raw_config.get('server_url') or raw_config.get('api_url') or raw_config.get('url') or '').strip().rstrip('/'),
            'auth_token': str(raw_config.get('auth_token') or raw_config.get('token') or '').strip(),
            'verify_ssl': _gatekeeper_bool(raw_config.get('verify_ssl'), default=True),
            'timeout': max(
                float(raw_config.get('request_timeout') or raw_config.get('timeout') or getattr(settings, 'GATEKEEPER_K8S_REQUEST_TIMEOUT', 5) or 5), 1
            ),
            'source': 'context_map',
        }
    return contexts


def _requested_gatekeeper_context(request):
    if request.method == 'GET':
        value = request.query_params.get('context')
    else:
        value = request.data.get('context_name') if isinstance(request.data, dict) else ''
        value = value or request.query_params.get('context')
    return str(value or '').strip()


class GatekeeperKubernetesClient:
    """Small Kubernetes API client for Gatekeeper CRD reads."""

    def __init__(self, context_name=''):
        default_context = str(getattr(settings, 'GATEKEEPER_K8S_CONTEXT', '') or '').strip() or 'default'
        contexts = {
            default_context: {
                'server_url': (getattr(settings, 'GATEKEEPER_K8S_API_URL', '') or '').strip().rstrip('/'),
                'auth_token': getattr(settings, 'GATEKEEPER_K8S_AUTH_TOKEN', '') or '',
                'verify_ssl': bool(getattr(settings, 'GATEKEEPER_K8S_VERIFY_SSL', True)),
                'timeout': max(float(getattr(settings, 'GATEKEEPER_K8S_REQUEST_TIMEOUT', 5) or 5), 1),
                'source': 'settings',
            }
        }
        contexts.update(_gatekeeper_context_map())

        requested_context = str(context_name or '').strip()
        selected_context = requested_context or default_context
        self.context_error = ''
        if selected_context not in contexts:
            self.context_error = _('Gatekeeper Kubernetes context "%(context)s" is not configured.') % {'context': selected_context}
            selected_context = default_context

        config = contexts.get(selected_context) or contexts[default_context]
        self.contexts = contexts
        self.context = selected_context
        self.server_url = config['server_url']
        self.auth_token = config['auth_token']
        self.verify_ssl = bool(config['verify_ssl'])
        self.timeout = max(float(config['timeout'] or 5), 1)

    def is_configured(self):
        return bool(self.server_url)

    def context_options(self):
        options = []
        for name, config in self.contexts.items():
            options.append(
                {
                    'name': name,
                    'selected': name == self.context,
                    'configured': bool(config.get('server_url')),
                    'server_url': config.get('server_url') or '',
                    'verify_ssl': bool(config.get('verify_ssl')),
                    'source': config.get('source') or 'settings',
                }
            )
        return options

    def _headers(self):
        headers = {'Accept': 'application/json'}
        if self.auth_token:
            headers['Authorization'] = f'Bearer {self.auth_token}'
        return headers

    def get(self, path):
        url = urljoin(f'{self.server_url}/', path.lstrip('/'))
        response = requests.get(url, headers=self._headers(), verify=self.verify_ssl, timeout=self.timeout)
        response.raise_for_status()
        return response.json()

    def write(self, method, path, payload, dry_run=False, content_type='application/json', field_manager='', force_conflicts=False):
        url = urljoin(f'{self.server_url}/', path.lstrip('/'))
        headers = self._headers()
        headers['Content-Type'] = content_type
        params = {}
        if dry_run:
            params['dryRun'] = 'All'
        if field_manager:
            params['fieldManager'] = field_manager
        if force_conflicts:
            params['force'] = 'true'
        response = requests.request(
            method,
            url,
            headers=headers,
            json=payload,
            params=params or None,
            verify=self.verify_ssl,
            timeout=self.timeout,
        )
        response.raise_for_status()
        if getattr(response, 'content', b''):
            return response.json()
        return {'status_code': response.status_code}

    def delete(self, path, dry_run=False):
        url = urljoin(f'{self.server_url}/', path.lstrip('/'))
        response = requests.request(
            'DELETE',
            url,
            headers=self._headers(),
            params={'dryRun': 'All'} if dry_run else None,
            verify=self.verify_ssl,
            timeout=self.timeout,
        )
        response.raise_for_status()
        if getattr(response, 'content', b''):
            try:
                return response.json()
            except ValueError:
                return {'status_code': response.status_code}
        return {'status_code': response.status_code}

    def get_or_none(self, path):
        try:
            return self.get(path)
        except requests.HTTPError as exc:
            response = getattr(exc, 'response', None)
            if response is not None and response.status_code == 404:
                return None
            raise

    def constraint_resource_name(self, version, kind):
        resources = self.get(f'{GATEKEEPER_CONSTRAINT_GROUP_PATH}/{version}').get('resources') or []
        for resource in resources:
            if resource.get('kind') == kind and resource.get('name') and '/' not in resource.get('name') and 'list' in (resource.get('verbs') or []):
                return resource['name']
        raise ValueError(_('Constraint kind %(kind)s was not discovered in Gatekeeper API version %(version)s.') % {'kind': kind, 'version': version})

    def api_resource(self, api_version, kind, required_verbs=('get', 'patch')):
        group, version = _split_api_version(api_version or '')
        if not version or not kind:
            raise ValueError(_('Kubernetes apiVersion and kind are required.'))

        discovery_path = f'/apis/{group}/{version}' if group else f'/api/{version}'
        resources = self.get(discovery_path).get('resources') or []
        for resource in resources:
            verbs = resource.get('verbs') or []
            if resource.get('kind') == kind and resource.get('name') and '/' not in resource.get('name') and all(verb in verbs for verb in required_verbs):
                return {
                    'name': resource['name'],
                    'namespaced': bool(resource.get('namespaced')),
                }
        raise ValueError(_('Kubernetes resource %(kind)s was not discovered in apiVersion %(api_version)s.') % {'kind': kind, 'api_version': api_version})

    def list_constraint_templates(self):
        last_error = None
        for version in GATEKEEPER_TEMPLATE_VERSIONS:
            try:
                data = self.get(f'/apis/templates.gatekeeper.sh/{version}/constrainttemplates')
                return version, data.get('items') or []
            except requests.HTTPError as exc:
                last_error = exc
                response = getattr(exc, 'response', None)
                if response is None or response.status_code != 404:
                    raise
        if last_error:
            raise last_error
        return '', []

    def list_configs(self):
        data = self.get(GATEKEEPER_CONFIG_PATH)
        return data.get('items') or []

    def list_constraint_resources(self):
        try:
            discovery = self.get(GATEKEEPER_CONSTRAINT_GROUP_PATH)
        except requests.HTTPError as exc:
            response = getattr(exc, 'response', None)
            if response is not None and response.status_code == 404:
                return [], []
            raise
        preferred = ((discovery.get('preferredVersion') or {}).get('version') or '').strip()
        versions = [preferred] if preferred else []
        versions.extend(
            version.get('version') for version in discovery.get('versions') or [] if version.get('version') and version.get('version') not in versions
        )

        constraints = []
        seen_constraints = set()
        errors = []
        for version in versions:
            resources = self.get(f'{GATEKEEPER_CONSTRAINT_GROUP_PATH}/{version}').get('resources') or []
            for resource in resources:
                name = resource.get('name') or ''
                kind = resource.get('kind') or ''
                if not name or '/' in name or kind.endswith('Status') or 'list' not in (resource.get('verbs') or []):
                    continue
                try:
                    data = self.get(f'{GATEKEEPER_CONSTRAINT_GROUP_PATH}/{version}/{name}')
                except requests.RequestException as exc:
                    errors.append(_gatekeeper_error('constraints', exc, resource=name, version=version))
                    continue
                for item in data.get('items') or []:
                    metadata = item.get('metadata') or {}
                    key = metadata.get('uid') or '|'.join(
                        [
                            item.get('kind') or kind,
                            metadata.get('namespace') or '',
                            metadata.get('name') or '',
                        ]
                    )
                    if key in seen_constraints:
                        continue
                    seen_constraints.add(key)
                    item['_gatekeeper_resource'] = name
                    item['_gatekeeper_version'] = version
                    constraints.append(item)
        return constraints, errors


def _metadata(item):
    return item.get('metadata') or {}


def _object_name(item):
    return _metadata(item).get('name') or ''


def _template_kind(template):
    return (((template.get('spec') or {}).get('crd') or {}).get('spec') or {}).get('names', {}).get('kind') or template.get('kind') or ''


def _template_rego_targets(template):
    targets = []
    for target in (template.get('spec') or {}).get('targets') or []:
        targets.append(
            {
                'target': target.get('target') or '',
                'rego': target.get('rego') or '',
                'libs': target.get('libs') or [],
            }
        )
    return targets


def _template_summary(template, constraints):
    kind = _template_kind(template)
    related = [constraint for constraint in constraints if constraint.get('kind') == kind]
    status_data = template.get('status') or {}
    return {
        'api_version': template.get('apiVersion') or '',
        'name': _object_name(template),
        'kind': kind,
        'created': bool(status_data.get('created')),
        'observed_generation': status_data.get('observedGeneration'),
        'by_pod': status_data.get('byPod') or [],
        'errors': status_data.get('errors') or [],
        'schema': ((((template.get('spec') or {}).get('crd') or {}).get('spec') or {}).get('validation') or {}).get('openAPIV3Schema') or {},
        'targets': _template_rego_targets(template),
        'constraint_count': len(related),
        'constraints': [_constraint_ref(constraint) for constraint in related],
    }


def _constraint_ref(constraint):
    return {
        'api_version': constraint.get('apiVersion') or '',
        'kind': constraint.get('kind') or '',
        'name': _object_name(constraint),
    }


def _constraint_summary(constraint):
    spec = constraint.get('spec') or {}
    status_data = constraint.get('status') or {}
    violations = status_data.get('violations') or []
    return {
        **_constraint_ref(constraint),
        'resource': constraint.get('_gatekeeper_resource') or '',
        'version': constraint.get('_gatekeeper_version') or '',
        'enforcement_action': spec.get('enforcementAction') or 'deny',
        'match': spec.get('match') or {},
        'parameters': spec.get('parameters') or {},
        'total_violations': status_data.get('totalViolations', len(violations)),
        'audit_timestamp': status_data.get('auditTimestamp') or '',
        'by_pod': status_data.get('byPod') or [],
        'violations': violations,
    }


def _violation_summary(constraint, violation):
    return {
        'constraint_kind': constraint.get('kind') or '',
        'constraint_name': _object_name(constraint),
        'enforcement_action': violation.get('enforcementAction') or (constraint.get('spec') or {}).get('enforcementAction') or 'deny',
        'message': violation.get('message') or '',
        'resource_api_version': violation.get('apiVersion') or '',
        'resource_group': violation.get('group') or '',
        'resource_version': violation.get('version') or '',
        'resource_kind': violation.get('kind') or '',
        'resource_namespace': violation.get('namespace') or '',
        'resource_name': violation.get('name') or '',
    }


def _violation_search_text(violation):
    return ' '.join(
        str(violation.get(key) or '')
        for key in (
            'constraint_kind',
            'constraint_name',
            'enforcement_action',
            'message',
            'resource_kind',
            'resource_namespace',
            'resource_name',
            'resource_group',
            'resource_version',
        )
    ).lower()


def _sort_violations(violations, sort_key):
    sort_map = {
        'constraint': lambda item: (item['constraint_kind'], item['constraint_name'], item['resource_namespace'], item['resource_name']),
        'resource': lambda item: (item['resource_kind'], item['resource_namespace'], item['resource_name'], item['constraint_kind'], item['constraint_name']),
        'namespace': lambda item: (item['resource_namespace'], item['resource_kind'], item['resource_name'], item['constraint_kind'], item['constraint_name']),
        'enforcement': lambda item: (
            item['enforcement_action'],
            item['constraint_kind'],
            item['constraint_name'],
            item['resource_namespace'],
            item['resource_name'],
        ),
    }
    violations.sort(key=sort_map.get(sort_key, sort_map['constraint']))


def _positive_int_query(request, name, default, maximum):
    try:
        value = int(request.query_params.get(name, default))
    except (TypeError, ValueError):
        value = default
    return max(1, min(value, maximum))


def _config_summary(config):
    spec = config.get('spec') or {}
    sync_only = ((spec.get('sync') or {}).get('syncOnly')) or []
    readiness = spec.get('readiness') or {}
    return {
        'api_version': config.get('apiVersion') or '',
        'name': _object_name(config),
        'match': spec.get('match') or [],
        'sync_only': sync_only,
        'sync_only_count': len(sync_only),
        'readiness': readiness,
        'readiness_stats_enabled': readiness.get('statsEnabled'),
        'status': config.get('status') or {},
    }


def _gatekeeper_error(resource, exc, **extra):
    response = getattr(exc, 'response', None)
    detail = str(exc)
    status_code = None
    if response is not None:
        status_code = response.status_code
        try:
            detail = response.json()
        except ValueError:
            detail = getattr(response, 'text', '') or detail
    return {
        'resource': resource,
        'status_code': status_code,
        'detail': detail,
        **extra,
    }


def _gatekeeper_http_error_response(exc):
    response = getattr(exc, 'response', None)
    if response is not None and response.status_code in (401, 403):
        http_status = status.HTTP_403_FORBIDDEN
    elif response is not None and response.status_code == 404:
        http_status = status.HTTP_404_NOT_FOUND
    else:
        http_status = status.HTTP_502_BAD_GATEWAY
    return Response(
        {
            'detail': _('Gatekeeper Kubernetes API request failed.'),
            'error': _gatekeeper_error('gatekeeper', exc),
        },
        status=http_status,
    )


def _load_gatekeeper_manifest(value):
    if isinstance(value, dict):
        manifest = value
    elif isinstance(value, str) and value.strip():
        try:
            manifest = yaml.safe_load(value)
        except yaml.YAMLError as exc:
            return None, _('manifest YAML/JSON is invalid: %(error)s') % {'error': exc}
    else:
        return None, _('manifest must be a non-empty Kubernetes object.')

    if not isinstance(manifest, dict):
        return None, _('manifest must be a single Kubernetes object.')

    api_version = manifest.get('apiVersion')
    kind = manifest.get('kind')
    metadata = manifest.get('metadata') if isinstance(manifest.get('metadata'), dict) else {}
    name = metadata.get('name')
    if not all(isinstance(item, str) and item.strip() for item in (api_version, kind, name)):
        return None, _('manifest requires apiVersion, kind, and metadata.name.')
    return manifest, None


def _project_sync_patterns(value):
    if value in (None, ''):
        return list(GATEKEEPER_PROJECT_SYNC_DEFAULT_PATTERNS), None
    if isinstance(value, str):
        raw_patterns = [part.strip() for part in re.split(r'[\n,]+', value) if part.strip()]
    elif isinstance(value, list):
        raw_patterns = [str(part or '').strip() for part in value if str(part or '').strip()]
    else:
        return None, _('path must be a string or list of strings.')
    if not raw_patterns:
        return None, _('path must include at least one file or glob.')

    patterns = []
    for pattern in raw_patterns:
        pattern = pattern.replace('\\', '/')
        while pattern.startswith('./'):
            pattern = pattern[2:]
        pure_path = PurePosixPath(pattern)
        if pure_path.is_absolute() or '..' in pure_path.parts:
            return None, _('Project manifest paths must be relative and cannot include parent directory traversal.')
        if any(part.startswith('.') for part in pure_path.parts):
            return None, _('Project manifest paths cannot include hidden files or directories.')
        if not any(char in pattern for char in '*?[') and Path(pattern).suffix and Path(pattern).suffix.lower() not in GATEKEEPER_PROJECT_SYNC_ALLOWED_SUFFIXES:
            return None, _('Project manifest files must be YAML or JSON.')
        patterns.append(pattern)
    return patterns, None


def _project_for_gatekeeper_sync(user, project_id):
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


def _discover_project_manifest_files(project, requested_path):
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
                return None, _('Project manifest path escapes the project checkout.')
            if resolved.is_dir():
                for nested in sorted(resolved.rglob('*')):
                    try:
                        nested_resolved = nested.resolve(strict=True)
                    except OSError:
                        continue
                    try:
                        relative_parts = nested_resolved.relative_to(root).parts
                    except ValueError:
                        return None, _('Project manifest path escapes the project checkout.')
                    if any(part.startswith('.') for part in relative_parts):
                        continue
                    if nested_resolved.is_file() and nested_resolved.suffix.lower() in GATEKEEPER_PROJECT_SYNC_ALLOWED_SUFFIXES:
                        if str(nested_resolved).startswith(f'{root}/') and nested_resolved not in seen:
                            discovered.append(nested_resolved)
                            seen.add(nested_resolved)
                            if len(discovered) > GATEKEEPER_PROJECT_SYNC_MAX_FILES:
                                return None, _('Project manifest sync is limited to %(count)s files.') % {'count': GATEKEEPER_PROJECT_SYNC_MAX_FILES}
                continue
            if not resolved.is_file() or resolved.suffix.lower() not in GATEKEEPER_PROJECT_SYNC_ALLOWED_SUFFIXES:
                continue
            if resolved not in seen:
                discovered.append(resolved)
                seen.add(resolved)
            if len(discovered) > GATEKEEPER_PROJECT_SYNC_MAX_FILES:
                return None, _('Project manifest sync is limited to %(count)s files.') % {'count': GATEKEEPER_PROJECT_SYNC_MAX_FILES}
    return sorted(discovered, key=lambda path: str(path.relative_to(root))), None


def _load_project_gatekeeper_manifests(project, requested_path):
    root = Path(project.get_project_path()).resolve(strict=True)
    files, error = _discover_project_manifest_files(project, requested_path)
    if error:
        return None, error
    if not files:
        return None, _('No YAML or JSON manifests matched the project path.')

    entries = []
    for file_path in files:
        relative_path = str(file_path.relative_to(root))
        try:
            if file_path.stat().st_size > GATEKEEPER_PROJECT_SYNC_MAX_FILE_BYTES:
                return None, _('Project manifest file %(path)s exceeds the size limit.') % {'path': relative_path}
            content = file_path.read_text(encoding='utf-8')
            documents = list(yaml.safe_load_all(content))
        except (OSError, UnicodeDecodeError, yaml.YAMLError) as exc:
            return None, _('Could not read project manifest file %(path)s: %(error)s') % {'path': relative_path, 'error': exc}

        for index, document in enumerate(documents, start=1):
            if document is None:
                continue
            manifest, manifest_error = _load_gatekeeper_manifest(document)
            if manifest_error:
                return None, _('Project manifest %(path)s document %(index)s is invalid: %(error)s') % {
                    'path': relative_path,
                    'index': index,
                    'error': manifest_error,
                }
            entries.append(
                {
                    'file_path': relative_path,
                    'document_index': index,
                    'manifest': manifest,
                    'manifest_yaml': _gatekeeper_manifest_yaml(manifest),
                }
            )
            if len(entries) > GATEKEEPER_PROJECT_SYNC_MAX_DOCS:
                return None, _('Project manifest sync is limited to %(count)s Kubernetes objects.') % {'count': GATEKEEPER_PROJECT_SYNC_MAX_DOCS}
    if not entries:
        return None, _('No Kubernetes objects were found in the matched project manifests.')
    return entries, None


def _split_api_version(api_version):
    if '/' not in api_version:
        return '', api_version
    group, version = api_version.split('/', 1)
    return group, version


def _gatekeeper_target_from_parts(client, api_version, kind, name, namespace='', resource=''):
    group, version = _split_api_version(api_version or '')
    if group == 'templates.gatekeeper.sh' and kind == 'ConstraintTemplate' and version in GATEKEEPER_TEMPLATE_VERSIONS:
        resource = 'constrainttemplates'
    elif group == 'config.gatekeeper.sh' and kind == 'Config' and version == 'v1alpha1':
        resource = 'configs'
    elif group == 'constraints.gatekeeper.sh' and version:
        resource = resource or client.constraint_resource_name(version, kind)
    else:
        raise ValueError(_('Only Gatekeeper ConstraintTemplate, Constraint, and Config resources are supported.'))

    collection_path = f'/apis/{group}/{version}/{resource}'
    return {
        'api_version': api_version or '',
        'group': group,
        'version': version,
        'resource': resource,
        'kind': kind,
        'name': name,
        'namespace': namespace or '',
        'collection_path': collection_path,
        'object_path': f'{collection_path}/{name}',
    }


def _gatekeeper_target(client, manifest):
    return _gatekeeper_target_from_parts(
        client,
        manifest.get('apiVersion') or '',
        manifest.get('kind') or '',
        _object_name(manifest),
        _metadata(manifest).get('namespace') or '',
    )


def _gatekeeper_target_from_payload(client, payload):
    if not isinstance(payload, dict):
        return None, _('target must be a JSON object.')
    api_version = payload.get('api_version') or payload.get('apiVersion') or ''
    kind = payload.get('kind') or ''
    name = payload.get('name') or ''
    namespace = payload.get('namespace') or ''
    resource = payload.get('resource') or ''
    if not all(isinstance(item, str) and item.strip() for item in (api_version, kind, name)):
        return None, _('target requires api_version, kind, and name.')
    try:
        return _gatekeeper_target_from_parts(client, api_version, kind, name, namespace, resource), None
    except ValueError as exc:
        return None, str(exc)


def _kubernetes_target_from_violation(client, violation):
    if not isinstance(violation, dict):
        return None, _('violation must be a JSON object.')

    api_version = violation.get('resource_api_version') or ''
    if not api_version:
        group = violation.get('resource_group') or ''
        version = violation.get('resource_version') or ''
        api_version = f'{group}/{version}' if group else version

    kind = violation.get('resource_kind') or ''
    name = violation.get('resource_name') or ''
    namespace = violation.get('resource_namespace') or ''
    if not all(isinstance(item, str) and item.strip() for item in (api_version, kind, name)):
        return None, _('violation requires resource apiVersion, kind, and name.')

    group, version = _split_api_version(api_version)
    resource = client.api_resource(api_version, kind)
    if resource['namespaced'] and not namespace:
        return None, _('violation resource is namespaced but namespace is missing.')

    if group:
        collection_path = f'/apis/{group}/{version}'
    else:
        collection_path = f'/api/{version}'
    if resource['namespaced']:
        collection_path = f'{collection_path}/namespaces/{namespace}/{resource["name"]}'
    else:
        collection_path = f'{collection_path}/{resource["name"]}'

    return (
        {
            'api_version': api_version,
            'group': group,
            'version': version,
            'resource': resource['name'],
            'kind': kind,
            'name': name,
            'namespace': namespace,
            'collection_path': collection_path,
            'object_path': f'{collection_path}/{name}',
        },
        None,
    )


def _string_dict(value, field_name):
    if not isinstance(value, dict):
        return None, _('%(field)s must be a JSON object.') % {'field': field_name}
    normalized = {}
    for raw_key, raw_value in value.items():
        if not isinstance(raw_key, str) or not isinstance(raw_value, str):
            return None, _('%(field)s keys and values must be strings.') % {'field': field_name}
        key = raw_key.strip()
        if not key:
            return None, _('%(field)s keys must be non-empty strings.') % {'field': field_name}
        value_text = raw_value
        if len(key) > 253 or len(value_text) > 1024:
            return None, _('%(field)s contains a key or value that is too long.') % {'field': field_name}
        normalized[key] = value_text
    return normalized, None


def _validate_remediation_target(plan_target, target):
    if not isinstance(plan_target, dict):
        return None
    expected = {
        'api_version': target['api_version'],
        'kind': target['kind'],
        'name': target['name'],
        'namespace': target.get('namespace') or '',
    }
    for key, expected_value in expected.items():
        if key == 'api_version':
            raw_value = plan_target.get('api_version') or plan_target.get('apiVersion') or ''
        else:
            raw_value = plan_target.get(key) or ''
        if str(raw_value or '') and str(raw_value or '') != expected_value:
            return _('remediation target %(key)s does not match the selected violation.') % {'key': key}
    return None


def _normalize_remediation_plan(value, target):
    if not isinstance(value, dict):
        return None, _('remediation_plan must be a JSON object.')

    target_error = _validate_remediation_target(value.get('target'), target)
    if target_error:
        return None, target_error

    summary = str(value.get('summary') or '').strip()[:GATEKEEPER_REMEDIATION_TEXT_LIMIT]
    rationale = str(value.get('rationale') or '').strip()[:GATEKEEPER_REMEDIATION_TEXT_LIMIT]
    risk = str(value.get('risk') or 'medium').strip().lower()
    if risk not in ('low', 'medium', 'high'):
        risk = 'medium'
    manual_steps = value.get('manual_steps') if isinstance(value.get('manual_steps'), list) else []
    manual_steps = [str(step).strip()[:GATEKEEPER_REMEDIATION_TEXT_LIMIT] for step in manual_steps if str(step or '').strip()][:8]

    patch = value.get('patch')
    can_apply = False
    normalized_patch = None
    patch_type = str(value.get('patch_type') or 'merge').strip().lower()
    if patch:
        if patch_type not in ('merge', 'json_merge'):
            return None, _('Only Kubernetes JSON merge patch remediation is supported.')
        if not isinstance(patch, dict):
            return None, _('remediation patch must be a JSON object.')
        unexpected = sorted(key for key in patch if key != 'metadata')
        if unexpected:
            return None, _('remediation patch can only update metadata labels or annotations.')
        metadata = patch.get('metadata')
        if not isinstance(metadata, dict):
            return None, _('remediation patch metadata must be a JSON object.')
        metadata_patch = {}
        for key in metadata:
            if key not in ('labels', 'annotations'):
                return None, _('remediation patch can only update metadata labels or annotations.')
        if 'labels' in metadata:
            labels, error = _string_dict(metadata.get('labels'), 'labels')
            if error:
                return None, error
            if labels:
                metadata_patch['labels'] = labels
        if 'annotations' in metadata:
            annotations, error = _string_dict(metadata.get('annotations'), 'annotations')
            if error:
                return None, error
            if annotations:
                metadata_patch['annotations'] = annotations
        if not metadata_patch:
            return None, _('remediation patch must include labels or annotations.')
        normalized_patch = {'metadata': metadata_patch}
        can_apply = True

    if not summary:
        summary = _('Review the Gatekeeper violation and update the Kubernetes resource metadata.')
    if not rationale:
        rationale = _('The selected resource is currently out of policy for the reported Gatekeeper constraint.')
    if not can_apply and not manual_steps:
        manual_steps = [_('No safe automatic metadata remediation was generated. Review the constraint and resource manually.')]

    return (
        {
            'summary': summary,
            'rationale': rationale,
            'risk': risk,
            'target': _safe_gatekeeper_target(target),
            'patch_type': 'merge',
            'patch': normalized_patch,
            'manual_steps': manual_steps,
            'can_apply': can_apply,
        },
        None,
    )


def _json_merge_patch(source, patch):
    if not isinstance(patch, dict):
        return patch
    if not isinstance(source, dict):
        source = {}
    merged = dict(source)
    for key, value in patch.items():
        if value is None:
            merged.pop(key, None)
        elif isinstance(value, dict):
            merged[key] = _json_merge_patch(merged.get(key), value)
        else:
            merged[key] = value
    return merged


def _canonical_json(value):
    return json.dumps(value or {}, sort_keys=True, indent=2)


def _json_sha256(value):
    return hashlib.sha256(_canonical_json(value).encode()).hexdigest() if value else ''


def _manifest_diff(before, after):
    before_lines = _canonical_json(before).splitlines()
    after_lines = _canonical_json(after).splitlines()
    return '\n'.join(
        difflib.unified_diff(
            before_lines,
            after_lines,
            fromfile='cluster',
            tofile='submitted',
            lineterm='',
        )
    )


def _rollback_plan(target, before):
    if before:
        return {
            'operation': 'restore',
            'target': _safe_gatekeeper_target(target),
            'manifest': before,
        }
    return {
        'operation': 'delete',
        'target': _safe_gatekeeper_target(target),
    }


def _safe_gatekeeper_target(target):
    return {
        'api_version': target['api_version'],
        'kind': target['kind'],
        'name': target['name'],
        'namespace': target['namespace'],
        'resource': target['resource'],
        'object_path': target['object_path'],
    }


def _bool_from_request(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ('1', 'true', 'yes', 'on')
    return bool(value)


def _gatekeeper_apply_options(request):
    strategy = str(request.data.get('apply_strategy') or 'update').strip().lower()
    if strategy not in GATEKEEPER_APPLY_STRATEGIES:
        return None, _('apply_strategy must be update or server_side.')

    field_manager = str(request.data.get('field_manager') or 'awx').strip()
    if not GATEKEEPER_FIELD_MANAGER_RE.match(field_manager):
        return None, _('field_manager must be 1-128 characters and may only contain letters, numbers, dot, dash, underscore, colon, or slash.')

    return {
        'strategy': strategy,
        'field_manager': field_manager,
        'force_conflicts': _bool_from_request(request.data.get('force_conflicts', False)),
    }, None


def _gatekeeper_write_manifest(client, target, manifest, before, mode, apply_options):
    if apply_options['strategy'] == 'server_side':
        return client.write(
            'PATCH',
            target['object_path'],
            manifest,
            dry_run=mode == 'dry_run',
            content_type='application/apply-patch+yaml',
            field_manager=apply_options['field_manager'],
            force_conflicts=apply_options['force_conflicts'],
        )
    return client.write(
        'PUT' if before else 'POST',
        target['object_path'] if before else target['collection_path'],
        manifest,
        dry_run=mode == 'dry_run',
    )


def _gatekeeper_opa_input(request, mode, operation, target, manifest=None, source='gatekeeper_apply', apply_options=None):
    manifest = manifest or {}
    data = {
        'triggered_by': 'gatekeeper_policy_manager',
        'source': source,
        'mode': mode,
        'human_approved': bool(request.data.get('human_approved', False)),
        'approval_required': mode in ('apply', 'delete'),
        'user': {
            'id': request.user.pk,
            'username': request.user.username,
            'is_superuser': request.user.is_superuser,
        },
        'operation': operation,
        'resource_type': 'gatekeeper_resource',
        'destructive': mode in ('apply', 'delete'),
        'privileged': True,
        'target': _safe_gatekeeper_target(target),
        'manifest': {
            'apiVersion': manifest.get('apiVersion') or '',
            'kind': manifest.get('kind') or '',
            'metadata': {
                'name': _object_name(manifest),
                'namespace': _metadata(manifest).get('namespace') or '',
            },
        },
    }
    if apply_options:
        data['apply_options'] = apply_options
    return data


def _audit_gatekeeper_apply(
    request,
    mode,
    operation,
    target,
    before=None,
    after=None,
    error='',
    opa_allowed=True,
    source='gatekeeper_apply',
    apply_options=None,
    project_source=None,
):
    changes = {
        'triggered_by': 'gatekeeper_policy_manager',
        'source': source,
        'mode': mode,
        'operation': operation,
        'target': _safe_gatekeeper_target(target),
        'opa_allowed': bool(opa_allowed),
        'is_error': bool(error),
        'before_sha256': _json_sha256(before),
        'after_sha256': _json_sha256(after),
        'rollback_plan': {
            'operation': 'restore' if before else 'delete',
            'target': _safe_gatekeeper_target(target),
        },
    }
    if apply_options:
        changes['apply_options'] = apply_options
    if project_source:
        changes['project_source'] = project_source
    if error:
        changes['error'] = str(error)
    activity_operation = 'delete' if 'delete' in operation else 'create' if operation == 'create' else 'update'
    entry = ActivityStream.objects.create(
        operation=activity_operation,
        object1='gatekeeper_resource',
        object2=f"{target['kind']}/{target['name']}",
        changes=json.dumps(changes),
        actor=request.user,
    )
    entry.user.add(request.user)
    return {
        'activity_stream_id': entry.pk,
        'activity_stream_url': f'/api/v2/activity_stream/{entry.pk}/',
    }


def _strip_gatekeeper_ai_fences(text):
    text = (text or '').strip()
    if text.startswith('```'):
        lines = text.splitlines()
        if lines and lines[0].startswith('```'):
            lines = lines[1:]
        if lines and lines[-1].strip() == '```':
            lines = lines[:-1]
        text = '\n'.join(lines).strip()
    return text


def _gatekeeper_manifest_yaml(manifest):
    return yaml.safe_dump(manifest, sort_keys=False, default_flow_style=False).strip()


def _summarize_gatekeeper_prompt(prompt):
    prompt = ' '.join(str(prompt or '').split())
    if len(prompt) > 240:
        return f'{prompt[:237]}...'
    return prompt


def _gatekeeper_context_for_ai(client):
    context = {
        'configured': client.is_configured(),
        'cluster': {
            'server_url': client.server_url if client.is_configured() else '',
            'context': client.context,
            'verify_ssl': client.verify_ssl,
        },
        'counts': {
            'constraint_templates': 0,
            'constraints': 0,
            'violations': 0,
            'configs': 0,
        },
        'constraint_templates': [],
        'constraints': [],
        'violations': [],
        'configs': [],
        'errors': [],
    }
    if not client.is_configured():
        context['message'] = _('Configure the Gatekeeper Kubernetes API connection in Settings.')
        return context

    try:
        template_version, templates = client.list_constraint_templates()
        constraints, errors = client.list_constraint_resources()
        try:
            configs = client.list_configs()
        except requests.HTTPError as exc:
            response = getattr(exc, 'response', None)
            if response is None or response.status_code != 404:
                raise
            configs = []
            errors.append(_gatekeeper_error('configs', exc))
    except requests.RequestException as exc:
        context['errors'].append(_gatekeeper_error('gatekeeper', exc))
        return context

    constraint_summaries = [_constraint_summary(constraint) for constraint in constraints]
    violations = [
        _violation_summary(constraint, violation) for constraint in constraints for violation in ((constraint.get('status') or {}).get('violations') or [])
    ]
    _sort_violations(violations, 'constraint')
    template_summaries = [_template_summary(template, constraint_summaries) for template in templates]

    context.update(
        {
            'api_versions': {
                'constraint_templates': template_version,
                'constraints': sorted({constraint.get('version') for constraint in constraint_summaries if constraint.get('version')}),
                'configs': 'v1alpha1',
            },
            'counts': {
                'constraint_templates': len(template_summaries),
                'constraints': len(constraint_summaries),
                'violations': len(violations),
                'configs': len(configs),
            },
            'constraint_templates': [
                {
                    'name': template['name'],
                    'kind': template['kind'],
                    'constraint_count': template['constraint_count'],
                    'targets': [target.get('target') for target in template.get('targets') or [] if target.get('target')],
                    'errors': template.get('errors') or [],
                }
                for template in sorted(template_summaries, key=lambda item: item['name'])[:20]
            ],
            'constraints': [
                {
                    'kind': constraint['kind'],
                    'name': constraint['name'],
                    'enforcement_action': constraint['enforcement_action'],
                    'total_violations': constraint['total_violations'],
                    'parameters': constraint['parameters'],
                    'match': constraint['match'],
                }
                for constraint in sorted(constraint_summaries, key=lambda item: (-int(item.get('total_violations') or 0), item['kind'], item['name']))[:40]
            ],
            'violations': violations[:40],
            'configs': [_config_summary(config) for config in configs[:10]],
            'errors': errors,
        }
    )
    return context


def _gatekeeper_ai_system_prompt(user, gatekeeper_context, ui_context):
    awx_context = _ai_authoring_context(user)
    return (
        'You author Open Policy Agent Gatekeeper Kubernetes manifests for AWX. '
        'Return only one YAML Kubernetes object. No markdown fences. No prose.\n\n'
        'Supported objects: templates.gatekeeper.sh/v1 or v1beta1 ConstraintTemplate, constraints.gatekeeper.sh constraints, '
        'and config.gatekeeper.sh/v1alpha1 Config. Do not return lists, Helm charts, kubectl commands, or placeholders.\n'
        'Use existing ConstraintTemplate kinds from Gatekeeper context when writing Constraints. If creating a new policy, prefer a '
        'ConstraintTemplate with a clear Rego package, input.review checks, and an openAPIV3Schema for parameters. '
        'Use enforcementAction deny unless the user explicitly asks for dryrun or warn. Do not include secrets, tokens, kubeconfig data, '
        'private keys, or credential values. Scope matches and parameters to visible AWX/Gatekeeper context when relevant.\n\n'
        f'Visible AWX context:\n{json.dumps(_json_safe(awx_context), indent=2)}\n\n'
        f'Visible Gatekeeper context:\n{json.dumps(_json_safe(gatekeeper_context), indent=2)}\n\n'
        f'UI context:\n{json.dumps(_json_safe(ui_context or {}), indent=2)}'
    )


def _gatekeeper_ai_provider_response(request, prompt, gatekeeper_context, ui_context):
    if not getattr(settings, 'AI_ENABLED', False):
        raise AIProviderError(
            _('The AI assistant is not enabled. Enable it in Settings → AI Assistant.'),
            status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    rate_limit = getattr(settings, 'AI_RATE_LIMIT_PER_MINUTE', 20)
    if not _check_rate_limit(request.user.pk, rate_limit):
        raise AIProviderError(_('Rate limit exceeded. Please wait before sending another message.'), status.HTTP_429_TOO_MANY_REQUESTS)

    provider = getattr(settings, 'AI_PROVIDER', 'openai')
    api_key = getattr(settings, 'AI_API_KEY', '')
    if provider != 'openai_codex' and not api_key:
        raise AIProviderError(_('AI_API_KEY is not configured. Set it in Settings → AI Assistant.'), status.HTTP_503_SERVICE_UNAVAILABLE)

    defaults = _PROVIDER_DEFAULTS.get(provider, _PROVIDER_DEFAULTS['openai'])
    model = _openai_codex_effective_default_model() if provider == 'openai_codex' else getattr(settings, 'AI_MODEL_NAME', '') or defaults['model']
    content = _call_ai_provider(
        provider,
        model,
        [{'role': 'user', 'content': prompt}],
        min(getattr(settings, 'AI_MAX_TOKENS', 2048), 4096),
        _gatekeeper_ai_system_prompt(request.user, gatekeeper_context, ui_context),
        api_key,
        getattr(settings, 'AI_API_URL', ''),
    )
    return content, provider, model


def _gatekeeper_remediation_system_prompt(user, gatekeeper_context, violation, target, before):
    awx_context = _ai_authoring_context(user)
    visible_before = {
        'apiVersion': before.get('apiVersion') if isinstance(before, dict) else '',
        'kind': before.get('kind') if isinstance(before, dict) else '',
        'metadata': {
            'name': ((before.get('metadata') or {}).get('name') if isinstance(before, dict) else '') or '',
            'namespace': ((before.get('metadata') or {}).get('namespace') if isinstance(before, dict) else '') or '',
            'labels': ((before.get('metadata') or {}).get('labels') if isinstance(before, dict) else {}) or {},
            'annotations': ((before.get('metadata') or {}).get('annotations') if isinstance(before, dict) else {}) or {},
        },
    }
    return (
        'You propose safe remediations for Open Policy Agent Gatekeeper violations in AWX. '
        'Return only one JSON object. No markdown fences. No prose outside JSON.\n\n'
        'Schema:\n'
        '{\n'
        '  "summary": "short human explanation",\n'
        '  "rationale": "why this fixes the violation",\n'
        '  "risk": "low|medium|high",\n'
        '  "target": {"api_version": "...", "kind": "...", "namespace": "...", "name": "..."},\n'
        '  "patch_type": "merge",\n'
        '  "patch": {"metadata": {"labels": {"key": "value"}, "annotations": {"key": "value"}}},\n'
        '  "manual_steps": ["optional fallback steps"]\n'
        '}\n\n'
        'Automatic patches may only add or update metadata.labels or metadata.annotations on the exact target. '
        'Do not include spec changes, deletes, kubectl commands, shell commands, secrets, tokens, kubeconfig content, private keys, '
        'or placeholders that require secret values. If the violation cannot be safely remediated with metadata labels or annotations, '
        'set "patch" to null and provide manual_steps instead. Use existing labels or annotations when possible. For missing required '
        'label values with no better context, use "awx-remediated".\n\n'
        f'Visible AWX context:\n{json.dumps(_json_safe(awx_context), indent=2)}\n\n'
        f'Visible Gatekeeper context:\n{json.dumps(_json_safe(gatekeeper_context), indent=2)}\n\n'
        f'Selected violation:\n{json.dumps(_json_safe(violation), indent=2)}\n\n'
        f'Selected target:\n{json.dumps(_json_safe(_safe_gatekeeper_target(target)), indent=2)}\n\n'
        f'Current resource metadata:\n{json.dumps(_json_safe(visible_before), indent=2)}'
    )


def _gatekeeper_ai_remediation_response(request, violation, target, before, gatekeeper_context):
    if not getattr(settings, 'AI_ENABLED', False):
        raise AIProviderError(
            _('The AI assistant is not enabled. Enable it in Settings → AI Assistant.'),
            status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    rate_limit = getattr(settings, 'AI_RATE_LIMIT_PER_MINUTE', 20)
    if not _check_rate_limit(request.user.pk, rate_limit):
        raise AIProviderError(_('Rate limit exceeded. Please wait before sending another message.'), status.HTTP_429_TOO_MANY_REQUESTS)

    provider = getattr(settings, 'AI_PROVIDER', 'openai')
    api_key = getattr(settings, 'AI_API_KEY', '')
    if provider != 'openai_codex' and not api_key:
        raise AIProviderError(_('AI_API_KEY is not configured. Set it in Settings → AI Assistant.'), status.HTTP_503_SERVICE_UNAVAILABLE)

    defaults = _PROVIDER_DEFAULTS.get(provider, _PROVIDER_DEFAULTS['openai'])
    model = _openai_codex_effective_default_model() if provider == 'openai_codex' else getattr(settings, 'AI_MODEL_NAME', '') or defaults['model']
    user_prompt = (
        'Explain this Gatekeeper violation and propose the safest remediation plan for the exact Kubernetes resource. ' 'Return the strict JSON schema only.'
    )
    content = _call_ai_provider(
        provider,
        model,
        [{'role': 'user', 'content': user_prompt}],
        min(getattr(settings, 'AI_MAX_TOKENS', 2048), 2048),
        _gatekeeper_remediation_system_prompt(request.user, gatekeeper_context, violation, target, before),
        api_key,
        getattr(settings, 'AI_API_URL', ''),
    )
    return content, provider, model


def _load_gatekeeper_remediation_plan(value):
    if isinstance(value, dict):
        return value, None
    if isinstance(value, str) and value.strip():
        try:
            loaded = json.loads(_strip_gatekeeper_ai_fences(value))
        except ValueError as exc:
            return None, _('AI generated invalid remediation JSON: %(error)s') % {'error': exc}
        if isinstance(loaded, dict):
            return loaded, None
    return None, _('remediation_plan must be a JSON object.')


def _audit_gatekeeper_ai_author(request, prompt_summary, manifest, target, provider, model, gatekeeper_context):
    changes = {
        'triggered_by': 'gatekeeper_policy_manager',
        'source': 'gatekeeper_ai_author',
        'prompt_summary': prompt_summary,
        'provider': provider,
        'model': model,
        'target': _safe_gatekeeper_target(target) if target else None,
        'manifest_sha256': _json_sha256(manifest),
        'gatekeeper_counts': gatekeeper_context.get('counts') or {},
        'is_error': False,
    }
    entry = ActivityStream.objects.create(
        operation='create',
        object1='gatekeeper_resource',
        object2=f"ai_author:{manifest.get('kind')}/{_object_name(manifest)}",
        changes=json.dumps(_json_safe(changes)),
        actor=request.user,
    )
    entry.user.add(request.user)
    return {
        'activity_stream_id': entry.pk,
        'activity_stream_url': f'/api/v2/activity_stream/{entry.pk}/',
    }


def _audit_gatekeeper_remediation(
    request,
    mode,
    target,
    plan,
    before=None,
    after=None,
    error='',
    opa_allowed=True,
    provider='',
    model='',
):
    changes = {
        'triggered_by': 'gatekeeper_policy_manager',
        'source': 'gatekeeper_remediation',
        'mode': mode,
        'operation': 'remediate',
        'target': _safe_gatekeeper_target(target),
        'provider': provider,
        'model': model,
        'summary': plan.get('summary') if isinstance(plan, dict) else '',
        'can_apply': bool((plan or {}).get('can_apply')) if isinstance(plan, dict) else False,
        'patch_sha256': _json_sha256((plan or {}).get('patch') if isinstance(plan, dict) else None),
        'opa_allowed': bool(opa_allowed),
        'is_error': bool(error),
        'before_sha256': _json_sha256(before),
        'after_sha256': _json_sha256(after),
        'rollback_plan': _rollback_plan(target, before),
    }
    if error:
        changes['error'] = str(error)
    operation = 'create' if mode == 'preview' else 'update'
    entry = ActivityStream.objects.create(
        operation=operation,
        object1='gatekeeper_remediation',
        object2=f"{target['kind']}/{target['name']}",
        changes=json.dumps(_json_safe(changes)),
        actor=request.user,
    )
    entry.user.add(request.user)
    return {
        'activity_stream_id': entry.pk,
        'activity_stream_url': f'/api/v2/activity_stream/{entry.pk}/',
    }


class GatekeeperPolicyAuthorView(GatekeeperModuleAPIView):
    """
    POST /api/v2/opa/gatekeeper/author/

    Generate one Gatekeeper manifest from AI using visible AWX and Gatekeeper context.
    """

    permission_classes = [PolicyAsCodeAuthorPermission]

    def post(self, request, *args, **kwargs):
        prompt = request.data.get('prompt')
        if not isinstance(prompt, str) or not prompt.strip():
            return Response({'detail': _('prompt must be a non-empty string.')}, status=status.HTTP_400_BAD_REQUEST)
        prompt = prompt.strip()
        if len(prompt) > GATEKEEPER_AI_PROMPT_LIMIT:
            return Response({'detail': _('prompt is too long.')}, status=status.HTTP_400_BAD_REQUEST)

        client = GatekeeperKubernetesClient(_requested_gatekeeper_context(request))
        if client.context_error:
            return Response({'detail': client.context_error, 'contexts': client.context_options()}, status=status.HTTP_400_BAD_REQUEST)
        ui_context = request.data.get('context') if isinstance(request.data.get('context'), dict) else {}
        gatekeeper_context = _gatekeeper_context_for_ai(client)

        try:
            content, provider, model = _gatekeeper_ai_provider_response(request, prompt, gatekeeper_context, ui_context)
        except AIProviderError as exc:
            return Response({'detail': exc.detail}, status=exc.status_code)

        manifest_text = _strip_gatekeeper_ai_fences(content)
        manifest, error = _load_gatekeeper_manifest(manifest_text)
        if error:
            return Response({'detail': _('AI generated invalid Gatekeeper manifest: %(error)s') % {'error': error}}, status=status.HTTP_400_BAD_REQUEST)

        target = None
        if client.is_configured():
            try:
                target = _gatekeeper_target(client, manifest)
            except (ValueError, requests.RequestException) as exc:
                return Response({'detail': _('AI generated unsupported Gatekeeper manifest: %(error)s') % {'error': exc}}, status=status.HTTP_400_BAD_REQUEST)

        prompt_summary = _summarize_gatekeeper_prompt(prompt)
        audit = _audit_gatekeeper_ai_author(request, prompt_summary, manifest, target, provider, model, gatekeeper_context)

        return Response(
            {
                'generated': True,
                'prompt_summary': prompt_summary,
                'manifest': _gatekeeper_manifest_yaml(manifest),
                'manifest_json': manifest,
                'target': _safe_gatekeeper_target(target) if target else None,
                'provider': provider,
                'model': model,
                'context': {
                    'gatekeeper': {
                        'configured': gatekeeper_context.get('configured'),
                        'counts': gatekeeper_context.get('counts') or {},
                        'errors': gatekeeper_context.get('errors') or [],
                    }
                },
                'audit': audit,
            }
        )


class GatekeeperPolicyRemediationView(GatekeeperModuleAPIView):
    """
    POST /api/v2/opa/gatekeeper/remediate/

    Explain a selected Gatekeeper violation with AI, then dry-run or apply a
    validated metadata remediation patch with OPA gating and audit.
    """

    permission_classes = [GatekeeperGovernedWritePermission]

    def post(self, request, *args, **kwargs):
        client = GatekeeperKubernetesClient(_requested_gatekeeper_context(request))
        if client.context_error:
            return Response({'detail': client.context_error, 'contexts': client.context_options()}, status=status.HTTP_400_BAD_REQUEST)
        if not client.is_configured():
            return Response({'detail': _('Configure the Gatekeeper Kubernetes API connection in Settings.')}, status=status.HTTP_400_BAD_REQUEST)

        mode = str(request.data.get('mode') or 'preview').strip().lower()
        if mode not in GATEKEEPER_REMEDIATION_MODES:
            return Response({'detail': _('mode must be preview, dry_run, or apply.')}, status=status.HTTP_400_BAD_REQUEST)

        violation = request.data.get('violation')
        try:
            target, error = _kubernetes_target_from_violation(client, violation)
            if error:
                return Response({'detail': error}, status=status.HTTP_400_BAD_REQUEST)
            before = client.get_or_none(target['object_path'])
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except requests.RequestException as exc:
            return _gatekeeper_http_error_response(exc)

        if before is None:
            return Response(
                {'detail': _('Violation target resource was not found.'), 'target': _safe_gatekeeper_target(target)}, status=status.HTTP_404_NOT_FOUND
            )

        provider = ''
        model = ''
        raw_plan = request.data.get('remediation_plan')
        if raw_plan is not None and raw_plan != '':
            loaded_plan, error = _load_gatekeeper_remediation_plan(raw_plan)
        else:
            if mode != 'preview':
                return Response({'detail': _('remediation_plan is required for dry_run or apply.')}, status=status.HTTP_400_BAD_REQUEST)
            gatekeeper_context = _gatekeeper_context_for_ai(client)
            try:
                content, provider, model = _gatekeeper_ai_remediation_response(request, violation, target, before, gatekeeper_context)
            except AIProviderError as exc:
                return Response({'detail': exc.detail}, status=exc.status_code)
            loaded_plan, error = _load_gatekeeper_remediation_plan(content)
        if error:
            return Response({'detail': error}, status=status.HTTP_400_BAD_REQUEST)

        plan, error = _normalize_remediation_plan(loaded_plan, target)
        if error:
            return Response({'detail': error}, status=status.HTTP_400_BAD_REQUEST)

        after = _json_merge_patch(before, plan['patch']) if plan['can_apply'] else before
        diff = _manifest_diff(before, after) if plan['can_apply'] else ''
        rollback_plan = _rollback_plan(target, before)
        opa_allowed = None
        kubernetes_response = None
        audit = None

        if mode == 'preview':
            audit = _audit_gatekeeper_remediation(request, mode, target, plan, before=before, after=after, provider=provider, model=model)
        else:
            if not plan['can_apply']:
                return Response({'detail': _('Remediation plan does not contain a safe automatic patch.'), 'plan': plan}, status=status.HTTP_400_BAD_REQUEST)

            opa_input = _gatekeeper_opa_input(request, mode, 'update', target, after, source='gatekeeper_remediation')
            opa_input['violation'] = _json_safe(violation)
            opa_input['patch'] = plan['patch']
            opa_allowed = check_opa_policy('awx/gatekeeper_resource/allow', opa_input)
            if not opa_allowed:
                audit = _audit_gatekeeper_remediation(
                    request,
                    mode,
                    target,
                    plan,
                    before=before,
                    after=after,
                    error='Denied by OPA policy guardrail.',
                    opa_allowed=False,
                    provider=provider,
                    model=model,
                )
                return Response(
                    {
                        'detail': _('Gatekeeper remediation denied by OPA policy guardrail.'),
                        'mode': mode,
                        'operation': 'remediate',
                        'target': _safe_gatekeeper_target(target),
                        'plan': plan,
                        'opa_allowed': False,
                        'audit': audit,
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )

            try:
                kubernetes_response = client.write(
                    'PATCH',
                    target['object_path'],
                    plan['patch'],
                    dry_run=mode == 'dry_run',
                    content_type='application/merge-patch+json',
                )
            except requests.RequestException as exc:
                _audit_gatekeeper_remediation(
                    request,
                    mode,
                    target,
                    plan,
                    before=before,
                    after=after,
                    error=exc,
                    opa_allowed=opa_allowed is not False,
                    provider=provider,
                    model=model,
                )
                return _gatekeeper_http_error_response(exc)

            audit = _audit_gatekeeper_remediation(
                request,
                mode,
                target,
                plan,
                before=before,
                after=kubernetes_response if mode == 'apply' else after,
                opa_allowed=opa_allowed is not False,
                provider=provider,
                model=model,
            )

        return Response(
            {
                'changed': mode == 'apply' and plan['can_apply'],
                'persisted': mode == 'apply' and plan['can_apply'],
                'dry_run': mode == 'dry_run',
                'mode': mode,
                'operation': 'remediate',
                'target': _safe_gatekeeper_target(target),
                'plan': plan,
                'before_exists': True,
                'before_sha256': _json_sha256(before),
                'after_sha256': _json_sha256(after),
                'diff': diff,
                'rollback_plan': rollback_plan,
                'opa_allowed': opa_allowed,
                'kubernetes_response': kubernetes_response,
                'audit': audit,
                'provider': provider,
                'model': model,
            }
        )


class GatekeeperProjectSyncView(GatekeeperModuleAPIView):
    """
    POST /api/v2/opa/gatekeeper/project-sync/

    Discover Gatekeeper manifests from an already-synced AWX Project checkout
    and preview, dry-run, or apply them through the same governed write path.
    """

    permission_classes = [GatekeeperGovernedWritePermission]

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

    def _process_manifest(self, request, client, mode, apply_options, project_source, entry):
        manifest = entry['manifest']
        try:
            target = _gatekeeper_target(client, manifest)
            before = client.get_or_none(target['object_path'])
        except ValueError as exc:
            return None, Response(
                {
                    'detail': str(exc),
                    'file_path': entry['file_path'],
                    'document_index': entry['document_index'],
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        except requests.RequestException as exc:
            return None, _gatekeeper_http_error_response(exc)

        operation = 'update' if before else 'create'
        diff = _manifest_diff(before, manifest)
        rollback_plan = _rollback_plan(target, before)
        item_project_source = {
            **project_source,
            'file_path': entry['file_path'],
            'document_index': entry['document_index'],
        }
        item = {
            'file_path': entry['file_path'],
            'document_index': entry['document_index'],
            'manifest': manifest,
            'manifest_yaml': entry['manifest_yaml'],
            'mode': mode,
            'operation': operation,
            'target': _safe_gatekeeper_target(target),
            'before_exists': before is not None,
            'before_sha256': _json_sha256(before),
            'after_sha256': _json_sha256(manifest),
            'diff': diff,
            'rollback_plan': rollback_plan,
            'opa_allowed': None,
            'kubernetes_response': None,
            'audit': None,
        }

        if mode not in ('dry_run', 'apply'):
            return item, None

        opa_input = _gatekeeper_opa_input(
            request,
            mode,
            operation,
            target,
            manifest,
            source='gatekeeper_project_sync',
            apply_options=apply_options,
        )
        opa_input['project_source'] = item_project_source
        opa_allowed = check_opa_policy('awx/gatekeeper_resource/allow', opa_input)
        item['opa_allowed'] = opa_allowed
        if not opa_allowed:
            audit = _audit_gatekeeper_apply(
                request,
                mode,
                operation,
                target,
                before=before,
                after=manifest,
                error='Denied by OPA policy guardrail.',
                opa_allowed=False,
                source='gatekeeper_project_sync',
                apply_options=apply_options,
                project_source=item_project_source,
            )
            item['audit'] = audit
            item['error'] = _('Denied by OPA policy guardrail.')
            return None, Response(
                {
                    'detail': _('Gatekeeper project sync denied by OPA policy guardrail.'),
                    'mode': mode,
                    'project_source': item_project_source,
                    'result': item,
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            kubernetes_response = _gatekeeper_write_manifest(client, target, manifest, before, mode, apply_options)
        except requests.RequestException as exc:
            _audit_gatekeeper_apply(
                request,
                mode,
                operation,
                target,
                before=before,
                after=manifest,
                error=exc,
                opa_allowed=opa_allowed is not False,
                source='gatekeeper_project_sync',
                apply_options=apply_options,
                project_source=item_project_source,
            )
            return None, _gatekeeper_http_error_response(exc)

        audit = _audit_gatekeeper_apply(
            request,
            mode,
            operation,
            target,
            before=before,
            after=kubernetes_response if mode == 'apply' else manifest,
            opa_allowed=opa_allowed is not False,
            source='gatekeeper_project_sync',
            apply_options=apply_options,
            project_source=item_project_source,
        )
        item['kubernetes_response'] = kubernetes_response
        item['audit'] = audit
        return item, None

    def post(self, request, *args, **kwargs):
        client = GatekeeperKubernetesClient(_requested_gatekeeper_context(request))
        if client.context_error:
            return Response({'detail': client.context_error, 'contexts': client.context_options()}, status=status.HTTP_400_BAD_REQUEST)
        if not client.is_configured():
            return Response({'detail': _('Configure the Gatekeeper Kubernetes API connection in Settings.')}, status=status.HTTP_400_BAD_REQUEST)

        mode = str(request.data.get('mode') or 'preview').strip().lower()
        if mode not in GATEKEEPER_APPLY_MODES:
            return Response({'detail': _('mode must be preview, dry_run, or apply.')}, status=status.HTTP_400_BAD_REQUEST)

        apply_options, error = _gatekeeper_apply_options(request)
        if error:
            return Response({'detail': error}, status=status.HTTP_400_BAD_REQUEST)

        project_id = request.data.get('project') or request.data.get('project_id')
        project, error = _project_for_gatekeeper_sync(request.user, project_id)
        if error:
            return Response({'detail': error}, status=status.HTTP_400_BAD_REQUEST)

        requested_path = request.data.get('path') or request.data.get('manifest_path') or ''
        entries, error = _load_project_gatekeeper_manifests(project, requested_path)
        if error:
            return Response({'detail': error}, status=status.HTTP_400_BAD_REQUEST)

        project_source = _project_source(project, requested_path or ','.join(GATEKEEPER_PROJECT_SYNC_DEFAULT_PATTERNS))
        results = []
        for entry in entries:
            result, response = self._process_manifest(request, client, mode, apply_options, project_source, entry)
            if response is not None:
                return response
            results.append(result)

        changed = mode == 'apply' and bool(results)
        return Response(
            {
                'changed': changed,
                'persisted': changed,
                'dry_run': mode == 'dry_run',
                'mode': mode,
                'project': self._project_payload(project),
                'project_source': project_source,
                'apply_strategy': apply_options['strategy'],
                'field_manager': apply_options['field_manager'],
                'force_conflicts': apply_options['force_conflicts'],
                'counts': {
                    'files': len({entry['file_path'] for entry in entries}),
                    'manifests': len(results),
                    'created': len([result for result in results if result['operation'] == 'create']),
                    'updated': len([result for result in results if result['operation'] == 'update']),
                },
                'results': results,
            }
        )


class GatekeeperPolicyManagerView(GatekeeperModuleAPIView):
    """
    GET /api/v2/opa/gatekeeper/

    Read Gatekeeper ConstraintTemplates, Constraints, Configs, and violations
    from the configured Kubernetes API.
    """

    permission_classes = [PolicyAsCodeOperatePermission]

    def get(self, request, *args, **kwargs):
        client = GatekeeperKubernetesClient(_requested_gatekeeper_context(request))
        if client.context_error:
            return Response({'detail': client.context_error, 'contexts': client.context_options()}, status=status.HTTP_400_BAD_REQUEST)
        if not client.is_configured():
            return Response(
                {
                    'configured': False,
                    'contexts': client.context_options(),
                    'cluster': {
                        'server_url': '',
                        'context': client.context,
                        'verify_ssl': client.verify_ssl,
                    },
                    'counts': {
                        'constraint_templates': 0,
                        'constraints': 0,
                        'violations': 0,
                        'filtered_violations': 0,
                        'configs': 0,
                    },
                    'violation_query': {
                        'search': '',
                        'sort': 'constraint',
                        'limit': 50,
                        'page': 1,
                        'offset': 0,
                        'total_pages': 1,
                        'returned': 0,
                    },
                    'constraint_templates': [],
                    'constraints': [],
                    'violations': [],
                    'configs': [],
                    'errors': [],
                    'message': _('Configure the Gatekeeper Kubernetes API connection in Settings.'),
                }
            )

        try:
            template_version, templates = client.list_constraint_templates()
            constraints, errors = client.list_constraint_resources()
            try:
                configs = client.list_configs()
            except requests.HTTPError as exc:
                response = getattr(exc, 'response', None)
                if response is None or response.status_code != 404:
                    raise
                configs = []
                errors.append(_gatekeeper_error('configs', exc))
        except requests.RequestException as exc:
            return _gatekeeper_http_error_response(exc)

        constraint_summaries = [_constraint_summary(constraint) for constraint in constraints]
        violations_all = [
            _violation_summary(constraint, violation) for constraint in constraints for violation in ((constraint.get('status') or {}).get('violations') or [])
        ]
        violation_search = (request.query_params.get('violation_search') or '').strip().lower()
        violation_sort = (request.query_params.get('violation_sort') or 'constraint').strip().lower()
        violation_limit = _positive_int_query(request, 'violation_limit', 50, 500)
        violation_page = _positive_int_query(request, 'violation_page', 1, 100000)
        if violation_search:
            violations = [violation for violation in violations_all if violation_search in _violation_search_text(violation)]
        else:
            violations = list(violations_all)
        _sort_violations(violations, violation_sort)
        violation_total_pages = max(1, (len(violations) + violation_limit - 1) // violation_limit)
        violation_page = min(violation_page, violation_total_pages)
        violation_offset = (violation_page - 1) * violation_limit
        page_violations = violations[violation_offset : violation_offset + violation_limit]
        constraint_summaries.sort(key=lambda item: (-int(item.get('total_violations') or 0), item['kind'], item['name']))

        return Response(
            {
                'configured': True,
                'contexts': client.context_options(),
                'cluster': {
                    'server_url': client.server_url,
                    'context': client.context,
                    'verify_ssl': client.verify_ssl,
                },
                'api_versions': {
                    'constraint_templates': template_version,
                    'constraints': sorted({constraint.get('version') for constraint in constraint_summaries if constraint.get('version')}),
                    'configs': 'v1alpha1',
                },
                'counts': {
                    'constraint_templates': len(templates),
                    'constraints': len(constraint_summaries),
                    'violations': len(violations_all),
                    'filtered_violations': len(violations),
                    'configs': len(configs),
                },
                'violation_query': {
                    'search': violation_search,
                    'sort': violation_sort,
                    'limit': violation_limit,
                    'page': violation_page,
                    'offset': violation_offset,
                    'total_pages': violation_total_pages,
                    'returned': len(page_violations),
                },
                'constraint_templates': sorted(
                    [_template_summary(template, constraint_summaries) for template in templates],
                    key=lambda item: item['name'],
                ),
                'constraints': constraint_summaries,
                'violations': page_violations,
                'configs': sorted([_config_summary(config) for config in configs], key=lambda item: item['name']),
                'errors': errors,
            }
        )


class GatekeeperPolicyApplyView(GatekeeperModuleAPIView):
    """
    POST /api/v2/opa/gatekeeper/apply/

    Preview, dry-run, or apply one Gatekeeper manifest with OPA gating and audit.
    """

    permission_classes = [GatekeeperGovernedWritePermission]

    def post(self, request, *args, **kwargs):
        client = GatekeeperKubernetesClient(_requested_gatekeeper_context(request))
        if client.context_error:
            return Response({'detail': client.context_error, 'contexts': client.context_options()}, status=status.HTTP_400_BAD_REQUEST)
        if not client.is_configured():
            return Response({'detail': _('Configure the Gatekeeper Kubernetes API connection in Settings.')}, status=status.HTTP_400_BAD_REQUEST)

        mode = str(request.data.get('mode') or 'preview').strip().lower()
        if mode not in GATEKEEPER_APPLY_MODES:
            return Response({'detail': _('mode must be preview, dry_run, or apply.')}, status=status.HTTP_400_BAD_REQUEST)

        apply_options, error = _gatekeeper_apply_options(request)
        if error:
            return Response({'detail': error}, status=status.HTTP_400_BAD_REQUEST)

        manifest, error = _load_gatekeeper_manifest(request.data.get('manifest'))
        if error:
            return Response({'detail': error}, status=status.HTTP_400_BAD_REQUEST)

        try:
            target = _gatekeeper_target(client, manifest)
            before = client.get_or_none(target['object_path'])
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except requests.RequestException as exc:
            return _gatekeeper_http_error_response(exc)

        operation = 'update' if before else 'create'
        diff = _manifest_diff(before, manifest)
        rollback_plan = _rollback_plan(target, before)
        opa_allowed = None
        audit = None

        if mode in ('dry_run', 'apply'):
            opa_input = _gatekeeper_opa_input(request, mode, operation, target, manifest, apply_options=apply_options)
            opa_allowed = check_opa_policy('awx/gatekeeper_resource/allow', opa_input)
            if not opa_allowed:
                audit = _audit_gatekeeper_apply(
                    request,
                    mode,
                    operation,
                    target,
                    before=before,
                    after=manifest,
                    error='Denied by OPA policy guardrail.',
                    opa_allowed=False,
                    apply_options=apply_options,
                )
                return Response(
                    {
                        'detail': _('Gatekeeper change denied by OPA policy guardrail.'),
                        'mode': mode,
                        'operation': operation,
                        'target': _safe_gatekeeper_target(target),
                        'apply_strategy': apply_options['strategy'],
                        'field_manager': apply_options['field_manager'],
                        'force_conflicts': apply_options['force_conflicts'],
                        'opa_allowed': False,
                        'audit': audit,
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )

        kubernetes_response = None
        if mode in ('dry_run', 'apply'):
            try:
                kubernetes_response = _gatekeeper_write_manifest(client, target, manifest, before, mode, apply_options)
            except requests.RequestException as exc:
                _audit_gatekeeper_apply(
                    request,
                    mode,
                    operation,
                    target,
                    before=before,
                    after=manifest,
                    error=exc,
                    opa_allowed=opa_allowed is not False,
                    apply_options=apply_options,
                )
                return _gatekeeper_http_error_response(exc)

            audit = _audit_gatekeeper_apply(
                request,
                mode,
                operation,
                target,
                before=before,
                after=kubernetes_response if mode == 'apply' else manifest,
                opa_allowed=opa_allowed is not False,
                apply_options=apply_options,
            )

        return Response(
            {
                'changed': mode == 'apply',
                'persisted': mode == 'apply',
                'dry_run': mode == 'dry_run',
                'mode': mode,
                'operation': operation,
                'target': _safe_gatekeeper_target(target),
                'apply_strategy': apply_options['strategy'],
                'field_manager': apply_options['field_manager'],
                'force_conflicts': apply_options['force_conflicts'],
                'before_exists': before is not None,
                'before_sha256': _json_sha256(before),
                'after_sha256': _json_sha256(manifest),
                'diff': diff,
                'rollback_plan': rollback_plan,
                'opa_allowed': opa_allowed,
                'kubernetes_response': kubernetes_response,
                'audit': audit,
            }
        )


class GatekeeperPolicyDeleteView(GatekeeperModuleAPIView):
    """
    POST /api/v2/opa/gatekeeper/delete/

    Preview, dry-run, or delete one Gatekeeper resource with OPA gating and audit.
    """

    permission_classes = [GatekeeperGovernedWritePermission]

    def post(self, request, *args, **kwargs):
        client = GatekeeperKubernetesClient(_requested_gatekeeper_context(request))
        if client.context_error:
            return Response({'detail': client.context_error, 'contexts': client.context_options()}, status=status.HTTP_400_BAD_REQUEST)
        if not client.is_configured():
            return Response({'detail': _('Configure the Gatekeeper Kubernetes API connection in Settings.')}, status=status.HTTP_400_BAD_REQUEST)

        mode = str(request.data.get('mode') or 'preview').strip().lower()
        if mode not in GATEKEEPER_DELETE_MODES:
            return Response({'detail': _('mode must be preview, dry_run, or delete.')}, status=status.HTTP_400_BAD_REQUEST)

        manifest = None
        try:
            if request.data.get('manifest'):
                manifest, error = _load_gatekeeper_manifest(request.data.get('manifest'))
                if error:
                    return Response({'detail': error}, status=status.HTTP_400_BAD_REQUEST)
                target = _gatekeeper_target(client, manifest)
            else:
                target, error = _gatekeeper_target_from_payload(client, request.data.get('target'))
                if error:
                    return Response({'detail': error}, status=status.HTTP_400_BAD_REQUEST)
            before = client.get_or_none(target['object_path'])
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except requests.RequestException as exc:
            return _gatekeeper_http_error_response(exc)

        if before is None:
            return Response({'detail': _('Gatekeeper resource was not found.'), 'target': _safe_gatekeeper_target(target)}, status=status.HTTP_404_NOT_FOUND)

        operation = 'delete'
        diff = _manifest_diff(before, None)
        rollback_plan = _rollback_plan(target, before)
        opa_allowed = None
        audit = None
        kubernetes_response = None

        if mode in ('dry_run', 'delete'):
            opa_input = _gatekeeper_opa_input(request, mode, operation, target, manifest or before, source='gatekeeper_delete')
            opa_allowed = check_opa_policy('awx/gatekeeper_resource/allow', opa_input)
            if not opa_allowed:
                audit = _audit_gatekeeper_apply(
                    request,
                    mode,
                    operation,
                    target,
                    before=before,
                    error='Denied by OPA policy guardrail.',
                    opa_allowed=False,
                    source='gatekeeper_delete',
                )
                return Response(
                    {
                        'detail': _('Gatekeeper delete denied by OPA policy guardrail.'),
                        'mode': mode,
                        'operation': operation,
                        'target': _safe_gatekeeper_target(target),
                        'opa_allowed': False,
                        'audit': audit,
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )

            try:
                kubernetes_response = client.delete(target['object_path'], dry_run=mode == 'dry_run')
            except requests.RequestException as exc:
                _audit_gatekeeper_apply(
                    request,
                    mode,
                    operation,
                    target,
                    before=before,
                    error=exc,
                    opa_allowed=opa_allowed is not False,
                    source='gatekeeper_delete',
                )
                return _gatekeeper_http_error_response(exc)

            audit = _audit_gatekeeper_apply(
                request,
                mode,
                operation,
                target,
                before=before,
                opa_allowed=opa_allowed is not False,
                source='gatekeeper_delete',
            )

        return Response(
            {
                'changed': mode == 'delete',
                'persisted': mode == 'delete',
                'dry_run': mode == 'dry_run',
                'mode': mode,
                'operation': operation,
                'target': _safe_gatekeeper_target(target),
                'before_exists': True,
                'before_sha256': _json_sha256(before),
                'after_sha256': '',
                'diff': diff,
                'rollback_plan': rollback_plan,
                'opa_allowed': opa_allowed,
                'kubernetes_response': kubernetes_response,
                'audit': audit,
            }
        )


class GatekeeperPolicyRollbackView(GatekeeperModuleAPIView):
    """
    POST /api/v2/opa/gatekeeper/rollback/

    Preview, dry-run, or execute an apply/delete rollback plan.
    """

    permission_classes = [GatekeeperGovernedWritePermission]

    def post(self, request, *args, **kwargs):
        client = GatekeeperKubernetesClient(_requested_gatekeeper_context(request))
        if client.context_error:
            return Response({'detail': client.context_error, 'contexts': client.context_options()}, status=status.HTTP_400_BAD_REQUEST)
        if not client.is_configured():
            return Response({'detail': _('Configure the Gatekeeper Kubernetes API connection in Settings.')}, status=status.HTTP_400_BAD_REQUEST)

        mode = str(request.data.get('mode') or 'preview').strip().lower()
        if mode not in GATEKEEPER_ROLLBACK_MODES:
            return Response({'detail': _('mode must be preview, dry_run, or apply.')}, status=status.HTTP_400_BAD_REQUEST)

        apply_options, error = _gatekeeper_apply_options(request)
        if error:
            return Response({'detail': error}, status=status.HTTP_400_BAD_REQUEST)

        plan = request.data.get('rollback_plan')
        if not isinstance(plan, dict):
            return Response({'detail': _('rollback_plan must be a JSON object.')}, status=status.HTTP_400_BAD_REQUEST)

        plan_operation = str(plan.get('operation') or '').strip().lower()
        if plan_operation not in ('restore', 'delete'):
            return Response({'detail': _('rollback_plan.operation must be restore or delete.')}, status=status.HTTP_400_BAD_REQUEST)

        manifest = None
        try:
            if plan_operation == 'restore':
                manifest, error = _load_gatekeeper_manifest(plan.get('manifest'))
                if error:
                    return Response({'detail': error}, status=status.HTTP_400_BAD_REQUEST)
                target = _gatekeeper_target(client, manifest)
            else:
                target, error = _gatekeeper_target_from_payload(client, plan.get('target'))
                if error:
                    return Response({'detail': error}, status=status.HTTP_400_BAD_REQUEST)
            before = client.get_or_none(target['object_path'])
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except requests.RequestException as exc:
            return _gatekeeper_http_error_response(exc)

        operation = f'rollback_{plan_operation}'
        after = manifest if plan_operation == 'restore' else None
        diff = _manifest_diff(before, after)
        opa_allowed = None
        audit = None
        kubernetes_response = None

        if mode in ('dry_run', 'apply'):
            opa_input = _gatekeeper_opa_input(
                request,
                mode,
                operation,
                target,
                manifest or before,
                source='gatekeeper_rollback',
                apply_options=apply_options if plan_operation == 'restore' else None,
            )
            opa_allowed = check_opa_policy('awx/gatekeeper_resource/allow', opa_input)
            if not opa_allowed:
                audit = _audit_gatekeeper_apply(
                    request,
                    mode,
                    operation,
                    target,
                    before=before,
                    after=after,
                    error='Denied by OPA policy guardrail.',
                    opa_allowed=False,
                    source='gatekeeper_rollback',
                    apply_options=apply_options if plan_operation == 'restore' else None,
                )
                return Response(
                    {
                        'detail': _('Gatekeeper rollback denied by OPA policy guardrail.'),
                        'mode': mode,
                        'operation': operation,
                        'target': _safe_gatekeeper_target(target),
                        'apply_strategy': apply_options['strategy'] if plan_operation == 'restore' else None,
                        'field_manager': apply_options['field_manager'] if plan_operation == 'restore' else None,
                        'force_conflicts': apply_options['force_conflicts'] if plan_operation == 'restore' else None,
                        'opa_allowed': False,
                        'audit': audit,
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )

            try:
                if plan_operation == 'restore':
                    kubernetes_response = _gatekeeper_write_manifest(client, target, manifest, before, mode, apply_options)
                elif before:
                    kubernetes_response = client.delete(target['object_path'], dry_run=mode == 'dry_run')
                else:
                    kubernetes_response = {'status_code': 404, 'skipped': True}
            except requests.RequestException as exc:
                _audit_gatekeeper_apply(
                    request,
                    mode,
                    operation,
                    target,
                    before=before,
                    after=after,
                    error=exc,
                    opa_allowed=opa_allowed is not False,
                    source='gatekeeper_rollback',
                    apply_options=apply_options if plan_operation == 'restore' else None,
                )
                return _gatekeeper_http_error_response(exc)

            audit = _audit_gatekeeper_apply(
                request,
                mode,
                operation,
                target,
                before=before,
                after=kubernetes_response if mode == 'apply' and plan_operation == 'restore' else after,
                opa_allowed=opa_allowed is not False,
                source='gatekeeper_rollback',
                apply_options=apply_options if plan_operation == 'restore' else None,
            )

        return Response(
            {
                'changed': mode == 'apply',
                'persisted': mode == 'apply',
                'dry_run': mode == 'dry_run',
                'mode': mode,
                'operation': operation,
                'target': _safe_gatekeeper_target(target),
                'apply_strategy': apply_options['strategy'] if plan_operation == 'restore' else None,
                'field_manager': apply_options['field_manager'] if plan_operation == 'restore' else None,
                'force_conflicts': apply_options['force_conflicts'] if plan_operation == 'restore' else None,
                'before_exists': before is not None,
                'before_sha256': _json_sha256(before),
                'after_sha256': _json_sha256(after),
                'diff': diff,
                'rollback_plan': _rollback_plan(target, before),
                'opa_allowed': opa_allowed,
                'kubernetes_response': kubernetes_response,
                'audit': audit,
            }
        )
