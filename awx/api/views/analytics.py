import requests
import logging
import urllib.parse as urlparse
from datetime import datetime, time, timedelta

from django.conf import settings
from django.db.models import Count, Q, Sum
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from django.utils.translation import gettext_lazy as _
from django.utils import translation

from awx.api.generics import APIView, Response
from awx.api.permissions import AnalyticsPermission
from awx.api.versioning import reverse
from awx.main import models
from awx.main.access import get_user_queryset
from awx.main.utils import get_awx_version, set_environ
from awx.main.utils.analytics_proxy import OIDCClient
from rest_framework import status

from collections import OrderedDict

from ansible_base.lib.utils.schema import extend_schema_if_available

AUTOMATION_ANALYTICS_API_URL_PATH = "/api/tower-analytics/v1"
AWX_ANALYTICS_API_PREFIX = 'analytics'

ERROR_UPLOAD_NOT_ENABLED = "analytics-upload-not-enabled"
ERROR_MISSING_URL = "missing-url"
ERROR_MISSING_USER = "missing-user"
ERROR_MISSING_PASSWORD = "missing-password"
ERROR_NO_DATA_OR_ENTITLEMENT = "no-data-or-entitlement"
ERROR_NOT_FOUND = "not-found"
ERROR_UNAUTHORIZED = "unauthorized"
ERROR_UNKNOWN = "unknown"
ERROR_UNSUPPORTED_METHOD = "unsupported-method"

logger = logging.getLogger('awx.api.views.analytics')

ROI_MANUAL_HOURLY_COST = 75.0
ROI_AUTOMATION_HOURLY_COST = 10.0
ROI_MANUAL_EFFORT_MINUTES = 60.0


class MissingSettings(Exception):
    """Settings are not correct Exception"""

    pass


class GetNotAllowedMixin(object):
    skip_ai_description = True

    def get(self, request, format=None):
        return Response(status=status.HTTP_405_METHOD_NOT_ALLOWED)


class AnalyticsRootView(APIView):
    permission_classes = (AnalyticsPermission,)
    name = _('Automation Analytics')
    resource_purpose = 'automation analytics endpoints'

    @extend_schema_if_available(extensions={"x-ai-description": "A list of additional API endpoints related to analytics"})
    def get(self, request, format=None):
        data = OrderedDict()
        data['authorized'] = reverse('api:analytics_authorized', request=request)
        data['reports'] = reverse('api:analytics_reports_list', request=request)
        data['report_options'] = reverse('api:analytics_report_options_list', request=request)
        data['adoption_rate'] = reverse('api:analytics_adoption_rate', request=request)
        data['adoption_rate_options'] = reverse('api:analytics_adoption_rate_options', request=request)
        data['event_explorer'] = reverse('api:analytics_event_explorer', request=request)
        data['event_explorer_options'] = reverse('api:analytics_event_explorer_options', request=request)
        data['host_explorer'] = reverse('api:analytics_host_explorer', request=request)
        data['host_explorer_options'] = reverse('api:analytics_host_explorer_options', request=request)
        data['job_explorer'] = reverse('api:analytics_job_explorer', request=request)
        data['job_explorer_options'] = reverse('api:analytics_job_explorer_options', request=request)
        data['probe_templates'] = reverse('api:analytics_probe_templates_explorer', request=request)
        data['probe_templates_options'] = reverse('api:analytics_probe_templates_options', request=request)
        data['probe_template_for_hosts'] = reverse('api:analytics_probe_template_for_hosts_explorer', request=request)
        data['probe_template_for_hosts_options'] = reverse('api:analytics_probe_template_for_hosts_options', request=request)
        data['roi_templates'] = reverse('api:analytics_roi_templates_explorer', request=request)
        data['roi_templates_options'] = reverse('api:analytics_roi_templates_options', request=request)
        return Response(data)


