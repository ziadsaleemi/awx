import os
import pytest
import requests
from datetime import timedelta
from unittest import mock
from awx.api.views.analytics import AnalyticsGenericView, MissingSettings, AUTOMATION_ANALYTICS_API_URL_PATH, ERROR_MISSING_USER, ERROR_MISSING_PASSWORD
from awx.api.versioning import reverse
from django.test.utils import override_settings
from django.test import RequestFactory
from django.utils import timezone
from rest_framework import status

from awx.main import models
from awx.main.utils import get_awx_version
from django.utils import translation


class TestAnalyticsGenericView:
    @pytest.mark.parametrize(
        "existing_headers,expected_headers",
        [
            ({}, {}),
            ({'Hey': 'There'}, {}),  # We don't forward just any headers
            ({'Content-Type': 'text/html', 'Content-Length': '12'}, {'Content-Type': 'text/html', 'Content-Length': '12'}),
            # Requests will auto-add the following headers (so we don't need to test them): 'Accept-Encoding', 'User-Agent', 'Accept'
        ],
    )
    def test__request_headers(self, existing_headers, expected_headers):
        expected_headers['X-Rh-Analytics-Source'] = 'controller'
        expected_headers['X-Rh-Analytics-Source-Version'] = get_awx_version()
        expected_headers['Accept-Language'] = translation.get_language()

        request = requests.session()
        request.headers.update(existing_headers)
        assert set(expected_headers.items()).issubset(set(AnalyticsGenericView._request_headers(request).items()))

    @pytest.mark.parametrize(
        "path,expected_path",
        [
            ('A/B', f'{AUTOMATION_ANALYTICS_API_URL_PATH}/A/B'),
            ('B', f'{AUTOMATION_ANALYTICS_API_URL_PATH}/B'),
            ('/a/b/c/analytics/reports/my_slug', f'{AUTOMATION_ANALYTICS_API_URL_PATH}/reports/my_slug'),
            ('/a/b/c/analytics/', f'{AUTOMATION_ANALYTICS_API_URL_PATH}/'),
            ('/a/b/c/analytics', f'{AUTOMATION_ANALYTICS_API_URL_PATH}//a/b/c/analytics'),  # Because there is no ending / on analytics we get a weird condition
            ('/a/b/c/analytics/', f'{AUTOMATION_ANALYTICS_API_URL_PATH}/'),
        ],
    )
    @pytest.mark.django_db
    def test__get_analytics_path(self, path, expected_path):
        assert AnalyticsGenericView._get_analytics_path(path) == expected_path

    @pytest.mark.django_db
    def test__get_analytics_url_no_url(self):
        with override_settings(AUTOMATION_ANALYTICS_URL=None):
            with pytest.raises(MissingSettings):
                agw = AnalyticsGenericView()
                agw._get_analytics_url('A')

    @pytest.mark.parametrize(
        "request_path,ending_url",
        [
            ('A', 'A'),
            ('A/B', 'A/B'),
            ('A/B/analytics/', ''),  # we split on analytics but because there is nothing after
            ('A/B/analytics/report', 'report'),
            ('A/B/analytics/report/slug', 'report/slug'),
        ],
    )
    @pytest.mark.django_db
    def test__get_analytics_url(self, request_path, ending_url):
        base_url = 'http://testing'
        with override_settings(AUTOMATION_ANALYTICS_URL=base_url):
            agw = AnalyticsGenericView()
            assert agw._get_analytics_url(request_path) == f'{base_url}{AUTOMATION_ANALYTICS_API_URL_PATH}/{ending_url}'

    @pytest.mark.parametrize(
        "setting_name,setting_value,raises",
        [
            ('INSIGHTS_TRACKING_STATE', None, True),
            ('INSIGHTS_TRACKING_STATE', False, True),
            ('INSIGHTS_TRACKING_STATE', True, False),
            ('INSIGHTS_TRACKING_STATE', 'Steve', False),
            ('INSIGHTS_TRACKING_STATE', 1, False),
            ('INSIGHTS_TRACKING_STATE', '', True),
        ],
    )
    @pytest.mark.django_db
    def test__get_setting(self, setting_name, setting_value, raises):
        with override_settings(**{setting_name: setting_value}):
            if raises:
                with pytest.raises(MissingSettings):
                    AnalyticsGenericView._get_setting(setting_name, False, None)
            else:
                assert AnalyticsGenericView._get_setting(setting_name, False, None) == setting_value

    @pytest.mark.parametrize(
        "settings_map, expected_auth, expected_error_keyword",
        [
            # Test case 1: Valid Red Hat credentials
            (
                {
                    'INSIGHTS_TRACKING_STATE': True,
                    'REDHAT_USERNAME': 'redhat_user',
                    'REDHAT_PASSWORD': 'redhat_pass',  # NOSONAR
                    'SUBSCRIPTIONS_CLIENT_ID': '',
                    'SUBSCRIPTIONS_CLIENT_SECRET': '',
                },
                ('redhat_user', 'redhat_pass'),
                None,
            ),
            # Test case 2: Valid Subscription credentials
            (
                {
                    'INSIGHTS_TRACKING_STATE': True,
                    'REDHAT_USERNAME': '',
                    'REDHAT_PASSWORD': '',
                    'SUBSCRIPTIONS_CLIENT_ID': 'subs_user',
                    'SUBSCRIPTIONS_CLIENT_SECRET': 'subs_pass',  # NOSONAR
                },
                ('subs_user', 'subs_pass'),
                None,
            ),
            # Test case 3: No credentials
            (
                {
                    'INSIGHTS_TRACKING_STATE': True,
                    'REDHAT_USERNAME': '',
                    'REDHAT_PASSWORD': '',
                    'SUBSCRIPTIONS_CLIENT_ID': '',
                    'SUBSCRIPTIONS_CLIENT_SECRET': '',
                },
                None,
                ERROR_MISSING_USER,
            ),
            # Test case 4: Both credentials
            (
                {
                    'INSIGHTS_TRACKING_STATE': True,
                    'REDHAT_USERNAME': 'redhat_user',
                    'REDHAT_PASSWORD': 'redhat_pass',  # NOSONAR
                    'SUBSCRIPTIONS_CLIENT_ID': 'subs_user',
                    'SUBSCRIPTIONS_CLIENT_SECRET': 'subs_pass',  # NOSONAR
                },
                ('redhat_user', 'redhat_pass'),
                None,
            ),
            # Test case 5: Missing password
            (
                {
                    'INSIGHTS_TRACKING_STATE': True,
                    'REDHAT_USERNAME': '',
                    'REDHAT_PASSWORD': '',
                    'SUBSCRIPTIONS_CLIENT_ID': 'subs_user',  # NOSONAR
                    'SUBSCRIPTIONS_CLIENT_SECRET': '',
                },
                None,
                ERROR_MISSING_PASSWORD,
            ),
        ],
    )
    @pytest.mark.django_db
    def test__send_to_analytics_credentials(self, settings_map, expected_auth, expected_error_keyword):
        """
        Test _send_to_analytics with various combinations of credentials.
        """
        with override_settings(**settings_map):
            request = RequestFactory().post('/some/path')
            view = AnalyticsGenericView()

            if expected_auth:
                with mock.patch('awx.api.views.analytics.OIDCClient') as mock_oidc_client:
                    # Configure the mock OIDCClient instance and its make_request method
                    mock_client_instance = mock.Mock()
                    mock_oidc_client.return_value = mock_client_instance
                    mock_client_instance.make_request.return_value = mock.Mock(status_code=200)

                    analytic_url = view._get_analytics_url(request.path)
                    response = view._send_to_analytics(request, 'POST')

                    # Assertions
                    # Assert OIDCClient instantiation
                    expected_client_id, expected_client_secret = expected_auth
                    mock_oidc_client.assert_called_once_with(expected_client_id, expected_client_secret)

                    # Assert make_request call
                    mock_client_instance.make_request.assert_called_once_with(
                        'POST',
                        analytic_url,
                        headers=mock.ANY,
                        verify=mock.ANY,
                        params=mock.ANY,
                        json=mock.ANY,
                        timeout=mock.ANY,
                    )
                    assert response.status_code == 200
            else:
                # Test when settings are missing and MissingSettings is raised
                response = view._send_to_analytics(request, 'POST')

                # # Assert that _error_response is called when MissingSettings is raised
                # mock_error_response.assert_called_once_with(expected_error_keyword, remote=False)
                assert response.status_code == status.HTTP_403_FORBIDDEN
                assert response.data['error']['keyword'] == expected_error_keyword

    @pytest.mark.django_db
    @pytest.mark.parametrize(
        "settings_map, expected_auth",
        [
            # Test case 1: Username and password should be used for basic auth
            (
                {
                    'INSIGHTS_TRACKING_STATE': True,
                    'REDHAT_USERNAME': 'redhat_user',
                    'REDHAT_PASSWORD': 'redhat_pass',  # NOSONAR
                    'SUBSCRIPTIONS_CLIENT_ID': '',
                    'SUBSCRIPTIONS_CLIENT_SECRET': '',
                },
                ('redhat_user', 'redhat_pass'),
            ),
            # Test case 2: Client ID and secret should be used for basic auth
            (
                {
                    'INSIGHTS_TRACKING_STATE': True,
                    'REDHAT_USERNAME': '',
                    'REDHAT_PASSWORD': '',
                    'SUBSCRIPTIONS_CLIENT_ID': 'subs_user',
                    'SUBSCRIPTIONS_CLIENT_SECRET': 'subs_pass',  # NOSONAR
                },
                None,
            ),
        ],
    )
    def test__send_to_analytics_fallback_to_basic_auth(self, settings_map, expected_auth):
        """
        Test _send_to_analytics with basic auth fallback.
        """
        with override_settings(**settings_map):
            request = RequestFactory().post('/some/path')
            view = AnalyticsGenericView()

            with mock.patch('awx.api.views.analytics.OIDCClient') as mock_oidc_client, mock.patch(
                'awx.api.views.analytics.AnalyticsGenericView._base_auth_request'
            ) as mock_base_auth_request:
                # Configure the mock OIDCClient instance and its make_request method
                mock_client_instance = mock.Mock()
                mock_oidc_client.return_value = mock_client_instance
                mock_client_instance.make_request.side_effect = requests.RequestException("Incorrect credentials")

                analytic_url = view._get_analytics_url(request.path)
                view._send_to_analytics(request, 'POST')

                if expected_auth:
                    # assert mock_base_auth_request called with expected_auth
                    mock_base_auth_request.assert_called_once_with(
                        request,
                        'POST',
                        analytic_url,
                        expected_auth[0],
                        expected_auth[1],
                        mock.ANY,
                    )
                else:
                    # assert mock_base_auth_request not called
                    mock_base_auth_request.assert_not_called()


