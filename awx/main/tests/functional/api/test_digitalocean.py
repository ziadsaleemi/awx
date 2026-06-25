"""
End-to-end functional tests for the DigitalOcean cloud-provider integration.

Covers:
- CatalogItem.cloud_backends routing deploy to the correct TerraformJobTemplate
- DigitalOcean-specific extra vars (do_droplet_size, do_image_id, do_region,
  do_vpc_uuid) are forwarded to the deployment
- Negative: target_provider pointing to a non-existent TFT pk → 400
- Negative: invalid target_provider falls back to default TFT
- CloudProviderState GET/PATCH with admin allow-list settings
- Non-admin cannot PATCH provider state
- cloud_backends serialized correctly in CatalogItem GET response
- CloudProviderConnection activity stream entry is created on save
"""

import pytest

from ansible_base.rbac.models import RoleDefinition

from awx.api.versioning import reverse
from awx.main.models import CatalogDeployment, CatalogItem, Credential, CredentialType, Organization
from awx.main.models.catalog import CloudProviderConnection, CloudProviderState
from awx.main.models.terraform import TerraformJobTemplate

# ---------------------------------------------------------------------------
# Shared provider_data / admin_settings helpers
# ---------------------------------------------------------------------------

DO_PROVIDER_DATA = {
    'images': [
        {
            'id': 101,
            'name': 'Ubuntu 22.04 x64',
            'distribution': 'Ubuntu',
            'type': 'snapshot',
            'private': False,
            'min_disk_size': 25,
            'status': 'available',
            'slug': None,
            'size_gigabytes': 2.5,
            'regions': ['nyc3', 'sfo3'],
        },
        {
            'id': 202,
            'name': 'CentOS Stream 9 x64',
            'distribution': 'CentOS',
            'type': 'snapshot',
            'private': False,
            'min_disk_size': 20,
            'status': 'available',
            'slug': None,
            'size_gigabytes': 2.0,
            'regions': ['nyc3'],
        },
    ],
    'pricing': [
        {
            'slug': 's-1vcpu-1gb',
            'vcpus': 1,
            'memory': 1024,
            'disk': 25,
            'transfer': 1.0,
            'price_monthly': 6.0,
            'price_hourly': 0.00893,
            'available': True,
        },
        {
            'slug': 's-2vcpu-2gb',
            'vcpus': 2,
            'memory': 2048,
            'disk': 60,
            'transfer': 3.0,
            'price_monthly': 18.0,
            'price_hourly': 0.02679,
            'available': True,
        },
    ],
    'regions': [
        {
            'slug': 'nyc3',
            'name': 'New York 3',
            'available': True,
            'features': ['private_networking', 'backups'],
        },
        {
            'slug': 'sfo3',
            'name': 'San Francisco 3',
            'available': True,
            'features': ['private_networking'],
        },
    ],
    'vpcs': [
        {
            'id': 'vpc-abc123',
            'name': 'default-nyc3',
            'region': 'nyc3',
            'ip_range': '10.0.0.0/20',
            'created_at': '2023-01-01T00:00:00Z',
        },
    ],
}

DO_ADMIN_SETTINGS = {
    'allowedSizeSlugs': ['s-1vcpu-1gb'],
    'allowedVpcIds': ['vpc-abc123'],
    'allowedImageIds': [101],
    'allowedRegionSlugs': ['nyc3'],
}


CLOUD_CONNECTOR_ENDPOINTS = [
    (
        'digitalocean',
        'digitalocean_terraform',
        {'do_token': 'dop_v1_test'},
        'api:catalog_cloud_digitalocean_validate',
    ),
    (
        'digitalocean',
        'digitalocean_terraform',
        {'do_token': 'dop_v1_test'},
        'api:catalog_cloud_digitalocean_pull_images',
    ),
    (
        'proxmox',
        'proxmox_ve',
        {
            'pm_api_url': 'https://proxmox.example/api2/json',
            'pm_api_token_id': 'user@pam!token',
            'pm_api_token_secret': 'secret',
            'pm_tls_insecure': True,
        },
        'api:catalog_cloud_proxmox_pull_resources',
    ),
    (
        'vmware',
        'vmware_vsphere_terraform',
        {
            'vsphere_server': 'vcenter.example',
            'vsphere_user': 'administrator',
            'vsphere_password': 'secret',
            'vsphere_allow_unverified_ssl': True,
        },
        'api:catalog_cloud_vmware_pull_resources',
    ),
    (
        'azure',
        'azure_rm_terraform',
        {
            'arm_subscription_id': 'sub-id',
            'arm_client_id': 'client-id',
            'arm_client_secret': 'secret',
            'arm_tenant_id': 'tenant-id',
        },
        'api:catalog_cloud_azure_pull_resources',
    ),
]


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def do_provider_state():
    """CloudProviderState for digitalocean with realistic data and admin allow-lists."""
    return CloudProviderState.objects.create(
        provider_id='digitalocean',
        provider_data=DO_PROVIDER_DATA,
        admin_settings=DO_ADMIN_SETTINGS,
    )


@pytest.fixture
def do_terraform_job_template(organization):
    """TerraformJobTemplate representing the DigitalOcean deployment template."""
    return TerraformJobTemplate.objects.create(
        name='Deploy DigitalOcean Droplet',
        organization=organization,
    )


@pytest.fixture
def other_terraform_job_template(organization):
    """A second TerraformJobTemplate for testing fallback behaviour."""
    return TerraformJobTemplate.objects.create(
        name='Default Deploy Template',
        organization=organization,
    )