class AnalyticsGenericView(APIView):
    """
    Example:
        headers = {
            'Content-Type': 'application/json',
        }

        params = {
            'limit': '20',
            'offset': '0',
            'sort_by': 'name:asc',
        }

        json_data = {
            'limit': '20',
            'offset': '0',
            'sort_options': 'name',
            'sort_order': 'asc',
            'tags': [],
            'slug': [],
            'name': [],
            'description': '',
        }

        response = requests.post(f'{AUTOMATION_ANALYTICS_API_URL}/reports/', params=params,
                                 headers=headers, json=json_data)

        return Response(response.json(), status=response.status_code)
    """

    resource_purpose = 'base view for analytics api proxy'

    permission_classes = (AnalyticsPermission,)

    @staticmethod
    def _request_headers(request):
        headers = {}
        for header in ['Content-Type', 'Content-Length', 'Accept-Encoding', 'User-Agent', 'Accept']:
            if request.headers.get(header, None):
                headers[header] = request.headers.get(header)
        headers['X-Rh-Analytics-Source'] = 'controller'
        headers['X-Rh-Analytics-Source-Version'] = get_awx_version()
        headers['Accept-Language'] = translation.get_language()

        return headers

    @staticmethod
    def _get_analytics_path(request_path):
        parts = request_path.split(f'{AWX_ANALYTICS_API_PREFIX}/')
        path_specific = parts[-1]
        return f"{AUTOMATION_ANALYTICS_API_URL_PATH}/{path_specific}"

    def _get_analytics_url(self, request_path):
        analytics_path = self._get_analytics_path(request_path)
        url = getattr(settings, 'AUTOMATION_ANALYTICS_URL', None)
        if not url:
            raise MissingSettings(ERROR_MISSING_URL)
        url_parts = urlparse.urlsplit(url)
        analytics_url = urlparse.urlunsplit([url_parts.scheme, url_parts.netloc, analytics_path, url_parts.query, url_parts.fragment])
        return analytics_url

    @staticmethod
    def _get_setting(setting_name, default, error_message):
        setting = getattr(settings, setting_name, default)
        if not setting:
            raise MissingSettings(error_message)
        return setting

    @staticmethod
    def _error_response(keyword, message=None, remote=True, remote_status_code=None, status_code=status.HTTP_403_FORBIDDEN):
        text = {"error": {"remote": remote, "remote_status": remote_status_code, "keyword": keyword}}
        if message:
            text["error"]["message"] = message
        return Response(text, status=status_code)

    def _error_response_404(self, response):
        try:
            json_response = response.json()
            # Subscription/entitlement problem or missing tenant data in AA db => HTTP 403
            message = json_response.get('error', None)
            if message:
                return self._error_response(ERROR_NO_DATA_OR_ENTITLEMENT, message, remote=True, remote_status_code=response.status_code)

            # Standard 404 problem => HTTP 404
            message = json_response.get('detail', None) or response.text
        except requests.exceptions.JSONDecodeError:
            # Unexpected text => still HTTP 404
            message = response.text

        return self._error_response(ERROR_NOT_FOUND, message, remote=True, remote_status_code=status.HTTP_404_NOT_FOUND, status_code=status.HTTP_404_NOT_FOUND)

    @staticmethod
    def _update_response_links(json_response):
        if not json_response.get('links', None):
            return

        for key, value in json_response['links'].items():
            if value:
                json_response['links'][key] = value.replace(AUTOMATION_ANALYTICS_API_URL_PATH, f"/api/v2/{AWX_ANALYTICS_API_PREFIX}")

    def _forward_response(self, response):
        try:
            content_type = response.headers.get('content-type', '')
            if content_type.find('application/json') != -1:
                json_response = response.json()
                self._update_response_links(json_response)

                return Response(json_response, status=response.status_code)
        except Exception as e:
            logger.error(f"Analytics API: Response error: {e}")

        return Response(response.content, status=response.status_code)

    @staticmethod
    def _base_auth_request(request: requests.Request, method: str, url: str, user: str, pw: str, headers: dict[str, str]) -> requests.Response:
        response = requests.request(
            method,
            url,
            auth=(user, pw),
            verify=settings.INSIGHTS_CERT_PATH,
            params=getattr(request, 'query_params', {}),
            headers=headers,
            json=getattr(request, 'data', {}),
            timeout=(31, 31),
        )
        return response

    def _send_to_analytics(self, request, method):
        try:
            headers = self._request_headers(request)

            self._get_setting('INSIGHTS_TRACKING_STATE', False, ERROR_UPLOAD_NOT_ENABLED)
            if method not in ["GET", "POST", "OPTIONS"]:
                return self._error_response(ERROR_UNSUPPORTED_METHOD, method, remote=False, status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)
            url = self._get_analytics_url(request.path)
            using_subscriptions_credentials = False
            with set_environ(**settings.AWX_TASK_ENV):
                try:
                    rh_user = getattr(settings, 'REDHAT_USERNAME', None)
                    rh_password = getattr(settings, 'REDHAT_PASSWORD', None)
                    if not (rh_user and rh_password):
                        rh_user = self._get_setting('SUBSCRIPTIONS_CLIENT_ID', None, ERROR_MISSING_USER)
                        rh_password = self._get_setting('SUBSCRIPTIONS_CLIENT_SECRET', None, ERROR_MISSING_PASSWORD)
                        using_subscriptions_credentials = True

                    client = OIDCClient(rh_user, rh_password)
                    response = client.make_request(
                        method,
                        url,
                        headers=headers,
                        verify=settings.INSIGHTS_CERT_PATH,
                        params=getattr(request, 'query_params', {}),
                        json=getattr(request, 'data', {}),
                        timeout=(31, 31),
                    )
                except requests.RequestException:
                    # subscriptions credentials are not valid for basic auth, so just return 401
                    if using_subscriptions_credentials:
                        response = Response(status=status.HTTP_401_UNAUTHORIZED)
                    else:
                        logger.error("Automation Analytics API request failed, trying base auth method")
                        response = self._base_auth_request(request, method, url, rh_user, rh_password, headers)
            #
            # Missing or wrong user/pass
            #
            if response.status_code == status.HTTP_401_UNAUTHORIZED:
                text = response.get('text', '').rstrip("\n")
                return self._error_response(ERROR_UNAUTHORIZED, text, remote=True, remote_status_code=response.status_code)
            #
            # Not found, No entitlement or No data in Analytics
            #
            elif response.status_code == status.HTTP_404_NOT_FOUND:
                return self._error_response_404(response)
            #
            # Success or not a 401/404 errors are just forwarded
            #
            else:
                return self._forward_response(response)

        except MissingSettings as e:
            logger.warning(f"Analytics API: Setting missing: {e.args[0]}")
            return self._error_response(e.args[0], remote=False)
        except requests.exceptions.RequestException as e:
            logger.error(f"Analytics API: Request error: {e}")
            return self._error_response(ERROR_UNKNOWN, str(e), remote=False, status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)
        except Exception as e:
            logger.error(f"Analytics API: Error: {e}")
            return self._error_response(ERROR_UNKNOWN, str(e), remote=False, status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)


