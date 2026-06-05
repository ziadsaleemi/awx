import hashlib
import json
from unittest import mock

import pytest
import requests
from django.test import override_settings

from awx.api.versioning import reverse
from awx.api.views.opa import OPAPolicyEngine, check_opa_policy, opa_response_allows
from awx.main.models import ActivityStream, CatalogDeployment, CatalogItem, Job, SystemJob, TerraformJob, WorkflowJob
from awx.main.tasks.policy import OPA_AUTH_TYPES


def _json_response(data, status_code=200):
    response = mock.Mock()
    response.status_code = status_code
    response.json.return_value = data
    response.raise_for_status.return_value = None
    return response


def _json_error_response(data, status_code=400, message='request failed'):
    response = _json_response(data, status_code=status_code)
    error = requests.HTTPError(message)
    error.response = response
    response.raise_for_status.side_effect = error
    return response


@pytest.mark.django_db
@override_settings(OPA_HOST='opa.example.com', OPA_PORT=8181, OPA_SSL=True, OPA_POLICY_BUNDLE='package awx\nallow := true')
def test_opa_policy_list_uses_registered_policy_settings(get, admin_user):
    response = get(reverse('api:opa_policies'), user=admin_user, expect=200)

    assert response.data['enabled'] is True
    assert response.data['server_url'] == 'https://opa.example.com:8181'
    assert {policy['id'] for policy in response.data['policies']} >= {'job_launch', 'ai_action'}
    job_launch_policy = next(policy for policy in response.data['policies'] if policy['id'] == 'job_launch')
    ai_action_policy = next(policy for policy in response.data['policies'] if policy['id'] == 'ai_action')
    assert job_launch_policy['input_example']['source'] == 'api'
    assert job_launch_policy['input_example']['launch']['extra_var_keys'] == ['env']
    assert ai_action_policy['input_example']['source'] == 'workflow_ai_task'
    assert ai_action_policy['input_example']['destructive'] is True
    assert ai_action_policy['input_example']['human_approved'] is True
    assert response.data['policy_bundle']['configured'] is True
    assert response.data['policy_bundle']['size'] == len('package awx\nallow := true')
    assert response.data['policy_bundle']['line_count'] == 2
    assert response.data['policy_bundle']['sha256'] == hashlib.sha256(b'package awx\nallow := true').hexdigest()
    assert response.data['policy_bundle']['sync_endpoint'] == '/api/v2/opa/policies/sync/'


@pytest.mark.django_db
def test_opa_policy_list_requires_system_admin(get, rando):
    get(reverse('api:opa_policies'), user=rando, expect=403)


@pytest.mark.django_db
@override_settings(OPA_HOST='')
def test_policy_operator_can_view_and_evaluate_policy_as_code(get, post, organization, rando):
    organization.policy_operator_role.members.add(rando)

    get(reverse('api:opa_policies'), user=rando, expect=200)
    response = post(
        reverse('api:opa_evaluate'),
        data={'policy_path': 'awx/job_launch/allow', 'input': {}},
        user=rando,
        expect=200,
    )

    assert response.data['allowed'] is True
    assert response.data['detail'] == 'OPA is not enabled or configured.'


@pytest.mark.django_db
@override_settings(OPA_HOST='')
def test_opa_evaluate_disabled_fails_open(get, admin_user):
    response = get(reverse('api:opa_policies'), user=admin_user, expect=200)

    assert response.data['enabled'] is False
    assert response.data['server_url'] == ''


@pytest.mark.django_db
def test_opa_evaluate_requires_system_admin(post, rando):
    post(
        reverse('api:opa_evaluate'),
        data={'policy_path': 'awx/job_launch/allow', 'input': {}},
        user=rando,
        expect=403,
    )


@pytest.mark.django_db
def test_opa_policy_sync_requires_system_admin(post, rando):
    post(reverse('api:opa_policies_sync'), data={}, user=rando, expect=403)


@pytest.mark.django_db
@override_settings(
    OPA_HOST='opa.example.com',
    OPA_PORT=8181,
    OPA_SSL=True,
    OPA_AUTH_TYPE=OPA_AUTH_TYPES.TOKEN,
    OPA_AUTH_TOKEN='secret-token',
    OPA_AUTH_CUSTOM_HEADERS={'X-Custom': 'Header'},
    OPA_REQUEST_TIMEOUT=2.5,
    OPA_POLICY_BUNDLE='package awx\nallow := true',
)
def test_opa_policy_sync_puts_managed_rego_to_real_opa_policy_api(post, admin_user):
    opa_response = mock.Mock()
    opa_response.status_code = 200
    opa_response.content = b'{"result":{}}'
    opa_response.json.return_value = {'result': {}}
    opa_response.raise_for_status.return_value = None

    with mock.patch('awx.api.views.opa.requests.put', return_value=opa_response) as requests_put:
        response = post(
            reverse('api:opa_policies_sync'),
            data={'policy_id': 'awx/managed'},
            user=admin_user,
            expect=200,
        )

    assert response.data['changed'] is True
    assert response.data['policy_id'] == 'awx/managed'
    assert response.data['size'] == len('package awx\nallow := true')
    assert response.data['line_count'] == 2
    assert response.data['sha256'] == hashlib.sha256(b'package awx\nallow := true').hexdigest()
    assert response.data['opa_response'] == {'result': {}}
    requests_put.assert_called_once_with(
        'https://opa.example.com:8181/v1/policies/awx/managed',
        data='package awx\nallow := true',
        timeout=2.5,
        headers={
            'Content-Type': 'text/plain',
            'X-Custom': 'Header',
            'Authorization': 'Bearer secret-token',
        },
        cert=None,
        verify=True,
    )


@override_settings(
    OPA_HOST='opa.example.com',
    OPA_PORT=8181,
    OPA_SSL=True,
    OPA_AUTH_TYPE=OPA_AUTH_TYPES.TOKEN,
    OPA_AUTH_TOKEN='secret-token',
    OPA_AUTH_CUSTOM_HEADERS={'X-Custom': 'Header'},
    OPA_REQUEST_TIMEOUT=2.5,
)
@pytest.mark.django_db
def test_opa_policy_engine_deletes_policy_from_real_opa_policy_api():
    opa_response = mock.Mock()
    opa_response.status_code = 204
    opa_response.content = b''
    opa_response.raise_for_status.return_value = None

    with mock.patch('awx.api.views.opa.requests.delete', return_value=opa_response) as requests_delete:
        response = OPAPolicyEngine().delete_policy('/awx/temp deny')

    assert response == {'status_code': 204}
    requests_delete.assert_called_once_with(
        'https://opa.example.com:8181/v1/policies/awx/temp%20deny',
        timeout=2.5,
        headers={
            'Content-Type': 'application/json',
            'X-Custom': 'Header',
            'Authorization': 'Bearer secret-token',
        },
        cert=None,
        verify=True,
    )


@pytest.mark.django_db
@override_settings(OPA_HOST='opa.example.com', OPA_POLICY_BUNDLE='')
def test_opa_policy_sync_requires_managed_bundle_text(post, admin_user):
    response = post(reverse('api:opa_policies_sync'), data={}, user=admin_user, expect=400)

    assert response.data['detail'] == 'OPA_POLICY_BUNDLE is empty. Save Rego policy text before syncing.'


@pytest.mark.django_db
@override_settings(OPA_HOST='opa.example.com', OPA_POLICY_BUNDLE='package awx\nallow := true')
def test_opa_policy_sync_rejects_invalid_policy_id(post, admin_user):
    response = post(
        reverse('api:opa_policies_sync'),
        data={'policy_id': '../bad'},
        user=admin_user,
        expect=400,
    )

    assert response.data['detail'] == 'policy_id contains invalid characters.'