@pytest.fixture
def do_catalog_item(organization, do_terraform_job_template):
    """CatalogItem whose cloud_backends maps digitalocean → do_terraform_job_template."""
    return CatalogItem.objects.create(
        name='DigitalOcean VM',
        organization=organization,
        cloud_backends={'digitalocean': do_terraform_job_template.pk},
        extra_vars_schema={
            'type': 'object',
            'properties': {
                'vm_hostname': {'type': 'string', 'title': 'VM Hostname'},
            },
        },
    )


@pytest.fixture
def multi_cloud_catalog_item(organization, do_terraform_job_template, other_terraform_job_template):
    """CatalogItem with both a default TFT and a digitalocean cloud_backend."""
    return CatalogItem.objects.create(
        name='Multi-Cloud VM',
        organization=organization,
        terraform_job_template=other_terraform_job_template,
        cloud_backends={'digitalocean': do_terraform_job_template.pk},
        extra_vars_schema={
            'type': 'object',
            'properties': {
                'vm_hostname': {'type': 'string'},
            },
        },
    )


def _credential_type(namespace, inputs):
    return CredentialType.objects.create(
        name=f'{namespace} test credential type',
        namespace=namespace,
        kind='cloud',
        inputs={
            'fields': [{'id': field, 'label': field, 'type': 'boolean' if isinstance(value, bool) else 'string'} for field, value in inputs.items()],
            'required': list(inputs.keys()),
        },
        injectors={},
    )


def _cloud_credential(namespace, inputs, organization, user):
    credential_type = _credential_type(namespace, inputs)
    credential = Credential.objects.create(
        name=f'{namespace} credential',
        organization=organization,
        credential_type=credential_type,
        inputs=inputs,
    )
    credential.use_role.members.add(user)
    return credential


class _FakeResponse:
    def __init__(self, payload, status_code=200, text='OK'):
        self.payload = payload
        self.status_code = status_code
        self.text = text
        self.ok = status_code < 400

    def json(self):
        return self.payload


# ---------------------------------------------------------------------------
# Deploy routing tests
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_do_catalog_item_deploy_uses_cloud_backend_tft(post, admin_user, do_catalog_item, do_terraform_job_template):
    """POSTing with target_provider=digitalocean routes through the mapped TFT."""
    response = post(
        reverse('api:catalog_item_deploy', kwargs={'pk': do_catalog_item.pk}),
        {
            'target_provider': 'digitalocean',
            'extra_vars': {'vm_hostname': 'test-droplet'},
        },
        admin_user,
        expect=201,
    )

    assert response.data is not None
    deployment = CatalogDeployment.objects.filter(catalog_item=do_catalog_item).last()
    assert deployment is not None
    assert deployment.terraform_provision_job is not None
    assert deployment.terraform_provision_job.terraform_job_template_id == do_terraform_job_template.pk


@pytest.mark.django_db
def test_do_catalog_item_deploy_creates_deployment_record(post, admin_user, do_catalog_item):
    """A CatalogDeployment record is persisted after a successful DO deploy."""
    before_count = CatalogDeployment.objects.filter(catalog_item=do_catalog_item).count()

    post(
        reverse('api:catalog_item_deploy', kwargs={'pk': do_catalog_item.pk}),
        {
            'target_provider': 'digitalocean',
            'extra_vars': {'vm_hostname': 'droplet-1'},
        },
        admin_user,
        expect=201,
    )

    after_count = CatalogDeployment.objects.filter(catalog_item=do_catalog_item).count()
    assert after_count == before_count + 1


@pytest.mark.django_db
def test_do_catalog_item_deploy_missing_tft_returns_400(post, admin_user, organization):
    """cloud_backends pointing to a non-existent TFT pk returns HTTP 400."""
    item = CatalogItem.objects.create(
        name='Bad TFT Item',
        organization=organization,
        cloud_backends={'digitalocean': 999999},
    )

    response = post(
        reverse('api:catalog_item_deploy', kwargs={'pk': item.pk}),
        {'target_provider': 'digitalocean'},
        admin_user,
        expect=400,
    )

    assert 'target_provider' in response.data


@pytest.mark.django_db
def test_do_catalog_item_deploy_unknown_provider_falls_back_to_default(post, admin_user, multi_cloud_catalog_item, other_terraform_job_template):
    """target_provider not in cloud_backends falls back to terraform_job_template."""
    post(
        reverse('api:catalog_item_deploy', kwargs={'pk': multi_cloud_catalog_item.pk}),
        {
            'target_provider': 'nonexistent-provider',
            'extra_vars': {'vm_hostname': 'fallback-vm'},
        },
        admin_user,
        expect=201,
    )

    deployment = CatalogDeployment.objects.filter(catalog_item=multi_cloud_catalog_item).last()
    assert deployment is not None
    assert deployment.terraform_provision_job is not None
    assert deployment.terraform_provision_job.terraform_job_template_id == other_terraform_job_template.pk


@pytest.mark.django_db
def test_do_catalog_item_deploy_no_provider_uses_default_tft(post, admin_user, multi_cloud_catalog_item, other_terraform_job_template):
    """No target_provider in POST body uses the default terraform_job_template."""
    post(
        reverse('api:catalog_item_deploy', kwargs={'pk': multi_cloud_catalog_item.pk}),
        {'extra_vars': {'vm_hostname': 'no-provider-vm'}},
        admin_user,
        expect=201,
    )

    deployment = CatalogDeployment.objects.filter(catalog_item=multi_cloud_catalog_item).last()
    assert deployment is not None
    assert deployment.terraform_provision_job is not None
    assert deployment.terraform_provision_job.terraform_job_template_id == other_terraform_job_template.pk