class AnalyticsGenericListView(AnalyticsGenericView):
    resource_purpose = 'analytics api proxy list view'

    @extend_schema_if_available(extensions={"x-ai-description": "Get analytics data from Red Hat Insights"})
    def get(self, request, format=None):
        return self._send_to_analytics(request, method="GET")

    @extend_schema_if_available(extensions={"x-ai-description": "Post query to Red Hat Insights analytics"})
    def post(self, request, format=None):
        return self._send_to_analytics(request, method="POST")

    @extend_schema_if_available(extensions={"x-ai-description": "Get analytics endpoint options"})
    def options(self, request, format=None):
        return self._send_to_analytics(request, method="OPTIONS")


class AnalyticsGenericDetailView(AnalyticsGenericView):
    resource_purpose = 'analytics api proxy detail view'

    @extend_schema_if_available(extensions={"x-ai-description": "Get specific analytics resource from Red Hat Insights"})
    def get(self, request, slug, format=None):
        return self._send_to_analytics(request, method="GET")

    @extend_schema_if_available(extensions={"x-ai-description": "Post query for specific analytics resource to Red Hat Insights"})
    def post(self, request, slug, format=None):
        return self._send_to_analytics(request, method="POST")

    @extend_schema_if_available(extensions={"x-ai-description": "Get options for specific analytics resource"})
    def options(self, request, slug, format=None):
        return self._send_to_analytics(request, method="OPTIONS")


@extend_schema_if_available(
    extensions={'x-ai-description': 'Check if the user has access to Red Hat Insights'},
)
class AnalyticsAuthorizedView(AnalyticsGenericListView):
    name = _("Authorized")
    resource_purpose = 'red hat insights authorization status'


class AnalyticsReportsList(GetNotAllowedMixin, AnalyticsGenericListView):
    name = _("Reports")
    resource_purpose = 'automation analytics reports'


class AnalyticsReportDetail(AnalyticsGenericDetailView):
    name = _("Report")
    resource_purpose = 'automation analytics report detail'


class AnalyticsReportOptionsList(AnalyticsGenericListView):
    name = _("Report Options")
    resource_purpose = 'automation analytics report options'


class AnalyticsAdoptionRateList(GetNotAllowedMixin, AnalyticsGenericListView):
    name = _("Adoption Rate")
    resource_purpose = 'automation analytics adoption rate data'


class AnalyticsEventExplorerList(GetNotAllowedMixin, AnalyticsGenericListView):
    name = _("Event Explorer")
    resource_purpose = 'automation analytics event explorer data'


class AnalyticsHostExplorerList(GetNotAllowedMixin, AnalyticsGenericListView):
    name = _("Host Explorer")
    resource_purpose = 'automation analytics host explorer data'


