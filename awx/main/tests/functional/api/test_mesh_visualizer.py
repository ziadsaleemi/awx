import pytest
from django.test import override_settings
from django.utils import timezone

from awx.api.versioning import reverse
from awx.main.models import CloudProviderConnection, CloudProviderState, Instance


@pytest.mark.django_db
@override_settings(
    MODULE_EDA_ENABLED=True,
    EDA_SERVER_URL='https://eda.example.test',
    EDA_AUTH_TOKEN='eda-secret',
    MODULE_OPA_ENABLED=True,
    OPA_HOST='opa.example.test',
    OPA_PORT=8181,
    OPA_SSL=False,
    OPA_AUTH_TOKEN='opa-secret',
    OPA_POLICY_BUNDLE='package awx\nallow := true',
    MODULE_GATEKEEPER_ENABLED=True,
    GATEKEEPER_K8S_API_URL='https://kube.example.test',
    GATEKEEPER_K8S_AUTH_TOKEN='kube-secret',
    GATEKEEPER_K8S_CONTEXT='prod',
    GATEKEEPER_K8S_VERIFY_SSL=False,
    MODULE_GALAXY_NG_ENABLED=True,
    GALAXY_NG_SERVER_URL='https://hub.example.test',
    GALAXY_NG_AUTH_TOKEN='hub-secret',
    MODULE_QUAY_ENABLED=True,
    QUAY_REGISTRY_URL='https://quay.example.test',
    QUAY_NAMESPACE='awx',
    QUAY_API_TOKEN='quay-secret',
    QUAY_PUSH_TOKEN='push-secret',
    AI_ENABLED=True,
    AI_PROVIDER='openai_codex',
    AI_MODEL_NAME='gpt-test',
    AI_OPENAI_CODEX_ACCESS_TOKEN='codex-secret',
)
def test_mesh_visualizer_includes_integrated_service_topology(get, admin_user):
    Instance.objects.create(hostname='awx-control', node_type='control', node_state='ready')
    CloudProviderConnection.objects.create(provider_id='digitalocean', name='DO', status='connected')
    CloudProviderState.objects.create(provider_id='digitalocean', pulled_at=timezone.now(), provider_data={'droplets': []})
    CloudProviderState.objects.create(provider_id='global', provider_data={'terraform': {}})

    response = get(reverse('api:mesh_visualizer_view'), user=admin_user, expect=200)

    service_ids = {service['id'] for service in response.data['services']}
    assert {
        'service-eda',
        'service-opa',
        'service-gatekeeper',
        'service-galaxy-ng',
        'service-quay',
        'service-ai',
        'service-cloud-digitalocean',
    }.issubset(service_ids)
    assert 'service-cloud-global' not in service_ids

    service_links = {(link['source'], link['target']) for link in response.data['service_links']}
    assert ('awx-control', 'EDA Controller') in service_links
    assert ('awx-control', 'Project Quay') in service_links
    assert ('awx-control', 'DigitalOcean') in service_links

    quay = next(service for service in response.data['services'] if service['id'] == 'service-quay')
    assert quay['endpoint'] == 'https://quay.example.test'
    assert quay['metadata']['Namespace'] == 'awx'
    assert quay['metadata']['API token'] == 'Configured'

    digitalocean = next(service for service in response.data['services'] if service['id'] == 'service-cloud-digitalocean')
    assert digitalocean['metadata']['Connections'] == 1
    assert digitalocean['metadata']['Connected'] == 1

    serialized = str(response.data)
    assert 'eda-secret' not in serialized
    assert 'opa-secret' not in serialized
    assert 'kube-secret' not in serialized
    assert 'quay-secret' not in serialized
    assert 'codex-secret' not in serialized