# ---------------------------------------------------------------------------
# cloud_backends serialization tests
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_do_catalog_item_cloud_backends_in_get_response(get, admin_user, do_catalog_item, do_terraform_job_template):
    """GET /catalog/ returns cloud_backends dict for a catalog item."""
    from awx.api.urls.catalog import catalog_item_urls  # noqa: F401 - confirm import

    # Use the list endpoint and find our item
    response = get(
        reverse('api:catalog_item_list'),
        admin_user,
        expect=200,
    )
    items = response.data['results']
    match = next((i for i in items if i['id'] == do_catalog_item.pk), None)
    assert match is not None
    assert match['cloud_backends'] == {'digitalocean': do_terraform_job_template.pk}


@pytest.mark.django_db
def test_do_catalog_item_cloud_backends_null_when_unset(get, admin_user, organization):
    """cloud_backends is null when not set on a catalog item."""
    item = CatalogItem.objects.create(
        name='No Cloud Backends',
        organization=organization,
    )
    response = get(
        reverse('api:catalog_item_list'),
        admin_user,
        expect=200,
    )
    items = response.data['results']
    match = next((i for i in items if i['id'] == item.pk), None)
    assert match is not None
    assert match['cloud_backends'] is None


# ---------------------------------------------------------------------------
# CloudProviderState (admin settings) tests
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_do_provider_state_readable_by_admin(get, admin_user, do_provider_state):
    """GET provider_state returns the admin allow-list settings."""
    url = reverse('api:catalog_cloud_provider_state_detail', kwargs={'provider_id': 'digitalocean'})
    response = get(url, admin_user, expect=200)

    assert response.data['provider_id'] == 'digitalocean'
    admin_settings = response.data['admin_settings']
    assert admin_settings['allowedSizeSlugs'] == ['s-1vcpu-1gb']
    assert admin_settings['allowedImageIds'] == [101]
    assert admin_settings['allowedRegionSlugs'] == ['nyc3']
    assert admin_settings['allowedVpcIds'] == ['vpc-abc123']


@pytest.mark.django_db
def test_do_provider_state_readable_by_system_auditor(get, system_auditor, do_provider_state):
    """System auditors can read provider state (read-only access)."""
    url = reverse('api:catalog_cloud_provider_state_detail', kwargs={'provider_id': 'digitalocean'})
    response = get(url, system_auditor, expect=200)
    assert response.data['provider_id'] == 'digitalocean'


@pytest.mark.django_db
def test_do_provider_state_patchable_by_admin(patch, admin_user, do_provider_state):
    """PATCH by superuser updates admin allow-list settings."""
    url = reverse('api:catalog_cloud_provider_state_detail', kwargs={'provider_id': 'digitalocean'})
    new_settings = {
        'admin_settings': {
            'allowedSizeSlugs': ['s-1vcpu-1gb', 's-2vcpu-2gb'],
            'allowedVpcIds': ['vpc-abc123'],
            'allowedImageIds': [101, 202],
            'allowedRegionSlugs': ['nyc3', 'sfo3'],
        }
    }
    response = patch(url, new_settings, admin_user, expect=200)

    assert response.data['admin_settings']['allowedSizeSlugs'] == ['s-1vcpu-1gb', 's-2vcpu-2gb']
    assert response.data['admin_settings']['allowedImageIds'] == [101, 202]
    assert response.data['admin_settings']['allowedRegionSlugs'] == ['nyc3', 'sfo3']

    # Confirm persisted
    do_provider_state.refresh_from_db()
    assert do_provider_state.admin_settings['allowedImageIds'] == [101, 202]


@pytest.mark.django_db
def test_do_provider_state_not_patchable_by_non_admin(patch, rando, do_provider_state):
    """Non-admin user cannot PATCH provider state."""
    url = reverse('api:catalog_cloud_provider_state_detail', kwargs={'provider_id': 'digitalocean'})
    patch(
        url,
        {'admin_settings': {'allowedSizeSlugs': ['s-2vcpu-2gb']}},
        rando,
        expect=403,
    )


@pytest.mark.django_db
def test_do_provider_state_get_creates_record_if_missing(get, admin_user):
    """GET on a non-existent provider_id creates the record automatically."""
    url = reverse('api:catalog_cloud_provider_state_detail', kwargs={'provider_id': 'test-provider'})
    response = get(url, admin_user, expect=200)
    assert response.data['provider_id'] == 'test-provider'
    assert CloudProviderState.objects.filter(provider_id='test-provider').exists()


@pytest.mark.django_db
def test_do_provider_state_provider_data_present(get, admin_user, do_provider_state):
    """provider_data is returned and contains images, pricing, regions, vpcs."""
    url = reverse('api:catalog_cloud_provider_state_detail', kwargs={'provider_id': 'digitalocean'})
    response = get(url, admin_user, expect=200)

    provider_data = response.data['provider_data']
    assert len(provider_data['images']) == 2
    assert len(provider_data['pricing']) == 2
    assert len(provider_data['regions']) == 2
    assert len(provider_data['vpcs']) == 1

    image_ids = [img['id'] for img in provider_data['images']]
    assert 101 in image_ids
    assert 202 in image_ids