@pytest.mark.django_db
@override_settings(OPA_HOST='opa.example.com', OPA_PORT=8181, OPA_SSL=True, OPA_REQUEST_TIMEOUT=2.5)
def test_opa_policy_modules_list_live_modules(get, admin_user):
    opa_response = mock.Mock()
    opa_response.json.return_value = {
        'result': [
            {
                'id': 'awx/job_launch',
                'raw': 'package awx.job_launch\n\ndefault allow := false\nallow if { input.user.is_superuser }\n',
                'ast': {
                    'package': {
                        'path': [
                            {'type': 'var', 'value': 'data'},
                            {'type': 'string', 'value': 'awx'},
                            {'type': 'string', 'value': 'job_launch'},
                        ]
                    },
                    'rules': [{'head': {'name': 'allow'}}],
                },
            }
        ]
    }
    opa_response.raise_for_status.return_value = None

    with mock.patch('awx.api.views.opa.requests.get', return_value=opa_response) as requests_get:
        response = get(reverse('api:opa_policy_modules'), user=admin_user, expect=200)

    assert response.data['enabled'] is True
    assert response.data['server_url'] == 'https://opa.example.com:8181'
    assert response.data['count'] == 1
    assert response.data['modules'][0]['id'] == 'awx/job_launch'
    assert response.data['modules'][0]['package'] == 'awx.job_launch'
    assert response.data['modules'][0]['rules'] == ['allow']
    assert response.data['modules'][0]['decision_paths'] == ['awx/job_launch/allow']
    assert response.data['modules'][0]['awx_managed'] is True
    requests_get.assert_called_once_with(
        'https://opa.example.com:8181/v1/policies',
        timeout=2.5,
        headers={'Content-Type': 'application/json'},
        cert=None,
        verify=True,
    )


@pytest.mark.django_db
def test_opa_policy_modules_require_system_admin(get, post, delete, rando):
    get(reverse('api:opa_policy_modules'), user=rando, expect=403)
    post(reverse('api:opa_policy_modules'), data={'policy_id': 'awx/managed', 'policy_text': 'package awx'}, user=rando, expect=403)
    get(reverse('api:opa_policy_module_versions', kwargs={'policy_id': 'awx/managed'}), user=rando, expect=403)
    post(
        reverse('api:opa_policy_module_rollback', kwargs={'policy_id': 'awx/managed'}),
        data={'activity_stream_id': 1, 'version': 'before'},
        user=rando,
        expect=403,
    )
    delete(reverse('api:opa_policy_module_detail', kwargs={'policy_id': 'awx/managed'}), user=rando, expect=403)


@pytest.mark.django_db
@override_settings(OPA_HOST='opa.example.com', OPA_PORT=8181, OPA_SSL=False, OPA_REQUEST_TIMEOUT=2.5)
def test_policy_author_can_manage_opa_policy_modules(post, organization, rando):
    organization.policy_author_role.members.add(rando)
    get_response = _json_error_response({'message': 'not found'}, status_code=404)
    put_response = mock.Mock()
    put_response.status_code = 200
    put_response.content = b'{}'
    put_response.json.return_value = {}
    put_response.raise_for_status.return_value = None

    with mock.patch('awx.api.views.opa.requests.get', return_value=get_response), mock.patch(
        'awx.api.views.opa.requests.put', return_value=put_response
    ) as requests_put:
        response = post(
            reverse('api:opa_policy_modules'),
            data={'policy_id': 'awx/operator', 'policy_text': 'package awx.operator\nallow := true\n'},
            user=rando,
            expect=200,
        )

    assert response.data['created'] is True
    assert response.data['module']['id'] == 'awx/operator'
    requests_put.assert_called_once()


@pytest.mark.django_db
@override_settings(OPA_HOST='opa.example.com')
def test_policy_operator_cannot_mutate_opa_policy_modules(post, organization, rando):
    organization.policy_operator_role.members.add(rando)
    post(
        reverse('api:opa_policy_modules'),
        data={'policy_id': 'awx/operator', 'policy_text': 'package awx.operator'},
        user=rando,
        expect=403,
    )
    post(reverse('api:opa_policies_sync'), data={'policy_id': 'awx/managed'}, user=rando, expect=403)


@pytest.mark.django_db
@override_settings(GATEKEEPER_K8S_API_URL='')
def test_gatekeeper_policy_manager_disabled_returns_empty_state(get, admin_user):
    response = get(reverse('api:opa_gatekeeper'), user=admin_user, expect=200)

    assert response.data['configured'] is False
    assert response.data['counts'] == {
        'constraint_templates': 0,
        'constraints': 0,
        'violations': 0,
        'filtered_violations': 0,
        'configs': 0,
    }
    assert response.data['violation_query'] == {
        'search': '',
        'sort': 'constraint',
        'limit': 50,
        'page': 1,
        'offset': 0,
        'total_pages': 1,
        'returned': 0,
    }
    assert response.data['constraint_templates'] == []
    assert response.data['message'] == 'Configure the Gatekeeper Kubernetes API connection in Settings.'


@pytest.mark.django_db
def test_gatekeeper_policy_manager_requires_system_admin(get, rando):
    get(reverse('api:opa_gatekeeper'), user=rando, expect=403)


@pytest.mark.django_db
@override_settings(GATEKEEPER_K8S_API_URL='')
def test_policy_operator_can_view_gatekeeper(get, organization, rando):
    organization.policy_operator_role.members.add(rando)
    get(reverse('api:opa_gatekeeper'), user=rando, expect=200)


def _gatekeeper_policy_manager_responses():
    return [
        _json_response(
            {
                'items': [
                    {
                        'apiVersion': 'templates.gatekeeper.sh/v1',
                        'metadata': {'name': 'k8srequiredlabels'},
                        'spec': {
                            'crd': {
                                'spec': {
                                    'names': {'kind': 'K8sRequiredLabels'},
                                    'validation': {'openAPIV3Schema': {'type': 'object'}},
                                }
                            },
                            'targets': [
                                {
                                    'target': 'admission.k8s.gatekeeper.sh',
                                    'rego': 'package k8srequiredlabels\nviolation[{}] { true }',
                                    'libs': ['package lib.labels'],
                                }
                            ],
                        },
                        'status': {'created': True, 'observedGeneration': 3, 'byPod': [{'id': 'gatekeeper-a', 'observedGeneration': 3}]},
                    }
                ]
            }
        ),
        _json_response(
            {
                'preferredVersion': {'version': 'v1beta1'},
                'versions': [{'version': 'v1beta1'}],
            }
        ),
        _json_response(
            {
                'resources': [
                    {'name': 'k8srequiredlabels', 'kind': 'K8sRequiredLabels', 'verbs': ['get', 'list']},
                    {'name': 'constraintpodstatuses', 'kind': 'ConstraintPodStatus', 'verbs': ['get', 'list']},
                    {'name': 'k8srequiredlabels/status', 'kind': 'K8sRequiredLabels', 'verbs': ['get']},
                ]
            }
        ),
        _json_response(
            {
                'items': [
                    {
                        'apiVersion': 'constraints.gatekeeper.sh/v1beta1',
                        'kind': 'K8sRequiredLabels',
                        'metadata': {'name': 'require-team'},
                        'spec': {
                            'enforcementAction': 'dryrun',
                            'match': {'kinds': [{'apiGroups': [''], 'kinds': ['Pod']}]},
                            'parameters': {'labels': ['team']},
                        },
                        'status': {
                            'totalViolations': 1,
                            'auditTimestamp': '2026-06-02T00:00:00Z',
                            'byPod': [{'id': 'gatekeeper-a', 'observedGeneration': 3}],
                            'violations': [
                                {
                                    'message': 'missing team label',
                                    'kind': 'Pod',
                                    'namespace': 'default',
                                    'name': 'nginx',
                                    'group': '',
                                    'version': 'v1',
                                }
                            ],
                        },
                    },
                    {
                        'apiVersion': 'constraints.gatekeeper.sh/v1beta1',
                        'kind': 'K8sRequiredLabels',
                        'metadata': {'name': 'require-owner'},
                        'spec': {
                            'enforcementAction': 'deny',
                            'match': {'kinds': [{'apiGroups': [''], 'kinds': ['Namespace']}]},
                            'parameters': {'labels': ['owner']},
                        },
                        'status': {
                            'totalViolations': 1,
                            'auditTimestamp': '2026-06-02T01:00:00Z',
                            'violations': [
                                {
                                    'message': 'missing owner label',
                                    'kind': 'Namespace',
                                    'namespace': '',
                                    'name': 'payments',
                                    'group': '',
                                    'version': 'v1',
                                }
                            ],
                        },
                    },
                ]
            }
        ),
        _json_response(
            {
                'items': [
                    {
                        'apiVersion': 'config.gatekeeper.sh/v1alpha1',
                        'metadata': {'name': 'config'},
                        'spec': {
                            'sync': {'syncOnly': [{'group': '', 'version': 'v1', 'kind': 'Pod'}]},
                            'match': [{'excludedNamespaces': ['kube-system'], 'processes': ['audit']}],
                            'readiness': {'statsEnabled': True},
                        },
                    }
                ]
            }
        ),
    ]


