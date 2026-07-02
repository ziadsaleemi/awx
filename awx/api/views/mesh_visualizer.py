# Copyright (c) 2018 Red Hat, Inc.
# All Rights Reserved.

from django.conf import settings
from django.utils.translation import gettext_lazy as _
from ansible_base.lib.utils.schema import extend_schema_if_available

from awx.api.generics import APIView, Response
from awx.api.permissions import IsSystemAdminOrAuditor
from awx.api.serializers import InstanceLinkSerializer, InstanceNodeSerializer
from awx.main.models import CloudProviderConnection, CloudProviderState, InstanceLink, Instance

CLOUD_PROVIDER_LABELS = {
    'digitalocean': _('DigitalOcean'),
    'aws': _('AWS'),
    'azure': _('Azure'),
    'gcp': _('GCP'),
    'proxmox': _('Proxmox VE'),
    'vmware': _('VMware vSphere'),
}


def _service_state(module_enabled, configured):
    if not module_enabled:
        return 'disabled'
    if configured:
        return 'ready'
    return 'not_configured'


def _status_label(node_state):
    return {
        'ready': _('Connected'),
        'not_configured': _('Not configured'),
        'disabled': _('Disabled'),
        'unavailable': _('Unavailable'),
        'installed': _('Installed'),
    }.get(node_state, node_state)


def _service_node(service_id, label, service_type, node_state, description, endpoint='', metadata=None, enabled=True):
    metadata = metadata or {}
    return {
        'id': f'service-{service_id}',
        'hostname': str(label),
        'node_type': f'service-{service_type}',
        'node_state': node_state,
        'enabled': enabled,
        'service_type': service_type,
        'status_label': str(_status_label(node_state)),
        'description': str(description),
        'endpoint': endpoint,
        'metadata': metadata,
    }


def _service_link(source_hostname, target_hostname, node_state):
    link_state = 'established' if node_state == 'ready' else 'adding' if node_state in ('installed', 'not_configured') else 'removing'
    return {
        'source': source_hostname,
        'target': target_hostname,
        'link_state': link_state,
    }


def _safe_setting(name, default=''):
    value = getattr(settings, name, default)
    if value is None:
        return default
    if value == '' and default != '':
        return default
    return value


def _opa_endpoint():
    server_url = _safe_setting('OPA_SERVER_URL')
    if server_url:
        return str(server_url).rstrip('/')
    host = _safe_setting('OPA_HOST')
    if not host:
        return ''
    scheme = 'https' if bool(_safe_setting('OPA_SSL', False)) else 'http'
    return f'{scheme}://{host}:{_safe_setting("OPA_PORT", 8181)}'


def _cloud_provider_nodes():
    connections = list(CloudProviderConnection.objects.values('provider_id', 'status').order_by('provider_id'))
    states = list(CloudProviderState.objects.values('provider_id', 'pulled_at').order_by('provider_id'))
    provider_ids = sorted(({row['provider_id'] for row in connections} | {row['provider_id'] for row in states}) & set(CLOUD_PROVIDER_LABELS))

    nodes = []
    for provider_id in provider_ids:
        provider_connections = [row for row in connections if row['provider_id'] == provider_id]
        provider_states = [row for row in states if row['provider_id'] == provider_id]
        connected = sum(1 for row in provider_connections if row['status'] == 'connected')
        configured = bool(provider_connections or provider_states)
        node_state = 'ready' if connected else 'installed' if configured else 'not_configured'
        pulled_at_values = [row['pulled_at'] for row in provider_states if row['pulled_at']]
        pulled_at = max(pulled_at_values).isoformat() if pulled_at_values else ''
        nodes.append(
            _service_node(
                f'cloud-{provider_id}',
                CLOUD_PROVIDER_LABELS.get(provider_id, provider_id),
                'cloud',
                node_state,
                _('Cloud provider connection and synced resource state.'),
                metadata={
                    'Provider': provider_id,
                    'Connections': len(provider_connections),
                    'Connected': connected,
                    'Last pull': pulled_at or _('Never'),
                },
            )
        )
    return nodes