@pytest.mark.django_db
def test_provider_state_is_scoped_to_org_admin_org(get, rando, organization):
    """Org admins can read only provider state scoped to their organization."""
    other_org = Organization.objects.create(name='Other Org')
    organization.admin_role.members.add(rando)
    CloudProviderState.objects.create(
        provider_id='digitalocean',
        organization=organization,
        admin_settings={'allowedImageIds': [101]},
    )
    CloudProviderState.objects.create(
        provider_id='digitalocean',
        organization=other_org,
        admin_settings={'allowedImageIds': [202]},
    )

    url = reverse('api:catalog_cloud_provider_state_detail', kwargs={'provider_id': 'digitalocean'})
    response = get(f'{url}?organization={organization.pk}', rando, expect=200)
    assert response.data['organization'] == organization.pk
    assert response.data['admin_settings']['allowedImageIds'] == [101]

    get(f'{url}?organization={other_org.pk}', rando, expect=403)


@pytest.mark.django_db
def test_provider_state_org_admin_patch_updates_only_scoped_row(patch, rando, organization):
    """Org admin PATCH writes the row for the requested organization."""
    organization.admin_role.members.add(rando)
    state = CloudProviderState.objects.create(
        provider_id='digitalocean',
        organization=organization,
        admin_settings={'allowedImageIds': [101]},
    )

    url = reverse('api:catalog_cloud_provider_state_detail', kwargs={'provider_id': 'digitalocean'})
    response = patch(
        f'{url}?organization={organization.pk}',
        {'admin_settings': {'allowedImageIds': [303]}},
        rando,
        expect=200,
    )

    assert response.data['organization'] == organization.pk
    state.refresh_from_db()
    assert state.admin_settings['allowedImageIds'] == [303]


@pytest.mark.django_db
def test_provider_state_inventory_suggestions_from_pulled_data(post, admin_user, do_provider_state):
    """Provider-state inventory suggestions map pulled resource metadata to groups and hosts."""
    url = reverse('api:catalog_cloud_provider_inventory_suggestions', kwargs={'provider_id': 'digitalocean'})
    response = post(url, {'sample_limit': 20}, admin_user, expect=200)

    assert response.data['provider'] == 'digitalocean'
    assert response.data['ai_used'] is False
    assert response.data['resource_counts']['image'] == 2
    assert response.data['resource_counts']['region'] == 2
    assert response.data['resource_counts']['vpc'] == 1

    suggestion = response.data['suggestion']
    group_names = {group['name'] for group in suggestion['groups']}
    host_names = {host['name'] for host in suggestion['hosts']}
    assert 'cloud_digitalocean' in group_names
    assert 'digitalocean_images' in group_names
    assert 'digitalocean_region_nyc3' in group_names
    assert 'image_Ubuntu_22.04_x64' in host_names
    assert 'vpc_default-nyc3' in host_names
    assert 'DIGITALOCEAN_TOKEN' not in suggestion['source']


@pytest.mark.django_db
def test_provider_state_inventory_suggestions_are_org_scoped(post, rando, organization):
    """Org admins can request suggestions only from their own provider state row."""
    other_org = Organization.objects.create(name='Other Org')
    organization.admin_role.members.add(rando)
    own_state = CloudProviderState.objects.create(
        provider_id='digitalocean',
        organization=organization,
        provider_data=DO_PROVIDER_DATA,
    )
    CloudProviderState.objects.create(
        provider_id='digitalocean',
        organization=other_org,
        provider_data={
            'images': [],
            'pricing': [],
            'regions': [{'slug': 'fra1', 'name': 'Frankfurt 1'}],
            'vpcs': [],
        },
    )

    url = reverse('api:catalog_cloud_provider_inventory_suggestions', kwargs={'provider_id': 'digitalocean'})
    response = post(f'{url}?organization={organization.pk}', {'sample_limit': 20}, rando, expect=200)
    assert response.data['organization'] == own_state.organization_id
    assert 'digitalocean_region_nyc3' in response.data['suggestion']['source']
    assert 'fra1' not in response.data['suggestion']['source']

    post(f'{url}?organization={other_org.pk}', {'sample_limit': 20}, rando, expect=403)


@pytest.mark.django_db
def test_provider_state_inventory_suggestions_scope_by_connection(post, rando, organization):
    """Connection-scoped suggestions reject foreign connections and map only selected connection data."""
    other_org = Organization.objects.create(name='Other Org')
    organization.admin_role.members.add(rando)
    own_connection = CloudProviderConnection.objects.create(
        provider_id='proxmox',
        name='Own Proxmox',
        status='connected',
        organization=organization,
    )
    other_connection = CloudProviderConnection.objects.create(
        provider_id='proxmox',
        name='Other Proxmox',
        status='connected',
        organization=other_org,
    )
    CloudProviderState.objects.create(
        provider_id='proxmox',
        organization=organization,
        provider_data={
            str(own_connection.pk): {
                'nodes': [{'node': 'pve-a', 'status': 'online', 'type': 'node'}],
                'vms': [{'vmid': 101, 'name': 'web-01', 'status': 'running', 'node': 'pve-a'}],
                'containers': [],
                'templates': [],
                'storage': [],
                'networks': [],
            },
            str(other_connection.pk): {
                'nodes': [{'node': 'pve-b', 'status': 'online', 'type': 'node'}],
                'vms': [{'vmid': 202, 'name': 'foreign-vm', 'status': 'running', 'node': 'pve-b'}],
                'containers': [],
                'templates': [],
                'storage': [],
                'networks': [],
            },
        },
    )

    url = reverse('api:catalog_cloud_provider_inventory_suggestions', kwargs={'provider_id': 'proxmox'})
    response = post(
        f'{url}?organization={organization.pk}',
        {'connection_id': own_connection.pk, 'sample_limit': 20},
        rando,
        expect=200,
    )
    assert response.data['connection_id'] == own_connection.pk
    assert 'vm_web-01' in response.data['suggestion']['source']
    assert 'foreign-vm' not in response.data['suggestion']['source']

    post(
        f'{url}?organization={organization.pk}',
        {'connection_id': other_connection.pk, 'sample_limit': 20},
        rando,
        expect=403,
    )


