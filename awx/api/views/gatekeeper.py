"""Gatekeeper Policy Manager style API for AWX."""

import difflib
import hashlib
import json
from urllib.parse import urljoin

import requests
import yaml
from django.conf import settings
from django.utils.translation import gettext_lazy as _
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from awx.api.permissions import IsSystemAdmin as IsSuperUser
from awx.api.views.opa import check_opa_policy
from awx.main.models import ActivityStream


GATEKEEPER_TEMPLATE_VERSIONS = ('v1', 'v1beta1')
GATEKEEPER_CONFIG_PATH = '/apis/config.gatekeeper.sh/v1alpha1/configs'
GATEKEEPER_CONSTRAINT_GROUP_PATH = '/apis/constraints.gatekeeper.sh'
GATEKEEPER_APPLY_MODES = ('preview', 'dry_run', 'apply')


class GatekeeperKubernetesClient:
    """Small Kubernetes API client for Gatekeeper CRD reads."""

    def __init__(self):
        self.server_url = (getattr(settings, 'GATEKEEPER_K8S_API_URL', '') or '').strip().rstrip('/')
        self.auth_token = getattr(settings, 'GATEKEEPER_K8S_AUTH_TOKEN', '') or ''
        self.context = getattr(settings, 'GATEKEEPER_K8S_CONTEXT', '') or ''
        self.verify_ssl = bool(getattr(settings, 'GATEKEEPER_K8S_VERIFY_SSL', True))
        self.timeout = max(float(getattr(settings, 'GATEKEEPER_K8S_REQUEST_TIMEOUT', 5) or 5), 1)

    def is_configured(self):
        return bool(self.server_url)

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

    def write(self, method, path, payload, dry_run=False):
        url = urljoin(f'{self.server_url}/', path.lstrip('/'))
        headers = self._headers()
        headers['Content-Type'] = 'application/json'
        response = requests.request(
            method,
            url,
            headers=headers,
            json=payload,
            params={'dryRun': 'All'} if dry_run else None,
            verify=self.verify_ssl,
            timeout=self.timeout,
        )
        response.raise_for_status()
        if getattr(response, 'content', b''):
            return response.json()
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
        discovery = self.get(GATEKEEPER_CONSTRAINT_GROUP_PATH)
        preferred = ((discovery.get('preferredVersion') or {}).get('version') or '').strip()
        versions = [preferred] if preferred else []
        versions.extend(
            version.get('version') for version in discovery.get('versions') or [] if version.get('version') and version.get('version') not in versions
        )

        constraints = []
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


def _split_api_version(api_version):
    if '/' not in api_version:
        return '', api_version
    group, version = api_version.split('/', 1)
    return group, version


def _gatekeeper_target(client, manifest):
    group, version = _split_api_version(manifest.get('apiVersion') or '')
    kind = manifest.get('kind') or ''
    name = _object_name(manifest)
    namespace = _metadata(manifest).get('namespace') or ''

    if group == 'templates.gatekeeper.sh' and kind == 'ConstraintTemplate' and version in GATEKEEPER_TEMPLATE_VERSIONS:
        resource = 'constrainttemplates'
    elif group == 'config.gatekeeper.sh' and kind == 'Config' and version == 'v1alpha1':
        resource = 'configs'
    elif group == 'constraints.gatekeeper.sh' and version:
        resource = client.constraint_resource_name(version, kind)
    else:
        raise ValueError(_('Only Gatekeeper ConstraintTemplate, Constraint, and Config resources are supported.'))

    collection_path = f'/apis/{group}/{version}/{resource}'
    return {
        'api_version': manifest.get('apiVersion') or '',
        'group': group,
        'version': version,
        'resource': resource,
        'kind': kind,
        'name': name,
        'namespace': namespace,
        'collection_path': collection_path,
        'object_path': f'{collection_path}/{name}',
    }


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


def _gatekeeper_opa_input(request, mode, operation, target, manifest):
    return {
        'triggered_by': 'gatekeeper_policy_manager',
        'source': 'gatekeeper_apply',
        'mode': mode,
        'human_approved': bool(request.data.get('human_approved', False)),
        'approval_required': mode == 'apply',
        'user': {
            'id': request.user.pk,
            'username': request.user.username,
            'is_superuser': request.user.is_superuser,
        },
        'operation': operation,
        'resource_type': 'gatekeeper_resource',
        'destructive': mode == 'apply',
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


def _audit_gatekeeper_apply(request, mode, operation, target, before=None, after=None, error='', opa_allowed=True):
    changes = {
        'triggered_by': 'gatekeeper_policy_manager',
        'source': 'gatekeeper_apply',
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
    if error:
        changes['error'] = str(error)
    entry = ActivityStream.objects.create(
        operation='create' if operation == 'create' else 'update',
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


class GatekeeperPolicyManagerView(APIView):
    """
    GET /api/v2/opa/gatekeeper/

    Read Gatekeeper ConstraintTemplates, Constraints, Configs, and violations
    from the configured Kubernetes API.
    """

    permission_classes = [IsSuperUser]

    def get(self, request, *args, **kwargs):
        client = GatekeeperKubernetesClient()
        if not client.is_configured():
            return Response(
                {
                    'configured': False,
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
        if violation_search:
            violations = [violation for violation in violations_all if violation_search in _violation_search_text(violation)]
        else:
            violations = list(violations_all)
        _sort_violations(violations, violation_sort)
        constraint_summaries.sort(key=lambda item: (-int(item.get('total_violations') or 0), item['kind'], item['name']))

        return Response(
            {
                'configured': True,
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
                    'returned': min(len(violations), violation_limit),
                },
                'constraint_templates': sorted(
                    [_template_summary(template, constraint_summaries) for template in templates],
                    key=lambda item: item['name'],
                ),
                'constraints': constraint_summaries,
                'violations': violations[:violation_limit],
                'configs': sorted([_config_summary(config) for config in configs], key=lambda item: item['name']),
                'errors': errors,
            }
        )


class GatekeeperPolicyApplyView(APIView):
    """
    POST /api/v2/opa/gatekeeper/apply/

    Preview, dry-run, or apply one Gatekeeper manifest with OPA gating and audit.
    """

    permission_classes = [IsSuperUser]

    def post(self, request, *args, **kwargs):
        client = GatekeeperKubernetesClient()
        if not client.is_configured():
            return Response({'detail': _('Configure the Gatekeeper Kubernetes API connection in Settings.')}, status=status.HTTP_400_BAD_REQUEST)

        mode = str(request.data.get('mode') or 'preview').strip().lower()
        if mode not in GATEKEEPER_APPLY_MODES:
            return Response({'detail': _('mode must be preview, dry_run, or apply.')}, status=status.HTTP_400_BAD_REQUEST)

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
            opa_input = _gatekeeper_opa_input(request, mode, operation, target, manifest)
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
                )
                return Response(
                    {
                        'detail': _('Gatekeeper change denied by OPA policy guardrail.'),
                        'mode': mode,
                        'operation': operation,
                        'target': _safe_gatekeeper_target(target),
                        'opa_allowed': False,
                        'audit': audit,
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )

        kubernetes_response = None
        if mode in ('dry_run', 'apply'):
            try:
                kubernetes_response = client.write(
                    'PUT' if before else 'POST',
                    target['object_path'] if before else target['collection_path'],
                    manifest,
                    dry_run=mode == 'dry_run',
                )
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
            )

        return Response(
            {
                'changed': mode == 'apply',
                'persisted': mode == 'apply',
                'dry_run': mode == 'dry_run',
                'mode': mode,
                'operation': operation,
                'target': _safe_gatekeeper_target(target),
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