@pytest.mark.django_db
@override_settings(
    GATEKEEPER_K8S_API_URL='https://kube.example.test',
    GATEKEEPER_K8S_AUTH_TOKEN='secret-token',
    GATEKEEPER_K8S_CONTEXT='prod',
    GATEKEEPER_K8S_VERIFY_SSL=False,
    GATEKEEPER_K8S_REQUEST_TIMEOUT=7,
)
def test_gatekeeper_policy_manager_summarizes_templates_constraints_configs_and_violations(get, admin_user):
    responses = _gatekeeper_policy_manager_responses()

    with mock.patch('awx.api.views.gatekeeper.requests.get', side_effect=responses) as requests_get:
        response = get(reverse('api:opa_gatekeeper'), user=admin_user, expect=200)

    assert response.data['configured'] is True
    assert response.data['cluster'] == {
        'server_url': 'https://kube.example.test',
        'context': 'prod',
        'verify_ssl': False,
    }
    assert response.data['api_versions']['constraint_templates'] == 'v1'
    assert response.data['counts'] == {
        'constraint_templates': 1,
        'constraints': 2,
        'violations': 2,
        'filtered_violations': 2,
        'configs': 1,
    }
    assert response.data['violation_query'] == {
        'search': '',
        'sort': 'constraint',
        'limit': 50,
        'page': 1,
        'offset': 0,
        'total_pages': 1,
        'returned': 2,
    }
    template = response.data['constraint_templates'][0]
    assert template['name'] == 'k8srequiredlabels'
    assert template['kind'] == 'K8sRequiredLabels'
    assert template['created'] is True
    assert template['constraint_count'] == 2
    assert template['targets'][0]['rego'].startswith('package k8srequiredlabels')
    constraint = next(item for item in response.data['constraints'] if item['name'] == 'require-team')
    assert constraint['name'] == 'require-team'
    assert constraint['enforcement_action'] == 'dryrun'
    assert constraint['total_violations'] == 1
    assert any(violation['message'] == 'missing team label' for violation in response.data['violations'])
    assert response.data['configs'][0]['sync_only_count'] == 1
    assert response.data['errors'] == []
    requests_get.assert_any_call(
        'https://kube.example.test/apis/templates.gatekeeper.sh/v1/constrainttemplates',
        headers={'Accept': 'application/json', 'Authorization': 'Bearer secret-token'},
        verify=False,
        timeout=7.0,
    )


@pytest.mark.django_db
@override_settings(
    GATEKEEPER_K8S_API_URL='https://kube.default.test',
    GATEKEEPER_K8S_CONTEXT='default',
    GATEKEEPER_K8S_CONTEXTS={
        'prod': {
            'server_url': 'https://kube.prod.test',
            'auth_token': 'prod-token',
            'verify_ssl': False,
            'request_timeout': 9,
        }
    },
)
def test_gatekeeper_policy_manager_selects_named_context(get, admin_user):
    with mock.patch('awx.api.views.gatekeeper.requests.get', side_effect=_gatekeeper_policy_manager_responses()) as requests_get:
        response = get(reverse('api:opa_gatekeeper') + '?context=prod', user=admin_user, expect=200)

    assert response.data['cluster'] == {
        'server_url': 'https://kube.prod.test',
        'context': 'prod',
        'verify_ssl': False,
    }
    assert response.data['contexts'] == [
        {
            'name': 'default',
            'selected': False,
            'configured': True,
            'server_url': 'https://kube.default.test',
            'verify_ssl': True,
            'source': 'settings',
        },
        {
            'name': 'prod',
            'selected': True,
            'configured': True,
            'server_url': 'https://kube.prod.test',
            'verify_ssl': False,
            'source': 'context_map',
        },
    ]
    requests_get.assert_any_call(
        'https://kube.prod.test/apis/templates.gatekeeper.sh/v1/constrainttemplates',
        headers={'Accept': 'application/json', 'Authorization': 'Bearer prod-token'},
        verify=False,
        timeout=9.0,
    )


@pytest.mark.django_db
@override_settings(GATEKEEPER_K8S_API_URL='https://kube.default.test', GATEKEEPER_K8S_CONTEXT='default')
def test_gatekeeper_policy_manager_rejects_unknown_context(get, admin_user):
    response = get(reverse('api:opa_gatekeeper') + '?context=missing', user=admin_user, expect=400)

    assert response.data['detail'] == 'Gatekeeper Kubernetes context "missing" is not configured.'
    assert response.data['contexts'][0]['name'] == 'default'


@pytest.mark.django_db
@override_settings(GATEKEEPER_K8S_API_URL='https://kube.example.test')
def test_gatekeeper_policy_manager_filters_sorts_and_limits_violations(get, admin_user):
    with mock.patch('awx.api.views.gatekeeper.requests.get', side_effect=_gatekeeper_policy_manager_responses()):
        response = get(
            reverse('api:opa_gatekeeper') + '?violation_search=owner&violation_sort=resource&violation_limit=1',
            user=admin_user,
            expect=200,
        )

    assert response.data['counts']['violations'] == 2
    assert response.data['counts']['filtered_violations'] == 1
    assert response.data['violation_query'] == {
        'search': 'owner',
        'sort': 'resource',
        'limit': 1,
        'page': 1,
        'offset': 0,
        'total_pages': 1,
        'returned': 1,
    }
    assert len(response.data['violations']) == 1
    assert response.data['violations'][0]['constraint_name'] == 'require-owner'
    assert response.data['violations'][0]['resource_name'] == 'payments'


@pytest.mark.django_db
@override_settings(GATEKEEPER_K8S_API_URL='https://kube.example.test')
def test_gatekeeper_policy_manager_paginates_violations(get, admin_user):
    with mock.patch('awx.api.views.gatekeeper.requests.get', side_effect=_gatekeeper_policy_manager_responses()):
        response = get(
            reverse('api:opa_gatekeeper') + '?violation_sort=constraint&violation_limit=1&violation_page=2',
            user=admin_user,
            expect=200,
        )

    assert response.data['counts']['violations'] == 2
    assert response.data['counts']['filtered_violations'] == 2
    assert response.data['violation_query'] == {
        'search': '',
        'sort': 'constraint',
        'limit': 1,
        'page': 2,
        'offset': 1,
        'total_pages': 2,
        'returned': 1,
    }
    assert len(response.data['violations']) == 1
    assert response.data['violations'][0]['constraint_name'] == 'require-team'
    assert response.data['violations'][0]['resource_name'] == 'nginx'