@pytest.mark.django_db
def test_provider_state_inventory_suggestions_include_vmware_enriched_data(post, admin_user, organization):
    """VMware suggestions include connection-keyed inventory, networks, datastores, and VM facts."""
    connection = CloudProviderConnection.objects.create(
        provider_id='vmware',
        name='Lab vCenter',
        status='connected',
        organization=organization,
    )
    CloudProviderState.objects.create(
        provider_id='vmware',
        organization=organization,
        provider_data={
            str(connection.pk): {
                'datacenters': [
                    {
                        'id': 'dc-1',
                        'name': 'Datacenter',
                        'cluster_count': 1,
                        'host_count': 1,
                        'datastore_count': 1,
                        'network_count': 1,
                    }
                ],
                'clusters': [
                    {
                        'id': 'cluster-1',
                        'name': 'Cluster',
                        'datacenter_id': 'dc-1',
                        'ha_enabled': True,
                        'drs_enabled': True,
                        'host_count': 1,
                    }
                ],
                'hosts': [
                    {
                        'id': 'host-1',
                        'name': 'esxi-1',
                        'cluster_id': 'cluster-1',
                        'power_state': 'POWERED_ON',
                        'connection_state': 'CONNECTED',
                        'vm_count': 1,
                    }
                ],
                'vms': [
                    {
                        'id': 'vm-1',
                        'name': 'splunk',
                        'power_state': 'POWERED_ON',
                        'host_id': 'host-1',
                        'cluster_id': 'cluster-1',
                        'cpu_count': 4,
                        'memory_size_mib': 8192,
                        'guest_full_name': 'Oracle Linux 9 (64-bit)',
                        'guest_hostname': 'splunk.corp.linoop.us',
                        'ip_address': '192.168.111.106',
                        'hardware_version': 'VMX_19',
                        'disk_count': 1,
                        'disk_capacity_bytes': 39728447488,
                        'datastore_names': ['datastore1'],
                        'nics_count': 1,
                    }
                ],
                'networks': [
                    {
                        'id': 'network-1',
                        'name': 'VM Network',
                        'type': 'STANDARD_PORTGROUP',
                        'datacenter_id': 'dc-1',
                    }
                ],
                'datastores': [
                    {
                        'id': 'datastore-1',
                        'name': 'datastore1',
                        'type': 'VMFS',
                        'capacity_mb': 2798848,
                        'free_space_mb': 1909975,
                        'accessible': True,
                        'datacenter_id': 'dc-1',
                    }
                ],
            }
        },
    )

    url = reverse('api:catalog_cloud_provider_inventory_suggestions', kwargs={'provider_id': 'vmware'})
    response = post(
        f'{url}?organization={organization.pk}',
        {'connection_id': connection.pk, 'sample_limit': 20},
        admin_user,
        expect=200,
    )

    assert response.data['connection_id'] == connection.pk
    assert response.data['ai_status'] == 'not_requested'
    assert response.data['resource_counts']['vm'] == 1
    assert response.data['resource_counts']['network'] == 1
    assert response.data['resource_counts']['datastore'] == 1
    source = response.data['suggestion']['source']
    assert 'vm_splunk' in source
    assert 'guest_hostname=splunk.corp.linoop.us' in source
    assert 'ip_address=192.168.111.106' in source
    assert 'disk_capacity_bytes=39728447488' in source
    assert 'network_VM_Network' in source
    assert 'datastore_datastore1' in source


# ---------------------------------------------------------------------------
# CloudProviderConnection tests
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_do_cloud_provider_connection_list(get, admin_user):
    """GET /catalog_cloud/connections/ returns a paginated list."""
    CloudProviderConnection.objects.create(
        provider_id='digitalocean',
        name='My DO Connection',
        status='connected',
    )
    url = reverse('api:catalog_cloud_connection_list')
    response = get(url, admin_user, expect=200)
    assert response.data['count'] >= 1
    names = [c['name'] for c in response.data['results']]
    assert 'My DO Connection' in names


@pytest.mark.django_db
def test_do_cloud_provider_connection_detail(get, admin_user):
    """GET /catalog_cloud/connections/<pk>/ returns connection fields."""
    conn = CloudProviderConnection.objects.create(
        provider_id='digitalocean',
        name='Detail Test Connection',
        status='disconnected',
    )
    url = reverse('api:catalog_cloud_connection_detail', kwargs={'pk': conn.pk})
    response = get(url, admin_user, expect=200)
    assert response.data['provider_id'] == 'digitalocean'
    assert response.data['name'] == 'Detail Test Connection'
    assert response.data['status'] == 'disconnected'


@pytest.mark.django_db
def test_do_cloud_provider_connection_not_accessible_by_non_admin(get, rando):
    """Non-admin cannot list cloud provider connections."""
    url = reverse('api:catalog_cloud_connection_list')
    get(url, rando, expect=403)