class AnalyticsJobExplorerList(GetNotAllowedMixin, AnalyticsGenericListView):
    name = _("Job Explorer")
    resource_purpose = 'automation analytics job explorer data'


class AnalyticsProbeTemplatesList(GetNotAllowedMixin, AnalyticsGenericListView):
    name = _("Probe Templates")
    resource_purpose = 'automation analytics probe templates'


class AnalyticsProbeTemplateForHostsList(GetNotAllowedMixin, AnalyticsGenericListView):
    name = _("Probe Template For Hosts")
    resource_purpose = 'automation analytics probe templates for hosts'


def _integer_list(value):
    if not isinstance(value, (list, tuple)):
        return []
    parsed = []
    for item in value:
        try:
            parsed.append(int(item))
        except (TypeError, ValueError):
            continue
    return parsed


def _apply_roi_date_filter(queryset, data):
    quick_date_range = data.get('quick_date_range', 'roi_last_year')
    now = timezone.now()
    ranges = {
        'roi_last_30_days': timedelta(days=30),
        'roi_last_90_days': timedelta(days=90),
        'roi_last_year': timedelta(days=365),
    }
    if quick_date_range in ranges:
        return queryset.filter(finished__gte=now - ranges[quick_date_range])
    if quick_date_range == 'roi_custom':
        start_date = _parse_roi_datetime(data.get('start_date'), end_of_day=False)
        end_date = _parse_roi_datetime(data.get('end_date'), end_of_day=True)
        if start_date:
            queryset = queryset.filter(finished__gte=start_date)
        if end_date:
            queryset = queryset.filter(finished__lte=end_date)
    return queryset


def _parse_roi_datetime(value, *, end_of_day):
    if not value:
        return None
    parsed_date = parse_date(value)
    if parsed_date and len(value) == 10:
        parsed = datetime.combine(parsed_date, time.max if end_of_day else time.min)
    else:
        parsed = parse_datetime(value)
    if parsed is not None and timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed)
    return parsed


def _roi_job_queryset(request, data=None):
    data = data or {}
    queryset = (
        get_user_queryset(request.user, models.Job)
        .filter(job_template__isnull=False, finished__isnull=False)
        .exclude(status__in=('new', 'pending', 'waiting', 'running'))
    )
    queryset = _apply_roi_date_filter(queryset, data)
    filters = {
        'organization_id__in': _integer_list(data.get('org_id')),
        'inventory_id__in': _integer_list(data.get('inventory_id')),
        'job_template_id__in': _integer_list(data.get('template_id')),
        'instance_group_id__in': _integer_list(data.get('cluster_id')),
    }
    for field, values in filters.items():
        if values:
            queryset = queryset.filter(**{field: values})
    return queryset


class AnalyticsRoiTemplatesOptionsList(APIView):
    permission_classes = (AnalyticsPermission,)
    name = _("ROI Template Options")
    resource_purpose = 'local automation calculator filter and sort options'

    @extend_schema_if_available(extensions={"x-ai-description": "Get local automation calculator filter and sort options"})
    def post(self, request, format=None):
        queryset = _roi_job_queryset(request, {'quick_date_range': 'roi_all_time'})

        def options(*fields):
            id_field, name_field = fields
            return [
                {'key': str(item[id_field]), 'value': item[name_field]}
                for item in queryset.exclude(**{f'{id_field}__isnull': True}).values(id_field, name_field).distinct().order_by(name_field, id_field)
            ]

        return Response(
            {
                'org_id': options('organization_id', 'organization__name'),
                'cluster_id': options('instance_group_id', 'instance_group__name'),
                'template_id': options('job_template_id', 'job_template__name'),
                'inventory_id': options('inventory_id', 'inventory__name'),
                'quick_date_range': [
                    {'key': 'roi_last_30_days', 'value': _('Last 30 days')},
                    {'key': 'roi_last_90_days', 'value': _('Last 90 days')},
                    {'key': 'roi_last_year', 'value': _('Last 12 months')},
                    {'key': 'roi_all_time', 'value': _('All time')},
                    {'key': 'roi_custom', 'value': _('Custom date range')},
                ],
                'sort_options': [
                    {'key': 'monetary_gain', 'value': _('Estimated savings')},
                    {'key': 'successful_hosts_savings', 'value': _('Successful host savings')},
                    {'key': 'failed_hosts_costs', 'value': _('Failed host costs')},
                    {'key': 'host_count', 'value': _('Host runs')},
                    {'key': 'total_count', 'value': _('Job runs')},
                    {'key': 'elapsed', 'value': _('Elapsed time')},
                    {'key': 'template_success_rate', 'value': _('Success rate')},
                ],
            }
        )