@pytest.mark.django_db
@override_settings(GATEKEEPER_K8S_API_URL='https://kube.example.test')
def test_gatekeeper_policy_manager_surfaces_kubernetes_auth_error(get, admin_user):
    response = mock.Mock()
    response.status_code = 403
    response.json.return_value = {'message': 'forbidden'}
    error = requests.HTTPError('forbidden')
    error.response = response
    response.raise_for_status.side_effect = error

    with mock.patch('awx.api.views.gatekeeper.requests.get', return_value=response):
        response = get(reverse('api:opa_gatekeeper'), user=admin_user, expect=403)

    assert response.data['detail'] == 'Gatekeeper Kubernetes API request failed.'
    assert response.data['error']['status_code'] == 403
    assert response.data['error']['detail'] == {'message': 'forbidden'}


@pytest.mark.django_db
def test_gatekeeper_author_requires_system_admin(post, rando):
    post(reverse('api:opa_gatekeeper_author'), data={'prompt': 'Create a required labels policy.'}, user=rando, expect=403)


@pytest.mark.django_db
@override_settings(AI_ENABLED=True, AI_PROVIDER='openai', AI_API_KEY='api-key', AI_MODEL_NAME='gpt-4o', GATEKEEPER_K8S_API_URL='https://kube.example.test')
def test_gatekeeper_author_uses_visible_context_and_returns_valid_manifest(post, admin_user):
    generated_manifest = """```yaml
apiVersion: templates.gatekeeper.sh/v1
kind: ConstraintTemplate
metadata:
  name: k8srequiredlabels
spec:
  crd:
    spec:
      names:
        kind: K8sRequiredLabels
      validation:
        openAPIV3Schema:
          type: object
  targets:
    - target: admission.k8s.gatekeeper.sh
      rego: |
        package k8srequiredlabels
        violation[{"msg": msg}] {
          msg := "missing required labels"
        }
```"""

    with mock.patch('awx.api.views.gatekeeper.requests.get', side_effect=_gatekeeper_policy_manager_responses()) as requests_get, mock.patch(
        'awx.api.views.gatekeeper._call_ai_provider', return_value=generated_manifest
    ) as call_provider:
        response = post(
            reverse('api:opa_gatekeeper_author'),
            data={
                'prompt': 'Create a required labels Gatekeeper template for namespaces.',
                'context': {'selected_detail': {'type': 'constraint', 'kind': 'K8sRequiredLabels', 'name': 'require-owner'}},
            },
            user=admin_user,
            expect=200,
        )

    assert response.data['generated'] is True
    assert response.data['provider'] == 'openai'
    assert response.data['model'] == 'gpt-4o'
    assert response.data['manifest_json']['kind'] == 'ConstraintTemplate'
    assert response.data['manifest'].startswith('apiVersion: templates.gatekeeper.sh/v1')
    assert '```' not in response.data['manifest']
    assert response.data['target']['object_path'] == '/apis/templates.gatekeeper.sh/v1/constrainttemplates/k8srequiredlabels'
    assert response.data['context']['gatekeeper']['counts']['constraints'] == 2
    assert response.data['audit']['activity_stream_id']
    requests_get.assert_called()
    system_prompt = call_provider.call_args.args[4]
    assert 'Visible AWX context' in system_prompt
    assert 'Visible Gatekeeper context' in system_prompt
    assert 'k8srequiredlabels' in system_prompt
    assert 'require-owner' in system_prompt
    assert 'selected_detail' in system_prompt
    audit = ActivityStream.objects.get(pk=response.data['audit']['activity_stream_id'])
    assert audit.object1 == 'gatekeeper_resource'
    assert audit.object2 == 'ai_author:ConstraintTemplate/k8srequiredlabels'
    assert '"source": "gatekeeper_ai_author"' in audit.changes


GATEKEEPER_TEMPLATE_MANIFEST = """
apiVersion: templates.gatekeeper.sh/v1
kind: ConstraintTemplate
metadata:
  name: k8srequiredlabels
spec:
  crd:
    spec:
      names:
        kind: K8sRequiredLabels
      validation:
        openAPIV3Schema:
          type: object
  targets:
    - target: admission.k8s.gatekeeper.sh
      rego: |
        package k8srequiredlabels
"""


@pytest.mark.django_db
def test_gatekeeper_apply_requires_system_admin(post, rando):
    post(reverse('api:opa_gatekeeper_apply'), data={'mode': 'preview', 'manifest': GATEKEEPER_TEMPLATE_MANIFEST}, user=rando, expect=403)


@pytest.mark.django_db
@override_settings(GATEKEEPER_K8S_API_URL='https://kube.example.test')
def test_policy_operator_can_preview_gatekeeper_but_not_apply(post, organization, rando):
    organization.policy_operator_role.members.add(rando)
    with mock.patch('awx.api.views.gatekeeper.requests.get', return_value=_json_error_response({'message': 'not found'}, status_code=404)), mock.patch(
        'awx.api.views.gatekeeper.requests.request'
    ) as requests_request:
        post(reverse('api:opa_gatekeeper_apply'), data={'mode': 'preview', 'manifest': GATEKEEPER_TEMPLATE_MANIFEST}, user=rando, expect=200)

    requests_request.assert_not_called()
    post(reverse('api:opa_gatekeeper_apply'), data={'mode': 'apply', 'manifest': GATEKEEPER_TEMPLATE_MANIFEST}, user=rando, expect=403)


@pytest.mark.django_db
@override_settings(GATEKEEPER_K8S_API_URL='')
def test_gatekeeper_apply_requires_configured_kubernetes_api(post, admin_user):
    response = post(reverse('api:opa_gatekeeper_apply'), data={'mode': 'preview', 'manifest': GATEKEEPER_TEMPLATE_MANIFEST}, user=admin_user, expect=400)

    assert response.data['detail'] == 'Configure the Gatekeeper Kubernetes API connection in Settings.'


@pytest.mark.django_db
@override_settings(GATEKEEPER_K8S_API_URL='https://kube.example.test')
def test_gatekeeper_apply_rejects_invalid_field_manager(post, admin_user):
    response = post(
        reverse('api:opa_gatekeeper_apply'),
        data={
            'mode': 'preview',
            'manifest': GATEKEEPER_TEMPLATE_MANIFEST,
            'apply_strategy': 'server_side',
            'field_manager': 'bad field manager',
        },
        user=admin_user,
        expect=400,
    )

    assert response.data['detail'] == 'field_manager must be 1-128 characters and may only contain letters, numbers, dot, dash, underscore, colon, or slash.'


@pytest.mark.django_db
@override_settings(GATEKEEPER_K8S_API_URL='https://kube.example.test')
def test_gatekeeper_apply_preview_returns_diff_without_kubernetes_write(post, admin_user):
    with mock.patch('awx.api.views.gatekeeper.requests.get', return_value=_json_error_response({'message': 'not found'}, status_code=404)), mock.patch(
        'awx.api.views.gatekeeper.requests.request'
    ) as requests_request:
        response = post(
            reverse('api:opa_gatekeeper_apply'),
            data={'mode': 'preview', 'manifest': GATEKEEPER_TEMPLATE_MANIFEST},
            user=admin_user,
            expect=200,
        )

    assert response.data['changed'] is False
    assert response.data['persisted'] is False
    assert response.data['dry_run'] is False
    assert response.data['operation'] == 'create'
    assert response.data['target']['object_path'] == '/apis/templates.gatekeeper.sh/v1/constrainttemplates/k8srequiredlabels'
    assert response.data['rollback_plan']['operation'] == 'delete'
    assert response.data['audit'] is None
    requests_request.assert_not_called()