@pytest.mark.django_db
def test_cloud_user_persona_can_read_org_cloud_only(get, post, patch, rando, organization, setup_managed_roles):
    """Organization Cloud User can read cloud rows for one org but cannot mutate them."""
    other_org = Organization.objects.create(name='Other Cloud User Org')
    own_connection = CloudProviderConnection.objects.create(
        provider_id='digitalocean',
        name='Own Cloud User Connection',
        status='connected',
        organization=organization,
    )
    CloudProviderConnection.objects.create(
        provider_id='digitalocean',
        name='Other Cloud User Connection',
        status='connected',
        organization=other_org,
    )
    state = CloudProviderState.objects.create(
        provider_id='digitalocean',
        organization=organization,
        provider_data=DO_PROVIDER_DATA,
        admin_settings=DO_ADMIN_SETTINGS,
    )

    RoleDefinition.objects.get(name='Organization Cloud User').give_permission(rando, organization)

    response = get(reverse('api:catalog_cloud_connection_list'), rando, expect=200)
    assert [entry['id'] for entry in response.data['results']] == [own_connection.pk]

    state_response = get(
        f"{reverse('api:catalog_cloud_provider_state_detail', kwargs={'provider_id': 'digitalocean'})}?organization={organization.pk}",
        rando,
        expect=200,
    )
    assert state_response.data['id'] == state.pk

    post(
        reverse('api:catalog_cloud_connection_list'),
        {'provider_id': 'digitalocean', 'name': 'Denied', 'organization': organization.pk},
        rando,
        expect=403,
    )
    patch(
        f"{reverse('api:catalog_cloud_provider_state_detail', kwargs={'provider_id': 'digitalocean'})}?organization={organization.pk}",
        {'admin_settings': {'allowedSizeSlugs': ['s-2vcpu-2gb']}},
        rando,
        expect=403,
    )


@pytest.mark.django_db
def test_cloud_admin_persona_can_manage_org_cloud(post, patch, rando, organization, setup_managed_roles):
    """Organization Cloud Admin can create connections and update provider state inside that org."""
    RoleDefinition.objects.get(name='Organization Cloud Admin').give_permission(rando, organization)

    connection_response = post(
        reverse('api:catalog_cloud_connection_list'),
        {
            'provider_id': 'digitalocean',
            'name': 'Cloud Admin Connection',
            'status': 'connected',
            'organization': organization.pk,
        },
        rando,
        expect=201,
    )
    assert connection_response.data['organization'] == organization.pk

    state_response = patch(
        f"{reverse('api:catalog_cloud_provider_state_detail', kwargs={'provider_id': 'digitalocean'})}?organization={organization.pk}",
        {'admin_settings': {'allowedSizeSlugs': ['s-2vcpu-2gb']}},
        rando,
        expect=200,
    )
    assert state_response.data['organization'] == organization.pk
    assert state_response.data['admin_settings']['allowedSizeSlugs'] == ['s-2vcpu-2gb']


@pytest.mark.django_db
def test_cloud_provider_connection_list_is_scoped_to_org_admin(get, rando, organization):
    """Org admins list connections from their organization only."""
    other_org = Organization.objects.create(name='Other Org')
    organization.admin_role.members.add(rando)
    CloudProviderConnection.objects.create(
        provider_id='digitalocean',
        name='Own Org Connection',
        status='connected',
        organization=organization,
    )
    CloudProviderConnection.objects.create(
        provider_id='digitalocean',
        name='Other Org Connection',
        status='connected',
        organization=other_org,
    )
    CloudProviderConnection.objects.create(
        provider_id='digitalocean',
        name='Global Connection',
        status='connected',
    )

    url = reverse('api:catalog_cloud_connection_list')
    response = get(url, rando, expect=200)
    names = [c['name'] for c in response.data['results']]
    assert names == ['Own Org Connection']


@pytest.mark.django_db
def test_system_auditor_credential_admin_can_create_global_cloud_connection(post, system_auditor):
    """A platform cloud user can create a global connection for a credential they administer."""
    credential = _cloud_credential('proxmox_ve', {}, None, system_auditor)
    credential.admin_role.members.add(system_auditor)

    response = post(
        reverse('api:catalog_cloud_connection_list'),
        {
            'provider_id': 'proxmox',
            'name': 'Global Proxmox',
            'status': 'connected',
            'credential': credential.pk,
            'credential_name': credential.name,
            'organization': None,
        },
        system_auditor,
        expect=201,
    )

    assert response.data['name'] == 'Global Proxmox'
    assert response.data['credential'] == credential.pk
    assert response.data['organization'] is None


@pytest.mark.django_db
def test_system_auditor_credential_admin_can_update_global_cloud_connection(patch, system_auditor):
    """A credential admin can reconnect a global cloud connection that uses their credential."""
    credential = _cloud_credential('proxmox_ve', {}, None, system_auditor)
    credential.admin_role.members.add(system_auditor)
    connection = CloudProviderConnection.objects.create(
        provider_id='proxmox',
        name='Global Proxmox',
        status='disconnected',
        credential=credential,
        credential_name=credential.name,
    )

    response = patch(
        reverse('api:catalog_cloud_connection_detail', kwargs={'pk': connection.pk}),
        {'status': 'connected', 'credential': credential.pk, 'credential_name': credential.name, 'error': ''},
        system_auditor,
        expect=200,
    )

    assert response.data['status'] == 'connected'
    assert response.data['credential'] == credential.pk