class AnalyticsRoiTemplatesList(GetNotAllowedMixin, APIView):
    permission_classes = (AnalyticsPermission,)
    name = _("ROI Templates")
    resource_purpose = 'local automation calculator data'

    @extend_schema_if_available(extensions={"x-ai-description": "Calculate automation ROI from locally visible job runs"})
    def post(self, request, format=None):
        queryset = _roi_job_queryset(request, request.data)
        rows = list(
            queryset.values('job_template_id', 'job_template__name')
            .annotate(
                elapsed_total=Sum('elapsed'),
                host_count_total=Sum('task_impact'),
                total_count=Count('id'),
                total_org_count=Count('organization_id', distinct=True),
                total_cluster_count=Count('instance_group_id', distinct=True),
                total_inventory_count=Count('inventory_id', distinct=True),
                successful_count=Count('id', filter=Q(status='successful')),
                successful_hosts_total=Sum('task_impact', filter=Q(status='successful')),
                successful_elapsed_total=Sum('elapsed', filter=Q(status='successful')),
                failed_elapsed_total=Sum('elapsed', filter=Q(status__in=('failed', 'error'))),
            )
            .order_by()
        )

        results = []
        for row in rows:
            total_count = row['total_count'] or 0
            successful_count = row['successful_count'] or 0
            successful_hosts_total = row['successful_hosts_total'] or successful_count
            successful_elapsed_total = float(row['successful_elapsed_total'] or 0)
            failed_elapsed_total = float(row['failed_elapsed_total'] or 0)
            manual_hours = successful_hosts_total * ROI_MANUAL_EFFORT_MINUTES / 60
            successful_hosts_savings = max(
                0,
                manual_hours * ROI_MANUAL_HOURLY_COST - successful_elapsed_total / 3600 * ROI_AUTOMATION_HOURLY_COST,
            )
            failed_hosts_costs = failed_elapsed_total / 3600 * ROI_AUTOMATION_HOURLY_COST
            results.append(
                {
                    'id': row['job_template_id'],
                    'name': row['job_template__name'],
                    'elapsed': float(row['elapsed_total'] or 0),
                    'host_count': row['host_count_total'] or total_count,
                    'total_count': total_count,
                    'total_org_count': row['total_org_count'] or 0,
                    'total_cluster_count': row['total_cluster_count'] or 0,
                    'total_inventory_count': row['total_inventory_count'] or 0,
                    'successful_hosts_total': successful_hosts_total,
                    'successful_elapsed_total': successful_elapsed_total,
                    'template_success_rate': successful_count / total_count * 100 if total_count else 0,
                    'successful_hosts_savings': successful_hosts_savings,
                    'failed_hosts_costs': failed_hosts_costs,
                    'manual_effort_minutes': ROI_MANUAL_EFFORT_MINUTES,
                    'monetary_gain': successful_hosts_savings - failed_hosts_costs,
                    'enabled': True,
                }
            )

        allowed_sort_fields = {
            'elapsed',
            'host_count',
            'total_count',
            'successful_hosts_savings',
            'failed_hosts_costs',
            'monetary_gain',
            'template_success_rate',
        }
        sort_field = request.data.get('sort_options', 'monetary_gain')
        if sort_field not in allowed_sort_fields:
            sort_field = 'monetary_gain'
        reverse_sort = request.data.get('sort_order', 'desc') == 'desc'
        results.sort(key=lambda item: item['name'].lower())
        results.sort(key=lambda item: item[sort_field], reverse=reverse_sort)

        try:
            limit = max(1, min(int(request.data.get('limit', 10)), 200))
        except (TypeError, ValueError):
            limit = 10
        try:
            offset = max(0, int(request.data.get('offset', 0)))
        except (TypeError, ValueError):
            offset = 0

        page = results[offset : offset + limit]
        current_page_savings = sum(item['monetary_gain'] for item in page)
        total_savings = sum(item['monetary_gain'] for item in results)
        return Response(
            {
                'meta': {'count': len(results), 'legend': page},
                'monetary_gain_current_page': current_page_savings,
                'monetary_gain_other_pages': total_savings - current_page_savings,
                'cost': {
                    'hourly_manual_labor_cost': ROI_MANUAL_HOURLY_COST,
                    'hourly_automation_cost': ROI_AUTOMATION_HOURLY_COST,
                },
            }
        )