@pytest.mark.django_db
@override_settings(GATEKEEPER_K8S_API_URL='https://kube.example.test', GATEKEEPER_K8S_REQUEST_TIMEOUT=7, GATEKEEPER_K8S_VERIFY_SSL=False)
def test_gatekeeper_apply_dry_run_uses_kubernetes_dry_run_and_audits(post, admin_user):
    existing = {
        'apiVersion': 'templates.gatekeeper.sh/v1',
        'kind': 'ConstraintTemplate',
        'metadata': {'name': 'k8srequiredlabels'},
        'spec': {'crd': {'spec': {'names': {'kind': 'K8sRequiredLabels'}}}},
    }
    dry_run_response = {
        **existing,
        'spec': {'crd': {'spec': {'names': {'kind': 'K8sRequiredLabels'}}}, 'status': {'dryRun': True}},
    }

    with mock.patch('awx.api.views.gatekeeper.requests.get', return_value=_json_response(existing)), mock.patch(
        'awx.api.views.gatekeeper.requests.request', return_value=_json_response(dry_run_response)
    ) as requests_request, mock.patch('awx.api.views.gatekeeper.check_opa_policy', return_value=True) as check_policy:
        response = post(
            reverse('api:opa_gatekeeper_apply'),
            data={'mode': 'dry_run', 'manifest': GATEKEEPER_TEMPLATE_MANIFEST},
            user=admin_user,
            expect=200,
        )

    assert response.data['changed'] is False
    assert response.data['persisted'] is False
    assert response.data['dry_run'] is True
    assert response.data['operation'] == 'update'
    assert response.data['opa_allowed'] is True
    assert response.data['audit']['activity_stream_id']
    check_policy.assert_called_once()
    assert check_policy.call_args.args[0] == 'awx/gatekeeper_resource/allow'
    requests_request.assert_called_once_with(
        'PUT',
        'https://kube.example.test/apis/templates.gatekeeper.sh/v1/constrainttemplates/k8srequiredlabels',
        headers={'Accept': 'application/json', 'Content-Type': 'application/json'},
        json=mock.ANY,
        params={'dryRun': 'All'},
        verify=False,
        timeout=7.0,
    )
    audit = ActivityStream.objects.get(pk=response.data['audit']['activity_stream_id'])
    assert audit.object1 == 'gatekeeper_resource'
    assert audit.object2 == 'ConstraintTemplate/k8srequiredlabels'
    assert '"mode": "dry_run"' in audit.changes


@pytest.mark.django_db
@override_settings(GATEKEEPER_K8S_API_URL='https://kube.example.test', GATEKEEPER_K8S_REQUEST_TIMEOUT=7, GATEKEEPER_K8S_VERIFY_SSL=False)
def test_gatekeeper_apply_server_side_apply_uses_field_manager_force_and_audits(post, admin_user):
    applied = {
        'apiVersion': 'templates.gatekeeper.sh/v1',
        'kind': 'ConstraintTemplate',
        'metadata': {'name': 'k8srequiredlabels'},
        'spec': {'crd': {'spec': {'names': {'kind': 'K8sRequiredLabels'}}}},
        'status': {'created': True},
    }

    with mock.patch('awx.api.views.gatekeeper.requests.get', return_value=_json_error_response({'message': 'not found'}, status_code=404)), mock.patch(
        'awx.api.views.gatekeeper.requests.request', return_value=_json_response(applied)
    ) as requests_request, mock.patch('awx.api.views.gatekeeper.check_opa_policy', return_value=True) as check_policy:
        response = post(
            reverse('api:opa_gatekeeper_apply'),
            data={
                'mode': 'apply',
                'manifest': GATEKEEPER_TEMPLATE_MANIFEST,
                'human_approved': True,
                'apply_strategy': 'server_side',
                'field_manager': 'awx-gatekeeper',
                'force_conflicts': True,
            },
            user=admin_user,
            expect=200,
        )

    assert response.data['changed'] is True
    assert response.data['persisted'] is True
    assert response.data['operation'] == 'create'
    assert response.data['apply_strategy'] == 'server_side'
    assert response.data['field_manager'] == 'awx-gatekeeper'
    assert response.data['force_conflicts'] is True
    check_policy.assert_called_once()
    assert check_policy.call_args.args[1]['apply_options'] == {
        'strategy': 'server_side',
        'field_manager': 'awx-gatekeeper',
        'force_conflicts': True,
    }
    requests_request.assert_called_once_with(
        'PATCH',
        'https://kube.example.test/apis/templates.gatekeeper.sh/v1/constrainttemplates/k8srequiredlabels',
        headers={'Accept': 'application/json', 'Content-Type': 'application/apply-patch+yaml'},
        json=mock.ANY,
        params={'fieldManager': 'awx-gatekeeper', 'force': 'true'},
        verify=False,
        timeout=7.0,
    )
    audit = ActivityStream.objects.get(pk=response.data['audit']['activity_stream_id'])
    assert audit.operation == 'create'
    assert audit.object1 == 'gatekeeper_resource'
    assert '"strategy": "server_side"' in audit.changes


@pytest.mark.django_db
@override_settings(GATEKEEPER_K8S_API_URL='https://kube.example.test')
def test_gatekeeper_apply_opa_denial_blocks_kubernetes_write_and_audits(post, admin_user):
    with mock.patch('awx.api.views.gatekeeper.requests.get', return_value=_json_error_response({'message': 'not found'}, status_code=404)), mock.patch(
        'awx.api.views.gatekeeper.requests.request'
    ) as requests_request, mock.patch('awx.api.views.gatekeeper.check_opa_policy', return_value=False):
        response = post(
            reverse('api:opa_gatekeeper_apply'),
            data={'mode': 'apply', 'manifest': GATEKEEPER_TEMPLATE_MANIFEST},
            user=admin_user,
            expect=403,
        )

    assert response.data['detail'] == 'Gatekeeper change denied by OPA policy guardrail.'
    assert response.data['opa_allowed'] is False
    requests_request.assert_not_called()
    audit = ActivityStream.objects.get(pk=response.data['audit']['activity_stream_id'])
    assert audit.object1 == 'gatekeeper_resource'
    assert '"opa_allowed": false' in audit.changes


@pytest.mark.django_db
@override_settings(GATEKEEPER_K8S_API_URL='https://kube.example.test', GATEKEEPER_K8S_REQUEST_TIMEOUT=7, GATEKEEPER_K8S_VERIFY_SSL=False)
def test_gatekeeper_delete_dry_run_uses_kubernetes_dry_run_and_audits(post, admin_user):
    existing = {
        'apiVersion': 'templates.gatekeeper.sh/v1',
        'kind': 'ConstraintTemplate',
        'metadata': {'name': 'k8srequiredlabels'},
        'spec': {'crd': {'spec': {'names': {'kind': 'K8sRequiredLabels'}}}},
    }
    delete_response = {'kind': 'Status', 'status': 'Success'}

    with mock.patch('awx.api.views.gatekeeper.requests.get', return_value=_json_response(existing)), mock.patch(
        'awx.api.views.gatekeeper.requests.request', return_value=_json_response(delete_response)
    ) as requests_request, mock.patch('awx.api.views.gatekeeper.check_opa_policy', return_value=True) as check_policy:
        response = post(
            reverse('api:opa_gatekeeper_delete'),
            data={'mode': 'dry_run', 'manifest': GATEKEEPER_TEMPLATE_MANIFEST},
            user=admin_user,
            expect=200,
        )

    assert response.data['changed'] is False
    assert response.data['persisted'] is False
    assert response.data['dry_run'] is True
    assert response.data['operation'] == 'delete'
    assert response.data['rollback_plan']['operation'] == 'restore'
    assert response.data['opa_allowed'] is True
    check_policy.assert_called_once()
    assert check_policy.call_args.args[0] == 'awx/gatekeeper_resource/allow'
    requests_request.assert_called_once_with(
        'DELETE',
        'https://kube.example.test/apis/templates.gatekeeper.sh/v1/constrainttemplates/k8srequiredlabels',
        headers={'Accept': 'application/json'},
        params={'dryRun': 'All'},
        verify=False,
        timeout=7.0,
    )
    audit = ActivityStream.objects.get(pk=response.data['audit']['activity_stream_id'])
    assert audit.operation == 'delete'
    assert audit.object1 == 'gatekeeper_resource'
    assert '"source": "gatekeeper_delete"' in audit.changes


