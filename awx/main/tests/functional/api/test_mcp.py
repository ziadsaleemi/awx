import json

import pytest

from awx.api.versioning import reverse
from awx.main.models import ActivityStream, CatalogDeployment, CatalogItem, Organization


def _mcp_result(response):
    return json.loads(response.data['content'][0]['text'])


def _activity_changes(entry):
    return json.loads(entry.changes) if isinstance(entry.changes, str) else entry.changes


@pytest.mark.django_db
def test_mcp_manifest_and_tools_expose_policy_context(get, admin_user, settings):
    settings.MCP_POLICY_CONTEXT = 'Launch policy\nOnly run approved production automation.'

    manifest = get(reverse('api:mcp_manifest'), admin_user, expect=200)
    tools = get(reverse('api:mcp_tools'), admin_user, expect=200)

    tool_names = {tool['name'] for tool in tools.data['tools']}
    assert manifest.data['capabilities']['audit']['activity_stream'] is True
    assert manifest.data['policy_context_enabled'] is True
    assert manifest.data['tool_count'] == len(tools.data['tools'])
    assert {'list_catalog_items', 'list_catalog_deployments', 'get_catalog_deployment', 'get_policy_context'} <= tool_names


@pytest.mark.django_db
def test_mcp_manifest_urls_respect_forwarded_headers(get, admin_user):
    manifest = get(
        reverse('api:mcp_manifest'),
        admin_user,
        expect=200,
        HTTP_X_FORWARDED_PROTO='https',
        HTTP_X_FORWARDED_HOST='awx.example.test',
    )

    assert manifest.data['tools_url'] == 'https://awx.example.test/api/v2/mcp/tools/'
    assert manifest.data['invoke_url'] == 'https://awx.example.test/api/v2/mcp/invoke/'


@pytest.mark.django_db
def test_mcp_list_catalog_deployments_is_rbac_scoped_and_includes_policy_context(post, org_admin, organization, settings):
    settings.MCP_POLICY_CONTEXT = 'Catalog lease policy\nExpired and production deployments require human review.'
    other_org = Organization.objects.create(name='mcp-other-org')
    own_item = CatalogItem.objects.create(name='MCP Own VM', organization=organization)
    other_item = CatalogItem.objects.create(name='MCP Other VM', organization=other_org)
    own_deployment = CatalogDeployment.objects.create(
        name='mcp-own-deployment',
        catalog_item=own_item,
        owner=org_admin,
        status='active',
    )
    other_deployment = CatalogDeployment.objects.create(
        name='mcp-other-deployment',
        catalog_item=other_item,
        owner=org_admin,
        status='active',
    )

    response = post(
        reverse('api:mcp_invoke'),
        {'name': 'list_catalog_deployments', 'arguments': {'search': 'mcp', 'page_size': 10}},
        org_admin,
        expect=200,
    )

    result = _mcp_result(response)
    deployment_ids = {deployment['id'] for deployment in result['catalog_deployments']}
    assert response.data['isError'] is False
    assert own_deployment.pk in deployment_ids
    assert other_deployment.pk not in deployment_ids
    assert result['policy_context'][0]['title'] == 'Catalog lease policy'


@pytest.mark.django_db
def test_mcp_get_catalog_deployment_rejects_inaccessible_deployment(post, org_admin):
    other_org = Organization.objects.create(name='mcp-foreign-org')
    other_item = CatalogItem.objects.create(name='MCP Foreign VM', organization=other_org)
    other_deployment = CatalogDeployment.objects.create(
        name='mcp-foreign-deployment',
        catalog_item=other_item,
        owner=org_admin,
        status='active',
    )

    response = post(
        reverse('api:mcp_invoke'),
        {'name': 'get_catalog_deployment', 'arguments': {'id': other_deployment.pk}},
        org_admin,
        expect=200,
    )

    result = _mcp_result(response)
    assert response.data['isError'] is True
    assert 'not found or not accessible' in result['error']


@pytest.mark.django_db
def test_mcp_invoke_writes_activity_stream_audit(post, admin_user, job_template):
    response = post(
        reverse('api:mcp_invoke'),
        {'name': 'get_job_template', 'arguments': {'id': job_template.pk}},
        admin_user,
        expect=200,
    )

    result = _mcp_result(response)
    audit_entry = ActivityStream.objects.filter(actor=admin_user, object1='mcp', object2='job_template').last()
    changes = _activity_changes(audit_entry)

    assert result['id'] == job_template.pk
    assert response.data['isError'] is False
    assert changes['triggered_by'] == 'mcp_agent'
    assert changes['source'] == 'mcp'
    assert changes['action'] == 'get_job_template'
    assert changes['resource'] == 'job_template'
    assert changes['resource_id'] == job_template.pk
    assert changes['is_error'] is False
    assert admin_user in audit_entry.user.all()
    assert job_template in audit_entry.job_template.all()
