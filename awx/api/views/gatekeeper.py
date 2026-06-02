"""Read-only Gatekeeper Policy Manager style API for AWX."""

from urllib.parse import urljoin

import requests
from django.conf import settings
from django.utils.translation import gettext_lazy as _
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from awx.api.permissions import IsSystemAdmin as IsSuperUser


GATEKEEPER_TEMPLATE_VERSIONS = ('v1', 'v1beta1')
GATEKEEPER_CONFIG_PATH = '/apis/config.gatekeeper.sh/v1alpha1/configs'
GATEKEEPER_CONSTRAINT_GROUP_PATH = '/apis/constraints.gatekeeper.sh'


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
                        'configs': 0,
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
        violations = [
            _violation_summary(constraint, violation) for constraint in constraints for violation in ((constraint.get('status') or {}).get('violations') or [])
        ]
        violations.sort(
            key=lambda item: (
                item['constraint_kind'],
                item['constraint_name'],
                item['resource_namespace'],
                item['resource_name'],
            )
        )
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
                    'violations': len(violations),
                    'configs': len(configs),
                },
                'constraint_templates': sorted(
                    [_template_summary(template, constraint_summaries) for template in templates],
                    key=lambda item: item['name'],
                ),
                'constraints': constraint_summaries,
                'violations': violations,
                'configs': sorted([_config_summary(config) for config in configs], key=lambda item: item['name']),
                'errors': errors,
            }
        )