@pytest.mark.django_db
def test_system_auditor_without_credential_admin_cannot_update_global_cloud_connection(patch, system_auditor):
    """A platform auditor cannot mutate unrelated global cloud connections."""
    credential = _cloud_credential('proxmox_ve', {}, None, system_auditor)
    connection = CloudProviderConnection.objects.create(
        provider_id='proxmox',
        name='Global Proxmox',
        status='disconnected',
        credential=credential,
        credential_name=credential.name,
    )

    patch(
        reverse('api:catalog_cloud_connection_detail', kwargs={'pk': connection.pk}),
        {'status': 'connected', 'credential': credential.pk, 'credential_name': credential.name, 'error': ''},
        system_auditor,
        expect=403,
    )


@pytest.mark.django_db
@pytest.mark.parametrize('provider_id, namespace, inputs, url_name', CLOUD_CONNECTOR_ENDPOINTS)
def test_cloud_connector_endpoint_rejects_other_org_connection(
    post,
    rando,
    organization,
    provider_id,
    namespace,
    inputs,
    url_name,
):
    """Connector validate/pull endpoints cannot use a connection from another organization."""
    other_org = Organization.objects.create(name='Other Org')
    organization.admin_role.members.add(rando)
    credential = _cloud_credential(namespace, inputs, organization, rando)
    foreign_connection = CloudProviderConnection.objects.create(
        provider_id=provider_id,
        name='Other Org Connection',
        status='connected',
        organization=other_org,
        credential=credential,
    )

    post(
        reverse(url_name),
        {'credential_id': credential.pk, 'connection_id': foreign_connection.pk},
        rando,
        expect=403,
    )


@pytest.mark.django_db
def test_cloud_connector_endpoint_rejects_connection_organization_mismatch(post, rando, organization):
    """Connector endpoints must reject payload org context that does not match connection org."""
    other_org = Organization.objects.create(name='Other Org')
    organization.admin_role.members.add(rando)
    credential = _cloud_credential('proxmox_ve', {}, organization, rando)
    connection = CloudProviderConnection.objects.create(
        provider_id='proxmox',
        name='Own Org Connection',
        status='connected',
        organization=organization,
        credential=credential,
    )

    response = post(
        reverse('api:catalog_cloud_proxmox_pull_resources'),
        {
            'credential_id': credential.pk,
            'connection_id': connection.pk,
            'organization': other_org.pk,
        },
        rando,
        expect=400,
    )

    assert 'organization' in str(response.data)