@pytest.mark.django_db
@override_settings(GATEKEEPER_K8S_API_URL='https://kube.example.test', GATEKEEPER_K8S_REQUEST_TIMEOUT=7, GATEKEEPER_K8S_VERIFY_SSL=False)
def test_gatekeeper_delete_preview_accepts_target_payload_without_manifest(post, admin_user):
    existing = {
        'apiVersion': 'templates.gatekeeper.sh/v1',
        'kind': 'ConstraintTemplate',
        'metadata': {'name': 'k8srequiredlabels'},
        'spec': {'crd': {'spec': {'names': {'kind': 'K8sRequiredLabels'}}}},
    }

    with mock.patch('awx.api.views.gatekeeper.requests.get', return_value=_json_response(existing)) as requests_get, mock.patch(
        'awx.api.views.gatekeeper.requests.request'
    ) as requests_request, mock.patch('awx.api.views.gatekeeper.check_opa_policy') as check_policy:
        response = post(
            reverse('api:opa_gatekeeper_delete'),
            data={
                'mode': 'preview',
                'target': {
                    'api_version': 'templates.gatekeeper.sh/v1',
                    'kind': 'ConstraintTemplate',
                    'name': 'k8srequiredlabels',
                    'resource': 'constrainttemplates',
                },
            },
            user=admin_user,
            expect=200,
        )

    assert response.data['changed'] is False
    assert response.data['persisted'] is False
    assert response.data['operation'] == 'delete'
    assert response.data['target']['object_path'] == '/apis/templates.gatekeeper.sh/v1/constrainttemplates/k8srequiredlabels'
    assert response.data['rollback_plan']['operation'] == 'restore'
    requests_get.assert_called_once_with(
        'https://kube.example.test/apis/templates.gatekeeper.sh/v1/constrainttemplates/k8srequiredlabels',
        headers={'Accept': 'application/json'},
        verify=False,
        timeout=7.0,
    )
    requests_request.assert_not_called()
    check_policy.assert_not_called()


@pytest.mark.django_db
@override_settings(GATEKEEPER_K8S_API_URL='https://kube.example.test', GATEKEEPER_K8S_REQUEST_TIMEOUT=7, GATEKEEPER_K8S_VERIFY_SSL=False)
def test_gatekeeper_rollback_restore_apply_writes_manifest_and_audits(post, admin_user):
    current = {
        'apiVersion': 'templates.gatekeeper.sh/v1',
        'kind': 'ConstraintTemplate',
        'metadata': {'name': 'k8srequiredlabels'},
        'spec': {'crd': {'spec': {'names': {'kind': 'K8sRequiredLabels'}}}},
    }
    restored = {**current, 'status': {'created': True}}
    rollback_plan = {
        'operation': 'restore',
        'manifest': current,
        'target': {
            'api_version': 'templates.gatekeeper.sh/v1',
            'kind': 'ConstraintTemplate',
            'name': 'k8srequiredlabels',
            'resource': 'constrainttemplates',
            'object_path': '/apis/templates.gatekeeper.sh/v1/constrainttemplates/k8srequiredlabels',
        },
    }

    with mock.patch('awx.api.views.gatekeeper.requests.get', return_value=_json_response(current)), mock.patch(
        'awx.api.views.gatekeeper.requests.request', return_value=_json_response(restored)
    ) as requests_request, mock.patch('awx.api.views.gatekeeper.check_opa_policy', return_value=True) as check_policy:
        response = post(
            reverse('api:opa_gatekeeper_rollback'),
            data={'mode': 'apply', 'rollback_plan': rollback_plan, 'human_approved': True},
            user=admin_user,
            expect=200,
        )

    assert response.data['changed'] is True
    assert response.data['persisted'] is True
    assert response.data['operation'] == 'rollback_restore'
    assert response.data['opa_allowed'] is True
    check_policy.assert_called_once()
    requests_request.assert_called_once_with(
        'PUT',
        'https://kube.example.test/apis/templates.gatekeeper.sh/v1/constrainttemplates/k8srequiredlabels',
        headers={'Accept': 'application/json', 'Content-Type': 'application/json'},
        json=current,
        params=None,
        verify=False,
        timeout=7.0,
    )
    audit = ActivityStream.objects.get(pk=response.data['audit']['activity_stream_id'])
    assert audit.operation == 'update'
    assert audit.object1 == 'gatekeeper_resource'
    assert '"source": "gatekeeper_rollback"' in audit.changes


@pytest.mark.django_db
@override_settings(OPA_HOST='opa.example.com', OPA_PORT=8181, OPA_SSL=False, OPA_REQUEST_TIMEOUT=2.5)
def test_opa_policy_module_detail_returns_raw_rego(get, admin_user):
    opa_response = mock.Mock()
    opa_response.json.return_value = {
        'result': {
            'id': 'awx/managed',
            'raw': 'package awx\nallow := true\n',
            'ast': {'package': {'path': [{'type': 'string', 'value': 'awx'}]}, 'rules': [{'head': {'name': 'allow'}}]},
        }
    }
    opa_response.raise_for_status.return_value = None

    with mock.patch('awx.api.views.opa.requests.get', return_value=opa_response):
        response = get(reverse('api:opa_policy_module_detail', kwargs={'policy_id': 'awx/managed'}), user=admin_user, expect=200)

    assert response.data['id'] == 'awx/managed'
    assert response.data['raw'] == 'package awx\nallow := true\n'
    assert response.data['package'] == 'awx'
    assert response.data['decision_paths'] == ['awx/allow']


@pytest.mark.django_db
@override_settings(OPA_HOST='opa.example.com', OPA_PORT=8181, OPA_SSL=False, OPA_REQUEST_TIMEOUT=2.5)
def test_opa_policy_module_upsert_writes_live_module_and_audits(post, admin_user):
    previous_raw = 'package awx\nallow := false\n'
    next_raw = 'package awx\nallow := true\n'
    get_response = mock.Mock()
    get_response.json.return_value = {'result': {'id': 'awx/managed', 'raw': previous_raw, 'ast': {}}}
    get_response.raise_for_status.return_value = None
    put_response = mock.Mock()
    put_response.status_code = 200
    put_response.content = b'{}'
    put_response.json.return_value = {}
    put_response.raise_for_status.return_value = None

    with mock.patch('awx.api.views.opa.requests.get', return_value=get_response), mock.patch(
        'awx.api.views.opa.requests.put', return_value=put_response
    ) as requests_put:
        response = post(
            reverse('api:opa_policy_modules'),
            data={'policy_id': 'awx/managed', 'policy_text': next_raw},
            user=admin_user,
            expect=200,
        )

    assert response.data['changed'] is True
    assert response.data['created'] is False
    assert response.data['module']['id'] == 'awx/managed'
    assert response.data['module']['raw'] == next_raw
    assert response.data['previous_sha256'] == hashlib.sha256(previous_raw.encode()).hexdigest()
    assert response.data['audit']['activity_stream_id']
    requests_put.assert_called_once_with(
        'http://opa.example.com:8181/v1/policies/awx/managed',
        data=next_raw,
        timeout=2.5,
        headers={'Content-Type': 'text/plain'},
        cert=None,
        verify=False,
    )
    audit = ActivityStream.objects.get(pk=response.data['audit']['activity_stream_id'])
    assert audit.operation == 'update'
    assert audit.object1 == 'opa_policy_module'
    assert audit.object2 == 'awx/managed'
    assert '"triggered_by": "opa_policy_module_manager"' in audit.changes
    changes = json.loads(audit.changes)
    assert changes['before']['raw'] == previous_raw
    assert changes['after']['raw'] == next_raw


