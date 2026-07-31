import pytest

from awx.main.utils.terraform_state import (
    sanitize_terraform_state_summary,
    summarize_terraform_state,
    TerraformStateError,
    validate_state_branch,
    validate_state_key,
)


@pytest.mark.parametrize(
    'value',
    [
        '',
        '/absolute',
        '.hidden',
        'environment/../production',
        'environment..production',
        'environment/',
        'environment with spaces',
        'environment/{name',
        'environment/{{name}}',
        'environment/{name!r}',
        'environment/{name:>10}',
        'environment/{name.value}',
    ],
)
def test_validate_state_key_rejects_unsafe_values(value):
    with pytest.raises(TerraformStateError):
        validate_state_key(value)


def test_validate_state_key_accepts_scoped_key():
    assert validate_state_key('production/network/vpc_01') == 'production/network/vpc_01'


def test_validate_state_key_accepts_simple_placeholders():
    value = 'organizations/{organization_id}/templates/{template_id}/{environment}'
    assert validate_state_key(value) == value


def test_validate_state_key_rejects_placeholders_after_resolution():
    with pytest.raises(TerraformStateError):
        validate_state_key('environment/{name}', allow_placeholders=False)


@pytest.mark.parametrize(
    'value',
    [
        '',
        '/absolute',
        '.hidden',
        'state..branch',
        'state@{1',
        'state.lock',
        'state branch',
    ],
)
def test_validate_state_branch_rejects_unsafe_values(value):
    with pytest.raises(TerraformStateError):
        validate_state_branch(value)


def test_summarize_terraform_state_redacts_values_and_attributes():
    state = {
        'version': 4,
        'serial': 17,
        'lineage': 'lineage-1',
        'terraform_version': '1.12.2',
        'outputs': {
            'database_password': {
                'sensitive': True,
                'type': 'string',
                'value': 'do-not-return',
            }
        },
        'resources': [
            {
                'mode': 'managed',
                'type': 'vsphere_virtual_machine',
                'name': 'web',
                'provider': 'provider["registry.terraform.io/hashicorp/vsphere"]',
                'instances': [
                    {
                        'attributes': {
                            'password': 'do-not-return',
                            'private_ip': '192.0.2.10',
                        }
                    }
                ],
            }
        ],
    }

    summary = summarize_terraform_state(state)

    assert summary['resource_count'] == 1
    assert summary['output_count'] == 1
    assert summary['resources'][0]['type'] == 'vsphere_virtual_machine'
    assert summary['outputs'][0] == {
        'name': 'database_password',
        'sensitive': True,
        'type': 'string',
    }
    assert 'do-not-return' not in str(summary)
    assert '192.0.2.10' not in str(summary)


def test_sanitize_terraform_state_summary_whitelists_fields():
    summary = {
        'format_version': 4,
        'serial': 17,
        'lineage': 'lineage-1',
        'terraform_version': '1.12.2',
        'resource_count': 1,
        'output_count': 1,
        'unexpected_secret': 'do-not-return',
        'resources': [
            {
                'mode': 'managed',
                'type': 'test_resource',
                'name': 'example',
                'provider': 'test',
                'instance_count': 1,
                'attributes': {'password': 'do-not-return'},
            }
        ],
        'outputs': [
            {
                'name': 'password',
                'sensitive': True,
                'type': 'string',
                'value': 'do-not-return',
            }
        ],
    }

    sanitized = sanitize_terraform_state_summary(summary)

    assert 'do-not-return' not in str(sanitized)
    assert 'attributes' not in sanitized['resources'][0]
    assert 'value' not in sanitized['outputs'][0]
