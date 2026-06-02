import json
from types import SimpleNamespace

import pytest

from awx.api.views import mcp
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
    assert manifest.data['capabilities']['auth']['oauth2_scope_model']['read'] == 'mcp:read'
    assert manifest.data['capabilities']['auth']['oauth2_scope_model']['write'] == 'mcp:write'
    assert manifest.data['capabilities']['policy_context']['rag']['embedding_provider'] == 'local_hash_vector'
    assert manifest.data['capabilities']['policy_context']['rag']['document_count'] == 1
    assert manifest.data['policy_context_enabled'] is True
    assert manifest.data['tool_count'] == len(tools.data['tools'])
    assert next(tool for tool in tools.data['tools'] if tool['name'] == 'launch_job')['mcp_scope'] == 'mcp:write'
    assert next(tool for tool in tools.data['tools'] if tool['name'] == 'get_job_status')['mcp_scope'] == 'mcp:read'
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
def test_mcp_policy_context_uses_vector_ranking_and_hides_embeddings(post, admin_user, settings):
    settings.MCP_POLICY_CONTEXT = (
        'Launch approval policy\nHuman approval is required before destructive job template launches.\n\n'
        'Catalog lease policy\nProduction VM deployments need lease renewal and expiry review.\n\n'
        'Credential hygiene policy\nRotate cloud API credentials after incident response.'
    )

    response = post(
        reverse('api:mcp_invoke'),
        {'name': 'get_policy_context', 'arguments': {'query': 'production vm deploy lease renewal', 'limit': 1}},
        admin_user,
        expect=200,
    )

    result = _mcp_result(response)
    context = result['policy_context']
    assert result['count'] == 1
    assert context[0]['title'] == 'Catalog lease policy'
    assert context[0]['score'] > 0
    assert 'lease' in context[0]['matched_terms']
    assert '_embedding' not in context[0]


def test_mcp_oauth_scope_helper_enforces_write_scope_for_launch():
    read_request = SimpleNamespace(auth=SimpleNamespace(scope='mcp:read'))
    write_request = SimpleNamespace(auth=SimpleNamespace(scope='mcp:write'))
    legacy_write_request = SimpleNamespace(auth=SimpleNamespace(scope='write'))

    allowed, detail = mcp._check_mcp_tool_scope(read_request, 'launch_job')
    assert allowed is False
    assert 'mcp:write' in detail
    assert mcp._check_mcp_tool_scope(write_request, 'launch_job') == (True, None)
    assert mcp._check_mcp_tool_scope(legacy_write_request, 'launch_job') == (True, None)


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