@pytest.mark.django_db
@override_settings(OPA_HOST='opa.example.com', OPA_PORT=8181, OPA_SSL=False, OPA_REQUEST_TIMEOUT=2.5)
def test_opa_policy_module_delete_removes_live_module_and_audits(delete, admin_user):
    previous_raw = 'package awx\nallow := true\n'
    get_response = mock.Mock()
    get_response.json.return_value = {'result': {'id': 'awx/managed', 'raw': previous_raw, 'ast': {}}}
    get_response.raise_for_status.return_value = None
    delete_response = mock.Mock()
    delete_response.status_code = 204
    delete_response.content = b''
    delete_response.raise_for_status.return_value = None

    with mock.patch('awx.api.views.opa.requests.get', return_value=get_response), mock.patch(
        'awx.api.views.opa.requests.delete', return_value=delete_response
    ) as requests_delete:
        response = delete(reverse('api:opa_policy_module_detail', kwargs={'policy_id': 'awx/managed'}), user=admin_user, expect=200)

    assert response.data['changed'] is True
    assert response.data['policy_id'] == 'awx/managed'
    assert response.data['previous']['sha256'] == hashlib.sha256(previous_raw.encode()).hexdigest()
    requests_delete.assert_called_once()
    audit = ActivityStream.objects.get(pk=response.data['audit']['activity_stream_id'])
    assert audit.operation == 'delete'
    assert audit.object1 == 'opa_policy_module'


@pytest.mark.django_db
@override_settings(OPA_HOST='opa.example.com', OPA_PORT=8181, OPA_SSL=False)
def test_opa_policy_module_upsert_surfaces_opa_compile_error(post, admin_user):
    get_response = mock.Mock()
    get_response.json.return_value = {'result': {'id': 'awx/managed', 'raw': 'package awx\nallow := true', 'ast': {}}}
    get_response.raise_for_status.return_value = None
    put_response = mock.Mock()
    put_response.status_code = 400
    put_response.json.return_value = {'code': 'invalid_parameter', 'message': 'rego_parse_error'}
    put_error = requests.HTTPError('bad policy')
    put_error.response = put_response
    put_response.raise_for_status.side_effect = put_error

    with mock.patch('awx.api.views.opa.requests.get', return_value=get_response), mock.patch('awx.api.views.opa.requests.put', return_value=put_response):
        response = post(
            reverse('api:opa_policy_modules'),
            data={'policy_id': 'awx/managed', 'policy_text': 'package awx\nallow if {'},
            user=admin_user,
            expect=400,
        )

    assert response.data['detail'] == 'OPA policy module operation failed.'
    assert response.data['opa_error'] == {'code': 'invalid_parameter', 'message': 'rego_parse_error'}
    assert ActivityStream.objects.filter(object1='opa_policy_module', object2='awx/managed').count() == 1


@pytest.mark.django_db
def test_opa_policy_module_versions_list_redacts_raw_rego(get, admin_user):
    previous_raw = 'package awx\nallow := false\n'
    next_raw = 'package awx\nallow := true\n'
    entry = ActivityStream.objects.create(
        operation='update',
        object1='opa_policy_module',
        object2='awx/managed',
        actor=admin_user,
        changes=json.dumps(
            {
                'triggered_by': 'opa_policy_module_manager',
                'source': 'opa_policy_modules',
                'policy_id': 'awx/managed',
                'before': {'id': 'awx/managed', 'raw': previous_raw, 'ast': {}},
                'after': {'id': 'awx/managed', 'raw': next_raw, 'ast': {}},
            }
        ),
    )
    entry.user.add(admin_user)

    response = get(reverse('api:opa_policy_module_versions', kwargs={'policy_id': 'awx/managed'}), user=admin_user, expect=200)

    assert response.data['policy_id'] == 'awx/managed'
    assert response.data['count'] == 1
    version = response.data['versions'][0]
    assert version['activity_stream_id'] == entry.pk
    assert version['operation'] == 'update'
    assert version['actor']['username'] == admin_user.username
    assert version['before']['sha256'] == hashlib.sha256(previous_raw.encode()).hexdigest()
    assert version['after']['sha256'] == hashlib.sha256(next_raw.encode()).hexdigest()
    assert 'raw' not in version['before']
    assert 'raw' not in version['after']
    assert version['can_restore_before'] is True
    assert version['can_restore_after'] is True


@pytest.mark.django_db
@override_settings(OPA_HOST='opa.example.com', OPA_PORT=8181, OPA_SSL=False, OPA_REQUEST_TIMEOUT=2.5)
def test_opa_policy_module_rollback_restores_audited_raw_rego(post, admin_user):
    previous_raw = 'package awx\nallow := false\n'
    live_raw = 'package awx\nallow := true\n'
    entry = ActivityStream.objects.create(
        operation='update',
        object1='opa_policy_module',
        object2='awx/managed',
        actor=admin_user,
        changes=json.dumps(
            {
                'triggered_by': 'opa_policy_module_manager',
                'source': 'opa_policy_modules',
                'policy_id': 'awx/managed',
                'before': {'id': 'awx/managed', 'raw': previous_raw, 'ast': {}},
                'after': {'id': 'awx/managed', 'raw': live_raw, 'ast': {}},
            }
        ),
    )
    entry.user.add(admin_user)
    get_response = mock.Mock()
    get_response.json.return_value = {'result': {'id': 'awx/managed', 'raw': live_raw, 'ast': {}}}
    get_response.raise_for_status.return_value = None
    put_response = mock.Mock()
    put_response.status_code = 200
    put_response.content = b'{}'
    put_response.json.return_value = {}
    put_response.raise_for_status.return_value = None

    with mock.patch('awx.api.views.opa.requests.get', return_value=get_response), mock.patch(
        'awx.api.views.opa.requests.put', return_value=put_response
    ) as requests_put:
        response = post(
            reverse('api:opa_policy_module_rollback', kwargs={'policy_id': 'awx/managed'}),
            data={'activity_stream_id': entry.pk, 'version': 'before'},
            user=admin_user,
            expect=200,
        )

    assert response.data['changed'] is True
    assert response.data['version'] == 'before'
    assert response.data['source_activity_stream_id'] == entry.pk
    assert response.data['module']['raw'] == previous_raw
    assert response.data['previous_sha256'] == hashlib.sha256(live_raw.encode()).hexdigest()
    assert response.data['restored_sha256'] == hashlib.sha256(previous_raw.encode()).hexdigest()
    requests_put.assert_called_once_with(
        'http://opa.example.com:8181/v1/policies/awx/managed',
        data=previous_raw,
        timeout=2.5,
        headers={'Content-Type': 'text/plain'},
        cert=None,
        verify=False,
    )
    audit = ActivityStream.objects.get(pk=response.data['audit']['activity_stream_id'])
    changes = json.loads(audit.changes)
    assert audit.object1 == 'opa_policy_module'
    assert audit.object2 == 'awx/managed'
    assert changes['source'] == 'opa_policy_module_rollback'
    assert changes['rollback_source_activity_stream_id'] == entry.pk
    assert changes['rollback_version'] == 'before'