@pytest.mark.django_db
@pytest.mark.parametrize(
    'namespace, inputs, auth_url, auth_user, auth_password, verify',
    [
        (
            'vmware',
            {
                'host': 'legacy-vcenter.example',
                'username': 'legacy-admin',
                'password': 'legacy-secret',
                'validate_certs': False,
            },
            'https://legacy-vcenter.example/rest/com/vmware/cis/session',
            'legacy-admin',
            'legacy-secret',
            False,
        ),
        (
            'vmware_vsphere_terraform',
            {
                'vsphere_server': 'vcenter.example',
                'vsphere_user': 'administrator@vsphere.local',
                'vsphere_password': 'secret',
                'vsphere_allow_unverified_ssl': True,
            },
            'https://vcenter.example/rest/com/vmware/cis/session',
            'administrator@vsphere.local',
            'secret',
            False,
        ),
    ],
)
def test_vmware_pull_resources_accepts_supported_credential_types(
    post,
    admin_user,
    organization,
    mocker,
    namespace,
    inputs,
    auth_url,
    auth_user,
    auth_password,
    verify,
):
    credential = _cloud_credential(namespace, inputs, organization, admin_user)
    connection = CloudProviderConnection.objects.create(
        provider_id='vmware',
        name='Lab vCenter',
        status='connected',
        organization=organization,
        credential=credential,
        credential_name=credential.name,
    )
    session = mocker.Mock()
    session.headers = {}
    session.post.return_value = _FakeResponse({'value': 'session-token'})
    session.get.side_effect = [
        _FakeResponse({'value': [{'datacenter': 'dc-1', 'name': 'Datacenter'}]}),
        _FakeResponse({'value': [{'cluster': 'cluster-1', 'name': 'Cluster', 'ha_enabled': True, 'drs_enabled': True}]}),
        _FakeResponse({'value': [{'cluster': 'cluster-1', 'name': 'Cluster', 'ha_enabled': True, 'drs_enabled': True}]}),
        _FakeResponse(
            {
                'value': [
                    {
                        'host': 'host-1',
                        'name': 'esxi-1',
                        'power_state': 'POWERED_ON',
                        'connection_state': 'CONNECTED',
                    }
                ]
            }
        ),
        _FakeResponse(
            {
                'value': [
                    {
                        'host': 'host-1',
                        'name': 'esxi-1',
                        'power_state': 'POWERED_ON',
                        'connection_state': 'CONNECTED',
                    }
                ]
            }
        ),
        _FakeResponse({'value': [{'vm': 'vm-1', 'name': 'web-1', 'power_state': 'POWERED_ON', 'cpu_count': 2, 'memory_size_MiB': 4096}]}),
        _FakeResponse({'value': [{'vm': 'vm-1', 'name': 'web-1', 'power_state': 'POWERED_ON', 'cpu_count': 2, 'memory_size_MiB': 4096}]}),
        _FakeResponse(
            {
                'value': {
                    'guest_OS': 'UBUNTU_64',
                    'cpu': {'count': 4, 'cores_per_socket': 2, 'hot_add_enabled': True},
                    'memory': {'size_MiB': 8192, 'hot_add_enabled': True},
                    'hardware': {'version': 'VMX_19'},
                    'identity': {'instance_uuid': 'instance-uuid', 'bios_uuid': 'bios-uuid'},
                    'disks': [
                        {
                            'value': {
                                'capacity': 10737418240,
                                'backing': {'vmdk_file': '[datastore1] web-1/web-1.vmdk'},
                            }
                        }
                    ],
                    'nics': [{'value': {'label': 'Network adapter 1'}}],
                    'cdroms': [],
                }
            }
        ),
        _FakeResponse(
            {
                'value': {
                    'full_name': {'default_message': 'Ubuntu Linux (64-bit)'},
                    'name': 'UBUNTU_64',
                    'host_name': 'web-1.example.test',
                    'ip_address': '192.0.2.10',
                }
            }
        ),
        _FakeResponse({'value': [{'network': 'network-1', 'name': 'VM Network', 'type': 'STANDARD_PORTGROUP'}]}),
        _FakeResponse({'value': [{'network': 'network-1', 'name': 'VM Network', 'type': 'STANDARD_PORTGROUP'}]}),
        _FakeResponse({'value': [{'datastore': 'datastore-1', 'name': 'datastore1', 'type': 'VMFS', 'capacity': 1073741824, 'free_space': 536870912}]}),
        _FakeResponse({'value': [{'datastore': 'datastore-1', 'name': 'datastore1', 'type': 'VMFS', 'capacity': 1073741824, 'free_space': 536870912}]}),
    ]
    mocker.patch('awx.api.views.requests.Session', return_value=session)

    response = post(
        reverse('api:catalog_cloud_vmware_pull_resources'),
        {'credential_id': credential.pk, 'connection_id': connection.pk, 'organization': organization.pk},
        admin_user,
        expect=200,
    )

    assert session.verify is verify
    session.post.assert_called_once_with(
        auth_url,
        auth=(auth_user, auth_password),
        timeout=20,
    )
    assert response.data['provider'] == 'vmware'
    assert response.data['vm_count'] == 1
    assert response.data['host_count'] == 1

    state = CloudProviderState.objects.get(provider_id='vmware', organization=organization)
    assert state.provider_data[str(connection.pk)]['hosts'][0]['name'] == 'esxi-1'
    assert state.provider_data[str(connection.pk)]['hosts'][0]['cluster_id'] == 'cluster-1'
    assert state.provider_data[str(connection.pk)]['hosts'][0]['vm_count'] == 1
    vm = state.provider_data[str(connection.pk)]['vms'][0]
    assert vm['name'] == 'web-1'
    assert vm['host_id'] == 'host-1'
    assert vm['cluster_id'] == 'cluster-1'
    assert vm['guest_full_name'] == 'Ubuntu Linux (64-bit)'
    assert vm['ip_address'] == '192.0.2.10'
    assert vm['disk_capacity_bytes'] == 10737418240
    assert vm['datastore_names'] == ['datastore1']
    assert state.provider_data[str(connection.pk)]['datastores'][0]['capacity_mb'] == 1024
    assert state.provider_data[str(connection.pk)]['datacenters'][0]['cluster_count'] == 1


@pytest.mark.django_db
def test_do_cloud_provider_connection_activity_stream_on_create(admin_user):
    """Creating a CloudProviderConnection generates an activity stream entry."""
    from awx.main.models import ActivityStream

    before_count = ActivityStream.objects.filter(operation='create').count()

    CloudProviderConnection.objects.create(
        provider_id='digitalocean',
        name='Activity Stream Test',
        status='disconnected',
    )

    after_count = ActivityStream.objects.filter(operation='create').count()
    assert after_count > before_count


@pytest.mark.django_db
def test_do_cloud_provider_state_activity_stream_on_create(admin_user):
    """Creating a CloudProviderState generates an activity stream entry."""
    from awx.main.models import ActivityStream

    before_count = ActivityStream.objects.filter(operation='create').count()

    CloudProviderState.objects.create(
        provider_id='digitalocean-activity-test',
        admin_settings=DO_ADMIN_SETTINGS,
    )

    after_count = ActivityStream.objects.filter(operation='create').count()
    assert after_count > before_count


# ---------------------------------------------------------------------------
# DigitalOcean extra vars forwarding
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_do_deploy_extra_vars_forwarded(post, admin_user, do_catalog_item):
    """DigitalOcean-specific extra vars are stored in the deployment record."""
    post(
        reverse('api:catalog_item_deploy', kwargs={'pk': do_catalog_item.pk}),
        {
            'target_provider': 'digitalocean',
            'extra_vars': {
                'vm_hostname': 'my-droplet',
                'do_droplet_size': 's-1vcpu-1gb',
                'do_image_id': 101,
                'do_region': 'nyc3',
                'do_vpc_uuid': 'vpc-abc123',
            },
        },
        admin_user,
        expect=201,
    )

    deployment = CatalogDeployment.objects.filter(catalog_item=do_catalog_item).last()
    assert deployment is not None
    assert deployment.extra_vars.get('vm_hostname') == 'my-droplet'
    assert deployment.extra_vars.get('do_droplet_size') == 's-1vcpu-1gb'
    assert deployment.extra_vars.get('do_region') == 'nyc3'
    assert deployment.extra_vars.get('do_image_id') == 101
    assert deployment.extra_vars.get('do_vpc_uuid') == 'vpc-abc123'