@pytest.mark.django_db
class TestLocalAutomationCalculator:
    def test_options_are_local_and_include_visible_resources(self, post, admin, job_factory):
        job = job_factory(initial_state='successful')
        models.Job.objects.filter(pk=job.pk).update(finished=timezone.now(), elapsed=120, task_impact=2)

        response = post(reverse('api:analytics_roi_templates_options'), {}, user=admin, expect=200)

        assert response.data['template_id'] == [{'key': str(job.job_template_id), 'value': job.job_template.name}]
        assert response.data['org_id'] == [{'key': str(job.organization_id), 'value': job.organization.name}]
        assert any(option['key'] == 'roi_all_time' for option in response.data['quick_date_range'])

    def test_calculates_roi_from_local_jobs(self, post, admin, job_factory):
        successful_job = job_factory(initial_state='successful')
        failed_job = job_factory(initial_state='failed')
        finished = timezone.now()
        models.Job.objects.filter(pk=successful_job.pk).update(finished=finished, elapsed=120, task_impact=2)
        models.Job.objects.filter(pk=failed_job.pk).update(finished=finished, elapsed=60, task_impact=1)

        response = post(
            reverse('api:analytics_roi_templates_explorer'),
            {
                'quick_date_range': 'roi_all_time',
                'sort_options': 'monetary_gain',
                'sort_order': 'desc',
                'limit': 10,
                'offset': 0,
            },
            user=admin,
            expect=200,
        )

        assert response.data['meta']['count'] == 1
        result = response.data['meta']['legend'][0]
        assert result['id'] == successful_job.job_template_id
        assert result['elapsed'] == 180
        assert result['host_count'] == 3
        assert result['total_count'] == 2
        assert result['template_success_rate'] == 50
        assert result['monetary_gain'] == pytest.approx(149.5)

    def test_custom_date_range_accepts_date_only_values(self, post, admin, job_factory):
        included_job = job_factory(initial_state='successful')
        excluded_job = job_factory(initial_state='successful')
        now = timezone.now()
        models.Job.objects.filter(pk=included_job.pk).update(finished=now, elapsed=60, task_impact=1)
        models.Job.objects.filter(pk=excluded_job.pk).update(finished=now - timedelta(days=10), elapsed=60, task_impact=1)

        response = post(
            reverse('api:analytics_roi_templates_explorer'),
            {
                'quick_date_range': 'roi_custom',
                'start_date': (now - timedelta(days=1)).date().isoformat(),
                'end_date': now.date().isoformat(),
            },
            user=admin,
            expect=200,
        )

        assert response.data['meta']['count'] == 1
        assert response.data['meta']['legend'][0]['total_count'] == 1

    def test_rejects_users_without_analytics_permission(self, post, rando):
        post(reverse('api:analytics_roi_templates_options'), {}, user=rando, expect=403)
        post(reverse('api:analytics_roi_templates_explorer'), {}, user=rando, expect=403)

    @pytest.mark.django_db
    def test__send_to_analytics_respects_proxy_env_oidc(self):
        settings_map = {
            'INSIGHTS_TRACKING_STATE': True,
            'AUTOMATION_ANALYTICS_URL': 'https://example.com',
            'REDHAT_USERNAME': 'redhat_user',
            'REDHAT_PASSWORD': 'redhat_pass',
            'SUBSCRIPTIONS_CLIENT_ID': '',
            'SUBSCRIPTIONS_CLIENT_SECRET': '',
            'AWX_TASK_ENV': {'HTTPS_PROXY': '192.168.50.100:1234', 'HTTP_PROXY': '192.168.50.100:5678'},
        }
        with override_settings(**settings_map):
            request = RequestFactory().post('/some/path')
            view = AnalyticsGenericView()

            with mock.patch('awx.api.views.analytics.OIDCClient') as mock_oidc_client:
                mock_client_instance = mock.Mock()
                mock_oidc_client.return_value = mock_client_instance

                def _check_env_and_respond(*args, **kwargs):
                    assert os.environ.get('HTTPS_PROXY') == '192.168.50.100:1234'
                    assert os.environ.get('HTTP_PROXY') == '192.168.50.100:5678'
                    return mock.Mock(status_code=200)

                mock_client_instance.make_request.side_effect = _check_env_and_respond
                response = view._send_to_analytics(request, 'POST')
                assert response.status_code == 200
                mock_client_instance.make_request.assert_called_once()

    @pytest.mark.django_db
    def test__send_to_analytics_respects_proxy_env_basic_auth(self):
        settings_map = {
            'INSIGHTS_TRACKING_STATE': True,
            'AUTOMATION_ANALYTICS_URL': 'https://example.com',
            'REDHAT_USERNAME': 'redhat_user',
            'REDHAT_PASSWORD': 'redhat_pass',
            'SUBSCRIPTIONS_CLIENT_ID': '',
            'SUBSCRIPTIONS_CLIENT_SECRET': '',
            'AWX_TASK_ENV': {'HTTPS_PROXY': '192.168.50.100:1234'},
        }
        with override_settings(**settings_map):
            request = RequestFactory().post('/some/path')
            view = AnalyticsGenericView()

            with mock.patch('awx.api.views.analytics.OIDCClient') as mock_oidc_client, mock.patch(
                'awx.api.views.analytics.AnalyticsGenericView._base_auth_request'
            ) as mock_base_auth:
                mock_client_instance = mock.Mock()
                mock_oidc_client.return_value = mock_client_instance
                mock_client_instance.make_request.side_effect = requests.RequestException("OIDC failed")

                def _check_env_and_respond(*args, **kwargs):
                    assert os.environ.get('HTTPS_PROXY') == '192.168.50.100:1234'
                    return mock.Mock(status_code=200)

                mock_base_auth.side_effect = _check_env_and_respond
                response = view._send_to_analytics(request, 'POST')
                assert response.status_code == 200
                mock_base_auth.assert_called_once()

    @pytest.mark.django_db
    def test__send_to_analytics_restores_env_after_request(self):
        original_value = os.environ.pop('HTTPS_PROXY', None)
        settings_map = {
            'INSIGHTS_TRACKING_STATE': True,
            'AUTOMATION_ANALYTICS_URL': 'https://example.com',
            'REDHAT_USERNAME': 'redhat_user',
            'REDHAT_PASSWORD': 'redhat_pass',
            'SUBSCRIPTIONS_CLIENT_ID': '',
            'SUBSCRIPTIONS_CLIENT_SECRET': '',
            'AWX_TASK_ENV': {'HTTPS_PROXY': '192.168.50.100:1234'},
        }
        try:
            with override_settings(**settings_map):
                request = RequestFactory().post('/some/path')
                view = AnalyticsGenericView()

                with mock.patch('awx.api.views.analytics.OIDCClient') as mock_oidc_client:
                    mock_client_instance = mock.Mock()
                    mock_oidc_client.return_value = mock_client_instance
                    mock_client_instance.make_request.return_value = mock.Mock(status_code=200)

                    view._send_to_analytics(request, 'POST')

                assert 'HTTPS_PROXY' not in os.environ
        finally:
            if original_value is not None:
                os.environ['HTTPS_PROXY'] = original_value