@pytest.mark.django_db
@override_settings(
    OPA_HOST='opa.example.com',
    OPA_PORT=8181,
    OPA_SSL=True,
    OPA_AUTH_TYPE=OPA_AUTH_TYPES.TOKEN,
    OPA_AUTH_TOKEN='secret-token',
    OPA_AUTH_CUSTOM_HEADERS={'X-Custom': 'Header'},
    OPA_REQUEST_TIMEOUT=2.5,
)
def test_opa_evaluate_uses_registered_connection_settings_and_parses_denial(post, admin_user):
    opa_response = mock.Mock()
    opa_response.json.return_value = {'result': {'allowed': False, 'violations': ['blocked']}}
    opa_response.raise_for_status.return_value = None

    with mock.patch('awx.api.views.opa.requests.post', return_value=opa_response) as requests_post:
        response = post(
            reverse('api:opa_evaluate'),
            data={'policy_path': 'awx/job_launch/allow', 'input': {'action': 'launch'}},
            user=admin_user,
            expect=200,
        )

    assert response.data['allowed'] is False
    assert response.data['result'] == {'allowed': False, 'violations': ['blocked']}
    requests_post.assert_called_once_with(
        'https://opa.example.com:8181/v1/data/awx/job_launch/allow',
        json={'input': {'action': 'launch'}},
        timeout=2.5,
        headers={
            'Content-Type': 'application/json',
            'X-Custom': 'Header',
            'Authorization': 'Bearer secret-token',
        },
        cert=None,
        verify=True,
    )


@pytest.mark.django_db
@override_settings(OPA_HOST='opa.example.com', OPA_SSL=False)
def test_check_opa_policy_understands_structured_denial():
    with mock.patch.object(OPAPolicyEngine, 'evaluate', return_value={'result': {'allowed': False, 'violations': ['blocked']}}):
        assert check_opa_policy('awx/ai_action/allow', {'action': 'launch'}) is False


@pytest.mark.parametrize(
    ('opa_response', 'expected'),
    [
        ({'result': True}, True),
        ({'result': False}, False),
        ({'result': {'allow': True}}, True),
        ({'result': {'allow': False}}, False),
        ({'result': {'allow': True, 'violations': ['blocked']}}, False),
        ({'result': {'allowed': False, 'violations': ['blocked']}}, False),
        ({'result': {'deny': []}}, True),
        ({'result': {'deny': ['blocked']}}, False),
        ({'result': {'denied': True}}, False),
        ({'result': {'denied': False}}, True),
        ({'result': {'violations': []}}, True),
        ({'result': {'violations': ['blocked']}}, False),
        ({'result': {'errors': {'policy': 'blocked'}}}, False),
        ({'result': {'unknown': 'value'}}, False),
        ({}, False),
    ],
)
def test_opa_response_allows_common_opa_decision_shapes(opa_response, expected):
    assert opa_response_allows(opa_response) is expected


@pytest.mark.django_db
@override_settings(OPA_HOST='opa.example.com', OPA_SSL=False)
def test_check_opa_policy_understands_common_opa_allow_denial():
    with mock.patch.object(OPAPolicyEngine, 'evaluate', return_value={'result': {'allow': False, 'violations': ['blocked']}}):
        assert check_opa_policy('awx/job_launch/allow', {'action': 'launch'}) is False


@pytest.mark.django_db
def test_opa_guardrail_denies_job_template_launch_before_job_create(post, admin_user, jt_linked):
    jt_linked.ask_variables_on_launch = True
    jt_linked.save(update_fields=['ask_variables_on_launch'])
    before_count = Job.objects.count()

    with mock.patch('awx.api.views.opa.check_opa_policy', return_value=False) as check_policy:
        post(
            reverse('api:job_template_launch', kwargs={'pk': jt_linked.pk}),
            data={'extra_vars': {'env': 'prod', 'secret_value': 'do-not-leak'}},
            user=admin_user,
            expect=403,
        )

    assert Job.objects.count() == before_count
    policy_path, input_data = check_policy.call_args.args
    assert policy_path == 'awx/job_launch/allow'
    assert input_data['source'] == 'api'
    assert input_data['template']['id'] == jt_linked.pk
    assert input_data['template']['type'] == 'jobtemplate'
    assert input_data['launch']['extra_var_keys'] == ['env', 'secret_value']
    assert 'do-not-leak' not in str(input_data)


@pytest.mark.django_db
def test_opa_guardrail_denies_workflow_launch_before_workflow_job_create(post, admin_user, workflow_job_template):
    before_count = WorkflowJob.objects.count()

    with mock.patch('awx.api.views.opa.check_opa_policy', return_value=False) as check_policy:
        post(
            reverse('api:workflow_job_template_launch', kwargs={'pk': workflow_job_template.pk}),
            data={},
            user=admin_user,
            expect=403,
        )

    assert WorkflowJob.objects.count() == before_count
    assert check_policy.call_args.args[1]['template']['type'] == 'workflowjobtemplate'


@pytest.mark.django_db
def test_opa_guardrail_denies_terraform_launch_before_job_create(post, admin_user, terraform_job_template):
    before_count = TerraformJob.objects.count()

    with mock.patch('awx.api.views.opa.check_opa_policy', return_value=False) as check_policy:
        post(
            reverse('api:terraform_job_template_launch', kwargs={'pk': terraform_job_template.pk}),
            data={},
            user=admin_user,
            expect=403,
        )

    assert TerraformJob.objects.count() == before_count
    assert check_policy.call_args.args[1]['template']['type'] == 'terraformjobtemplate'


@pytest.mark.django_db
def test_opa_guardrail_denies_system_job_launch_before_job_create(post, admin_user, system_job_template):
    before_count = SystemJob.objects.count()

    with mock.patch('awx.api.views.opa.check_opa_policy', return_value=False) as check_policy:
        post(
            reverse('api:system_job_template_launch', kwargs={'pk': system_job_template.pk}),
            data={'extra_vars': {'cleanup_password': 'do-not-leak'}},
            user=admin_user,
            expect=403,
        )

    assert SystemJob.objects.count() == before_count
    assert check_policy.call_args.args[1]['template']['type'] == 'systemjobtemplate'
    assert 'do-not-leak' not in str(check_policy.call_args.args[1])


@pytest.mark.django_db
def test_opa_guardrail_denies_catalog_deploy_before_deployment_create(post, admin_user, organization, workflow_job_template):
    item = CatalogItem.objects.create(name='OPA Catalog Item', organization=organization, provision_workflow=workflow_job_template)
    before_count = CatalogDeployment.objects.count()

    with mock.patch('awx.api.views.opa.check_opa_policy', return_value=False) as check_policy:
        post(
            reverse('api:catalog_item_deploy', kwargs={'pk': item.pk}),
            data={'name': 'blocked deployment', 'extra_vars': {'token': 'do-not-leak'}},
            user=admin_user,
            expect=403,
        )

    assert CatalogDeployment.objects.count() == before_count
    input_data = check_policy.call_args.args[1]
    assert input_data['source'] == 'catalog'
    assert input_data['action'] == 'deploy'
    assert input_data['metadata']['catalog_item'] == item.pk
    assert input_data['launch']['extra_var_keys'] == ['terraform_override_limit', 'token']
    assert 'do-not-leak' not in str(input_data)
