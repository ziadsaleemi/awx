import pytest
from django.test import override_settings

from awx.api.versioning import reverse


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='')
def test_eda_status_reports_not_configured(get, admin_user):
    response = get(reverse('api:eda_status'), user=admin_user, expect=200)

    assert response.data['configured'] is False
    assert response.data['status'] == 'not_configured'
    assert response.data['controller_url'] == ''
    assert response.data['settings_url'].endswith('/api/v2/settings/eda/')
    assert response.data['activations_url'].endswith('/api/v2/eda/activations/')


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test')
def test_eda_status_reports_configured_controller(get, admin_user):
    response = get(reverse('api:eda_status'), user=admin_user, expect=200)

    assert response.data['configured'] is True
    assert response.data['status'] == 'configured'
    assert response.data['controller_url'] == 'https://eda.example.test'


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test')
def test_eda_activations_are_paginated(get, admin_user):
    response = get(reverse('api:eda_activation_list'), user=admin_user, expect=200)

    assert response.data == {'count': 0, 'next': None, 'previous': None, 'results': []}


@pytest.mark.django_db
def test_api_root_includes_eda_status_link(get, admin_user):
    response = get(reverse('api:api_v2_root_view'), user=admin_user, expect=200)

    assert response.data['eda'].endswith('/api/v2/eda/status/')