def _integrated_service_nodes():
    eda_enabled = bool(_safe_setting('MODULE_EDA_ENABLED', True))
    eda_url = str(_safe_setting('EDA_SERVER_URL')).rstrip('/')
    galaxy_enabled = bool(_safe_setting('MODULE_GALAXY_NG_ENABLED', True))
    galaxy_url = str(_safe_setting('GALAXY_NG_SERVER_URL')).rstrip('/')
    quay_enabled = bool(_safe_setting('MODULE_QUAY_ENABLED', True))
    quay_url = str(_safe_setting('QUAY_REGISTRY_URL')).rstrip('/')
    quay_namespace = _safe_setting('QUAY_NAMESPACE')
    opa_enabled = bool(_safe_setting('MODULE_OPA_ENABLED', True))
    opa_url = _opa_endpoint()
    gatekeeper_enabled = bool(_safe_setting('MODULE_GATEKEEPER_ENABLED', True))
    gatekeeper_url = str(_safe_setting('GATEKEEPER_K8S_API_URL')).rstrip('/')
    ai_enabled = bool(_safe_setting('AI_ENABLED', False))
    ai_provider = _safe_setting('AI_PROVIDER', 'openai')
    ai_model = _safe_setting('AI_MODEL_NAME') or _('Default model')

    services = [
        _service_node(
            'eda',
            _('EDA Controller'),
            'eda',
            _service_state(eda_enabled, bool(eda_url)),
            _('Event-Driven Ansible controller used for rulebooks, activations, and access sync.'),
            endpoint=eda_url,
            metadata={
                'Module': _('Enabled') if eda_enabled else _('Disabled'),
                'Auth': _('Configured') if _safe_setting('EDA_AUTH_TOKEN') or _safe_setting('EDA_USERNAME') else _('Not configured'),
            },
            enabled=eda_enabled,
        ),
        _service_node(
            'opa',
            _('OPA'),
            'opa',
            _service_state(opa_enabled, bool(opa_url)),
            _('Open Policy Agent guardrails used before launches, AI actions, and policy sync.'),
            endpoint=opa_url,
            metadata={
                'Module': _('Enabled') if opa_enabled else _('Disabled'),
                'Auth type': _safe_setting('OPA_AUTH_TYPE', 'None'),
                'Managed bundle': _('Configured') if _safe_setting('OPA_POLICY_BUNDLE') else _('Not configured'),
            },
            enabled=opa_enabled,
        ),
        _service_node(
            'gatekeeper',
            _('Gatekeeper'),
            'gatekeeper',
            _service_state(gatekeeper_enabled, bool(gatekeeper_url)),
            _('Kubernetes Gatekeeper admission policy inventory, violations, and remediation.'),
            endpoint=gatekeeper_url,
            metadata={
                'Module': _('Enabled') if gatekeeper_enabled else _('Disabled'),
                'Context': _safe_setting('GATEKEEPER_K8S_CONTEXT', 'default'),
                'TLS verify': _('Enabled') if bool(_safe_setting('GATEKEEPER_K8S_VERIFY_SSL', True)) else _('Disabled'),
            },
            enabled=gatekeeper_enabled,
        ),
        _service_node(
            'galaxy-ng',
            _('Galaxy NG'),
            'galaxy',
            _service_state(galaxy_enabled, bool(galaxy_url)),
            _('Automation Hub content source for collections, repositories, remotes, and approvals.'),
            endpoint=galaxy_url,
            metadata={
                'Module': _('Enabled') if galaxy_enabled else _('Disabled'),
                'Auth': _('Configured') if _safe_setting('GALAXY_NG_AUTH_TOKEN') or _safe_setting('GALAXY_NG_USERNAME') else _('Not configured'),
            },
            enabled=galaxy_enabled,
        ),
        _service_node(
            'quay',
            _('Project Quay'),
            'quay',
            _service_state(quay_enabled, bool(quay_url)),
            _('Execution environment image registry used by EE build templates.'),
            endpoint=quay_url,
            metadata={
                'Module': _('Enabled') if quay_enabled else _('Disabled'),
                'Namespace': quay_namespace or _('Not configured'),
                'API token': _('Configured') if _safe_setting('QUAY_API_TOKEN') else _('Not configured'),
                'Push token': _('Configured') if _safe_setting('QUAY_PUSH_TOKEN') else _('Not configured'),
            },
            enabled=quay_enabled,
        ),
        _service_node(
            'ai',
            _('AI Assistant'),
            'ai',
            _service_state(True, ai_enabled),
            _('AI provider connection used for assistant context, job output analysis, and guided remediation.'),
            endpoint=str(_safe_setting('AI_API_URL')).rstrip('/'),
            metadata={
                'Provider': ai_provider,
                'Model': ai_model,
                'Codex device login': _('Connected') if _safe_setting('AI_OPENAI_CODEX_ACCESS_TOKEN') else _('Not connected'),
            },
            enabled=ai_enabled,
        ),
    ]

    return services + _cloud_provider_nodes()


def _service_links(anchor_hostname, services):
    if not anchor_hostname:
        return []
    return [_service_link(anchor_hostname, service['hostname'], service['node_state']) for service in services]


class MeshVisualizer(APIView):
    name = _("Mesh Visualizer")
    permission_classes = (IsSystemAdminOrAuditor,)
    swagger_topic = "System Configuration"
    resource_purpose = 'mesh network topology visualization data'

    @extend_schema_if_available(extensions={"x-ai-description": "Get mesh network topology visualization data"})
    def get(self, request, format=None):
        instances = list(Instance.objects.all())
        anchor = next((instance for instance in instances if instance.node_type in ('control', 'hybrid')), instances[0] if instances else None)
        services = _integrated_service_nodes()
        data = {
            'nodes': InstanceNodeSerializer(instances, many=True).data,
            'links': InstanceLinkSerializer(InstanceLink.objects.select_related('target__instance', 'source'), many=True).data,
            'services': services,
            'service_links': _service_links(anchor.hostname if anchor else '', services),
        }

        return Response(data)
