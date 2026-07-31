# Copyright (c) 2026 Red Hat, Inc.
# All Rights Reserved.

from urllib.parse import parse_qsl, urlencode, urlparse

from django.db.models import Q
from django.utils.dateparse import parse_datetime
from django.utils.translation import gettext_lazy as _
from rest_framework import status as http_status
from rest_framework.response import Response

from awx.api import serializers
from awx.api.generics import APIView
from awx.api.views.eda_permissions import (
    EDAActivationAdminPermission,
    EDAActivationOperatePermission,
    EDAActivationStartPermission,
    EDAActivationViewPermission,
)
from awx.api.versioning import reverse
from awx.main import models
from awx.main.access import get_user_queryset
from awx.main.utils.eda import (
    EDA_RESOURCE_API_PATHS,
    EDAControllerClient,
    EDAControllerError,
    UPSTREAM_ACTIVATION_FIELDS,
    configured_url,
    connection_status,
    managed_project_index,
    module_enabled,
)
from awx.main.utils.eda_rbac import build_eda_rbac_sync_report
from awx.main.utils.eda_credentials import build_eda_credential_import_report, build_eda_credential_sync_report

_EDA_JOB_MATCH_FIELDS = ('name', 'description')
_EDA_RBAC_MANAGED_RESOURCES = {
    'organizations',
    'teams',
    'users',
    'role-definitions',
    'user-role-assignments',
    'team-role-assignments',
}
_EDA_CREDENTIAL_MANAGED_RESOURCES = {'credentials', 'credential-types'}
_EDA_CAPSTAN_MANAGED_RESOURCES = _EDA_RBAC_MANAGED_RESOURCES | _EDA_CREDENTIAL_MANAGED_RESOURCES
_EDA_READ_ONLY_RESOURCES = {'rule-audit', 'rulebooks'} | _EDA_CAPSTAN_MANAGED_RESOURCES


def _eda_read_only_response(resource):
    if resource in _EDA_CREDENTIAL_MANAGED_RESOURCES:
        return Response(
            {'detail': _('Event Engine credential types and credentials are managed through Capstan Credentials and are read only in the Event Engine API.')},
            status=http_status.HTTP_405_METHOD_NOT_ALLOWED,
        )
    if resource in _EDA_RBAC_MANAGED_RESOURCES:
        return Response(
            {'detail': _('EDA identities and role assignments are managed through Capstan Access Management and are read only in the Event Engine API.')},
            status=http_status.HTTP_405_METHOD_NOT_ALLOWED,
        )
    return Response({'detail': _('This EDA resource is read only.')}, status=http_status.HTTP_405_METHOD_NOT_ALLOWED)


def _parse_positive_int(value, default, maximum=None):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    parsed = max(parsed, 1)
    if maximum is not None:
        parsed = min(parsed, maximum)
    return parsed


def _parse_bool(value, default=False):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in ('1', 'true', 'yes', 'on')


def _date_to_iso(value):
    if value is None:
        return None
    if isinstance(value, str):
        parsed = parse_datetime(value)
        return parsed.isoformat() if parsed else value
    return value.isoformat()


def _page_link(request, page):
    query = request.GET.copy()
    query['page'] = str(page)
    return f'{request.path}?{query.urlencode()}'


def _query_params(request):
    params = {}
    for key, values in request.query_params.lists():
        params[key] = values if len(values) > 1 else values[0]
    return params


def _normalize_resource_payload(payload):
    if isinstance(payload, list):
        return {'count': len(payload), 'next': None, 'previous': None, 'results': payload}
    if isinstance(payload, dict):
        if 'results' in payload:
            return payload
        if 'data' in payload and isinstance(payload['data'], list):
            normalized = dict(payload)
            normalized['results'] = normalized.pop('data')
            normalized.setdefault('count', len(normalized['results']))
            normalized.setdefault('next', None)
            normalized.setdefault('previous', None)
            return normalized
        return {'count': 1, 'next': None, 'previous': None, 'results': [payload]}
    return {'count': 0, 'next': None, 'previous': None, 'results': []}


def _rewrite_resource_page_link(request, link):
    if not link:
        return None
    parsed = urlparse(str(link))
    query = parsed.query
    if not query and '?' in str(link):
        query = str(link).split('?', 1)[1]
    return f'{request.path}?{urlencode(parse_qsl(query, keep_blank_values=True))}'


def _rewrite_resource_page_links(request, data):
    normalized = dict(data)
    normalized['next'] = _rewrite_resource_page_link(request, normalized.get('next'))
    normalized['previous'] = _rewrite_resource_page_link(request, normalized.get('previous'))
    return normalized


def _resource_configured_empty(resource):
    return {
        'count': 0,
        'next': None,
        'previous': None,
        'source': 'not_configured',
        'resource': resource,
        'controller_error': '',
        'results': [],
    }


def _resource_module_disabled_empty(resource):
    return {
        'count': 0,
        'next': None,
        'previous': None,
        'source': 'module_disabled',
        'resource': resource,
        'controller_error': '',
        'results': [],
        'detail': _('Event-Driven Ansible module is disabled.'),
    }


def _eda_module_disabled_response():
    return Response(
        {'detail': _('Event-Driven Ansible module is disabled.'), 'status': 'disabled'},
        status=http_status.HTTP_403_FORBIDDEN,
    )


def _is_known_resource(resource):
    return resource in EDA_RESOURCE_API_PATHS


def _eda_version_summary(payload):
    summary = {'version': '', 'version_detail': payload if isinstance(payload, dict) else {}, 'version_error': ''}
    if not isinstance(payload, dict):
        return summary
    for key in ('version', 'eda_version', 'controller_version', 'application_version'):
        value = payload.get(key)
        if value:
            summary['version'] = str(value)
            return summary
    for key in ('build', 'server', 'data'):
        nested = payload.get(key)
        if not isinstance(nested, dict):
            continue
        for nested_key in ('version', 'eda_version', 'controller_version', 'application_version'):
            value = nested.get(nested_key)
            if value:
                summary['version'] = str(value)
                return summary
    return summary


def _eda_live_version_summary(client):
    summary = {
        'version': '',
        'version_detail': {},
        'version_error': '',
        'api_contract': {},
        'compatibility': 'unknown',
        'compatible': None,
        'missing_capabilities': [],
    }
    if not client.is_configured:
        return summary
    try:
        contract = client.api_contract()
        return {
            **summary,
            'version': contract['api_version'],
            'version_detail': {
                'title': contract['openapi_title'],
                'tested_api_version_spec': contract['tested_api_version_spec'],
            },
            'api_contract': contract,
            'compatibility': contract['compatibility'],
            'compatible': contract['compatible'],
            'missing_capabilities': contract['missing_capabilities'],
        }
    except EDAControllerError as exc:
        summary['version_error'] = str(exc)
    for path in ('/api/eda/v1/status/', '/api/eda/v1/ping/'):
        try:
            legacy = _eda_version_summary(client.get_json(path))
            return {**summary, **legacy}
        except EDAControllerError as exc:
            summary['version_error'] = str(exc)
            continue
    return summary


class EDAStatusView(APIView):
    name = _('EDA Status')
    resource_purpose = 'event-driven ansible controller status'
    permission_classes = [EDAActivationViewPermission]

    def get(self, request, format=None):
        client = EDAControllerClient()
        controller_url = configured_url()
        status = connection_status(controller_url)
        include_version = str(request.query_params.get('include_version') or '').strip().lower() in ('1', 'true', 'yes', 'on')
        messages = {
            'configured': _('EDA Controller URL is configured.'),
            'disabled': _('Event-Driven Ansible module is disabled.'),
            'invalid': _('EDA Controller URL is invalid.'),
            'not_configured': _('EDA Controller URL is not configured.'),
        }
        version_summary = (
            _eda_live_version_summary(client)
            if include_version
            else {
                'version': '',
                'version_detail': {},
                'version_error': '',
                'api_contract': {},
                'compatibility': 'unknown',
                'compatible': None,
                'missing_capabilities': [],
            }
        )
        return Response(
            {
                'configured': status == 'configured',
                'status': status,
                'controller_url': controller_url,
                **version_summary,
                'auth_configured': client.auth_configured,
                'verify_ssl': client.verify_ssl,
                'request_timeout': client.timeout,
                'activations_api_path': client.activations_path,
                'activation_start_api_path': client.activation_start_path,
                'activation_instance_logs_api_path': client.activation_instance_logs_path,
                'activation_events_api_path': client.activation_events_path,
                'activation_poll_attempts': client.poll_attempts,
                'activation_poll_interval': client.poll_interval,
                'message': messages.get(status, _('EDA Controller URL is not configured.')),
                'settings_url': reverse('api:setting_singleton_detail', kwargs={'category_slug': 'eda'}, request=request),
                'activations_url': reverse('api:eda_activation_list', request=request),
            }
        )


class EDAActivationListView(APIView):
    name = _('EDA Activations')
    resource_purpose = 'event-driven ansible activation summary'
    permission_classes = [EDAActivationViewPermission]

    def get(self, request, format=None):
        page = _parse_positive_int(request.query_params.get('page'), 1)
        page_size = _parse_positive_int(request.query_params.get('page_size'), 20, maximum=200)
        controller_url = configured_url()
        controller_error = ''

        if not module_enabled():
            return Response(
                {
                    'count': 0,
                    'next': None,
                    'previous': None,
                    'source': 'module_disabled',
                    'controller_error': '',
                    'results': [],
                    'detail': _('Event-Driven Ansible module is disabled.'),
                }
            )
        if not controller_url:
            return Response({'count': 0, 'next': None, 'previous': None, 'source': 'not_configured', 'controller_error': '', 'results': []})

        client = EDAControllerClient()
        if client.is_configured:
            try:
                data = client.list_activations(page=page, page_size=page_size)
                data['source'] = 'eda_controller'
                data['controller_error'] = ''
                return Response(data)
            except EDAControllerError as exc:
                controller_error = str(exc)

        eda_filter = Q()
        for field in _EDA_JOB_MATCH_FIELDS:
            eda_filter |= Q(**{f'{field}__icontains': 'eda'})
            eda_filter |= Q(**{f'{field}__icontains': 'event-driven'})
        jobs = get_user_queryset(request.user, models.Job).filter(eda_filter).distinct().order_by('-created', '-id')

        count = jobs.count()
        start = (page - 1) * page_size
        end = start + page_size
        results = [
            {
                'id': job.id,
                'name': job.name,
                'status': job.status,
                'started': _date_to_iso(job.started),
                'finished': _date_to_iso(job.finished),
                'rulebook': job.name,
                'event_source': 'Capstan job metadata',
                'source': 'awx_job_match',
                'related': {'job': reverse('api:job_detail', kwargs={'pk': job.id}, request=request)},
            }
            for job in jobs[start:end]
        ]

        next_page = page + 1 if end < count else None
        previous_page = page - 1 if page > 1 else None
        return Response(
            {
                'count': count,
                'next': _page_link(request, next_page) if next_page else None,
                'previous': _page_link(request, previous_page) if previous_page else None,
                'source': 'awx_job_match',
                'controller_error': controller_error,
                'results': results,
            }
        )


def _eda_error_response(exc):
    if exc.status == 'disabled':
        response_status = http_status.HTTP_403_FORBIDDEN
    else:
        response_status = (
            http_status.HTTP_400_BAD_REQUEST
            if exc.status in ('bad_request', 'invalid', 'not_configured', 'missing')
            else http_status.HTTP_503_SERVICE_UNAVAILABLE
        )
    return Response({'detail': str(exc), 'status': exc.status}, status=response_status)


def _project_source_queryset(request):
    queryset = get_user_queryset(request.user, models.Project).filter(scm_type='git').select_related('credential', 'organization')
    search = str(request.query_params.get('name__icontains') or request.query_params.get('search') or '').strip()
    if search:
        queryset = queryset.filter(Q(name__icontains=search) | Q(description__icontains=search) | Q(scm_url__icontains=search))
    order_by = str(request.query_params.get('order_by') or 'name').strip()
    allowed_ordering = {
        'id',
        '-id',
        'name',
        '-name',
        'created',
        '-created',
        'modified',
        '-modified',
        'last_updated',
        '-last_updated',
    }
    return queryset.order_by(order_by if order_by in allowed_ordering else 'name', 'id')


def _project_source_mirror_context(client):
    if not module_enabled():
        return {}, 'module_disabled', ''
    if not configured_url():
        return {}, 'not_configured', ''
    try:
        payload = client.list_resource_all('projects', page_size=200)
        return managed_project_index(payload.get('results') or []), 'configured', ''
    except EDAControllerError as exc:
        return {}, exc.status, str(exc)


def _project_source_record(
    request,
    project,
    mirror=None,
    controller_status='configured',
    controller_error='',
    include_user_capabilities=False,
):
    mirror = mirror or {}
    mismatched_fields = []
    expected = {
        'url': str(project.scm_url or '').strip(),
        'scm_branch': str(project.scm_branch or '').strip(),
        'scm_refspec': str(project.scm_refspec or '').strip(),
        'update_revision_on_launch': bool(project.scm_update_on_launch),
        'scm_update_cache_timeout': int(project.scm_update_cache_timeout or 0),
    }
    if mirror:
        for field, value in expected.items():
            if mirror.get(field) != value:
                mismatched_fields.append(field)

    import_state = str(mirror.get('import_state') or mirror.get('status') or '').strip().lower()
    if controller_status != 'configured':
        integration_status = controller_status
    elif not mirror:
        integration_status = 'not_synced'
    elif mismatched_fields:
        integration_status = 'out_of_sync'
    elif import_state in ('completed', 'complete', 'successful', 'success'):
        integration_status = 'synced'
    else:
        integration_status = import_state or 'linked'

    credential_name = str(getattr(project.credential, 'name', '') or '')
    record = {
        'id': project.pk,
        'name': project.name,
        'description': project.description,
        'scm_type': project.scm_type,
        'scm_url': project.scm_url,
        'scm_branch': project.scm_branch,
        'scm_refspec': project.scm_refspec,
        'scm_revision': project.scm_revision,
        'source_status': project.status,
        'source_last_updated': _date_to_iso(project.last_updated),
        'credential_id': project.credential_id,
        'credential_name': credential_name,
        'credential_mapping': 'matching_name_required' if credential_name else 'not_required',
        'organization_id': project.organization_id,
        'organization_name': getattr(project.organization, 'name', ''),
        'created': _date_to_iso(project.created),
        'modified': _date_to_iso(project.modified),
        'integration_status': integration_status,
        'mismatched_fields': mismatched_fields,
        'controller_status': controller_status,
        'controller_error': controller_error,
        'eda_project_id': mirror.get('id'),
        'eda_project_name': mirror.get('name') or '',
        'eda_status': import_state or ('not_synced' if not mirror else 'linked'),
        'eda_last_synced_at': mirror.get('last_synced_at'),
        'eda_git_hash': mirror.get('git_hash') or '',
        'eda_import_error': mirror.get('import_error') or '',
        'related': {
            'project': reverse('api:project_detail', kwargs={'pk': project.pk}, request=request),
            'project_update': reverse('api:project_update_view', kwargs={'pk': project.pk}, request=request),
        },
    }
    if include_user_capabilities:
        record['user_capabilities'] = {
            'edit': request.user.can_access(models.Project, 'change', project),
            'sync': request.user.can_access(models.Project, 'start', project),
        }
    return record


class EDAProjectSourceListView(APIView):
    name = _('Event Engine Project Sources')
    resource_purpose = 'Capstan projects used as Event Engine source control'
    permission_classes = [EDAActivationViewPermission]

    def get(self, request, format=None):
        page = _parse_positive_int(request.query_params.get('page'), 1)
        page_size = _parse_positive_int(request.query_params.get('page_size'), 20, maximum=200)
        queryset = _project_source_queryset(request)
        count = queryset.count()
        start = (page - 1) * page_size
        projects = list(queryset[start : start + page_size])
        client = EDAControllerClient()
        mirrors, controller_status, controller_error = _project_source_mirror_context(client)
        return Response(
            {
                'count': count,
                'next': _page_link(request, page + 1) if start + page_size < count else None,
                'previous': _page_link(request, page - 1) if page > 1 else None,
                'source': 'capstan_projects',
                'resource': 'project-sources',
                'controller_status': controller_status,
                'controller_error': controller_error,
                'results': [
                    _project_source_record(
                        request,
                        project,
                        mirrors.get(project.pk),
                        controller_status,
                        controller_error,
                        include_user_capabilities=True,
                    )
                    for project in projects
                ],
            }
        )


class EDAProjectSourceDetailView(APIView):
    name = _('Event Engine Project Source Detail')
    resource_purpose = 'Capstan project and managed Event Engine mirror detail'
    permission_classes = [EDAActivationViewPermission]

    def get(self, request, pk, format=None):
        project = _project_source_queryset(request).filter(pk=pk).first()
        if project is None:
            return Response({'detail': _('Not found.')}, status=http_status.HTTP_404_NOT_FOUND)
        client = EDAControllerClient()
        mirrors, controller_status, controller_error = _project_source_mirror_context(client)
        return Response(
            _project_source_record(
                request,
                project,
                mirrors.get(project.pk),
                controller_status,
                controller_error,
                include_user_capabilities=True,
            )
        )


class EDAProjectSourceSyncView(APIView):
    name = _('Event Engine Project Source Sync')
    resource_purpose = 'reconcile a Capstan project into Event Engine'
    permission_classes = [EDAActivationAdminPermission]

    def post(self, request, pk, format=None):
        if not module_enabled():
            return _eda_module_disabled_response()
        project = _project_source_queryset(request).filter(pk=pk).first()
        if project is None:
            return Response({'detail': _('Not found.')}, status=http_status.HTTP_404_NOT_FOUND)
        if not request.user.can_access(models.Project, 'start', project):
            return Response(
                {'detail': _('You do not have permission to synchronize this project.')},
                status=http_status.HTTP_403_FORBIDDEN,
            )
        project_update = project.create_project_update(
            _eager_fields={
                'launch_type': 'manual',
                'eda_sync': True,
            }
        )
        if not project_update.signal_start():
            return Response(
                {'detail': _('The Event Engine project synchronization job could not be started.')},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        data = {
            'source': 'capstan_project',
            'capstan_project_id': project.pk,
            'project_update': project_update.pk,
            'eda_sync': project_update.eda_sync,
        }
        data.update(
            serializers.ProjectUpdateSerializer(
                project_update,
                context={'request': request, 'view': self},
            ).to_representation(project_update)
        )
        return Response(
            data,
            headers={'Location': project_update.get_absolute_url(request=request)},
            status=http_status.HTTP_202_ACCEPTED,
        )


class EDAResourceListView(APIView):
    name = _('EDA Resources')
    resource_purpose = 'event-driven ansible resource list'
    permission_classes = [EDAActivationViewPermission]

    def get(self, request, resource, format=None):
        if not _is_known_resource(resource):
            return Response({'detail': _('EDA resource is invalid.')}, status=http_status.HTTP_404_NOT_FOUND)
        if not module_enabled():
            return Response(_resource_module_disabled_empty(resource))
        if not configured_url():
            return Response(_resource_configured_empty(resource))

        client = EDAControllerClient()
        try:
            payload = client.list_resource(resource, params=_query_params(request))
        except EDAControllerError as exc:
            return _eda_error_response(exc)

        data = _normalize_resource_payload(payload)
        data = _rewrite_resource_page_links(request, data)
        data['source'] = 'eda_controller'
        data['resource'] = resource
        data['controller_error'] = data.get('controller_error') or ''
        return Response(data)

    def post(self, request, resource, format=None):
        if not module_enabled():
            return _eda_module_disabled_response()
        if not EDAActivationAdminPermission().has_permission(request, self):
            return Response({'detail': _('You do not have permission to create EDA resources.')}, status=http_status.HTTP_403_FORBIDDEN)
        if resource in _EDA_READ_ONLY_RESOURCES:
            return _eda_read_only_response(resource)
        if not _is_known_resource(resource):
            return Response({'detail': _('EDA resource is invalid.')}, status=http_status.HTTP_404_NOT_FOUND)

        client = EDAControllerClient()
        try:
            payload = client.create_resource(resource, request.data if isinstance(request.data, dict) else {})
        except EDAControllerError as exc:
            return _eda_error_response(exc)
        return Response(payload, status=http_status.HTTP_201_CREATED)


class EDAResourceDetailView(APIView):
    name = _('EDA Resource Detail')
    resource_purpose = 'event-driven ansible resource detail'
    permission_classes = [EDAActivationViewPermission]

    def get(self, request, resource, pk, format=None):
        if not module_enabled():
            return _eda_module_disabled_response()
        if not _is_known_resource(resource):
            return Response({'detail': _('EDA resource is invalid.')}, status=http_status.HTTP_404_NOT_FOUND)

        client = EDAControllerClient()
        try:
            payload = client.get_resource(resource, pk)
        except EDAControllerError as exc:
            return _eda_error_response(exc)
        return Response(payload)

    def put(self, request, resource, pk, format=None):
        return self._update(request, resource, pk, method='PUT')

    def patch(self, request, resource, pk, format=None):
        return self._update(request, resource, pk, method='PATCH')

    def _update(self, request, resource, pk, method='PATCH'):
        if not module_enabled():
            return _eda_module_disabled_response()
        if not EDAActivationAdminPermission().has_permission(request, self):
            return Response({'detail': _('You do not have permission to update EDA resources.')}, status=http_status.HTTP_403_FORBIDDEN)
        if resource in _EDA_READ_ONLY_RESOURCES:
            return _eda_read_only_response(resource)
        if not _is_known_resource(resource):
            return Response({'detail': _('EDA resource is invalid.')}, status=http_status.HTTP_404_NOT_FOUND)

        client = EDAControllerClient()
        try:
            payload = client.update_resource(resource, pk, request.data if isinstance(request.data, dict) else {}, method=method)
        except EDAControllerError as exc:
            return _eda_error_response(exc)
        return Response(payload)

    def delete(self, request, resource, pk, format=None):
        if not module_enabled():
            return _eda_module_disabled_response()
        if not EDAActivationAdminPermission().has_permission(request, self):
            return Response({'detail': _('You do not have permission to delete EDA resources.')}, status=http_status.HTTP_403_FORBIDDEN)
        if resource in _EDA_READ_ONLY_RESOURCES:
            return _eda_read_only_response(resource)
        if not _is_known_resource(resource):
            return Response({'detail': _('EDA resource is invalid.')}, status=http_status.HTTP_404_NOT_FOUND)

        client = EDAControllerClient()
        try:
            payload = client.delete_resource(resource, pk)
        except EDAControllerError as exc:
            return _eda_error_response(exc)
        return Response(payload, status=http_status.HTTP_202_ACCEPTED)


class EDAProjectSyncView(APIView):
    name = _('EDA Project Sync')
    resource_purpose = 'event-driven ansible project sync'
    permission_classes = [EDAActivationAdminPermission]

    def post(self, request, pk, format=None):
        if not module_enabled():
            return _eda_module_disabled_response()
        client = EDAControllerClient()
        try:
            payload = client.sync_project(pk, request.data if isinstance(request.data, dict) else {})
        except EDAControllerError as exc:
            return _eda_error_response(exc)
        return Response({'source': 'eda_controller', 'project': payload, 'actions': ['sync']})


class EDARBACSyncView(APIView):
    name = _('EDA RBAC Sync')
    resource_purpose = 'event-driven ansible access sync'
    permission_classes = [EDAActivationAdminPermission]

    def get(self, request, format=None):
        if not module_enabled():
            return _eda_module_disabled_response()
        try:
            report = build_eda_rbac_sync_report(request.user, mode='observe', create_missing_identities=False)
        except EDAControllerError as exc:
            return _eda_error_response(exc)
        return Response(report)

    def post(self, request, format=None):
        if not module_enabled():
            return _eda_module_disabled_response()
        data = request.data if isinstance(request.data, dict) else {}
        mode = data.get('mode') or 'observe'
        create_missing_identities = _parse_bool(data.get('create_missing_identities'), True)
        try:
            report = build_eda_rbac_sync_report(request.user, mode=mode, create_missing_identities=create_missing_identities)
        except EDAControllerError as exc:
            return _eda_error_response(exc)
        return Response(report)


class EDACredentialSyncView(APIView):
    name = _('EDA Credential Sync')
    resource_purpose = 'event-driven ansible credential sync'
    permission_classes = [EDAActivationAdminPermission]

    def get(self, request, format=None):
        if not module_enabled():
            return _eda_module_disabled_response()
        try:
            report = build_eda_credential_sync_report(request.user, mode='observe')
        except EDAControllerError as exc:
            return _eda_error_response(exc)
        return Response(report)

    def post(self, request, format=None):
        if not module_enabled():
            return _eda_module_disabled_response()
        data = request.data if isinstance(request.data, dict) else {}
        mode = data.get('mode') or 'enforce'
        refresh_secrets = _parse_bool(data.get('refresh_secrets'), True)
        try:
            report = build_eda_credential_sync_report(
                request.user,
                mode=mode,
                refresh_secrets=refresh_secrets,
            )
        except EDAControllerError as exc:
            return _eda_error_response(exc)
        return Response(report)


class EDACredentialImportView(APIView):
    name = _('EDA Credential Import')
    resource_purpose = 'event-driven ansible credential import'
    permission_classes = [EDAActivationAdminPermission]

    def _forbidden(self, request):
        if request.user.is_superuser:
            return None
        return Response(
            {'detail': _('Only a system administrator can import Event Engine credential types and credentials.')},
            status=http_status.HTTP_403_FORBIDDEN,
        )

    def get(self, request, format=None):
        if not module_enabled():
            return _eda_module_disabled_response()
        if forbidden := self._forbidden(request):
            return forbidden
        try:
            report = build_eda_credential_import_report(request.user, apply=False)
        except EDAControllerError as exc:
            return _eda_error_response(exc)
        return Response(report)

    def post(self, request, format=None):
        if not module_enabled():
            return _eda_module_disabled_response()
        if forbidden := self._forbidden(request):
            return forbidden
        try:
            report = build_eda_credential_import_report(request.user, apply=True)
        except EDAControllerError as exc:
            return _eda_error_response(exc)
        return Response(report)


class EDAEventStreamActivationsView(APIView):
    name = _('EDA Event Stream Activations')
    resource_purpose = 'event-driven ansible event stream activations'
    permission_classes = [EDAActivationViewPermission]

    def get(self, request, pk, format=None):
        if not module_enabled():
            return _eda_module_disabled_response()
        client = EDAControllerClient()
        try:
            payload = client.list_event_stream_activations(pk, params=_query_params(request))
        except EDAControllerError as exc:
            return _eda_error_response(exc)
        data = _normalize_resource_payload(payload)
        data = _rewrite_resource_page_links(request, data)
        data['source'] = 'eda_controller'
        data['resource'] = 'event-stream-activations'
        data['event_stream_id'] = pk
        data['controller_error'] = ''
        return Response(data)


class EDAActivationDetailView(APIView):
    name = _('EDA Activation Detail')
    resource_purpose = 'event-driven ansible activation detail'
    permission_classes = [EDAActivationViewPermission]

    def get(self, request, pk, format=None):
        if not module_enabled():
            return _eda_module_disabled_response()
        client = EDAControllerClient()
        try:
            activation = client.get_activation(pk)
        except EDAControllerError as exc:
            return _eda_error_response(exc)
        return Response(activation)

    def delete(self, request, pk, format=None):
        if not module_enabled():
            return _eda_module_disabled_response()
        if not EDAActivationAdminPermission().has_permission(request, self):
            return Response({'detail': _('You do not have permission to delete EDA activations.')}, status=http_status.HTTP_403_FORBIDDEN)
        client = EDAControllerClient()
        try:
            result = client.delete_activation(pk)
        except EDAControllerError as exc:
            return _eda_error_response(exc)
        return Response(result, status=http_status.HTTP_202_ACCEPTED)


class EDAActivationEventsView(APIView):
    name = _('EDA Activation Events')
    resource_purpose = 'event-driven ansible activation events'
    permission_classes = [EDAActivationViewPermission]

    def get(self, request, pk, format=None):
        if not module_enabled():
            return _eda_module_disabled_response()
        limit = _parse_positive_int(request.query_params.get('page_size') or request.query_params.get('limit'), 20, maximum=200)
        client = EDAControllerClient()
        try:
            events = client.activation_events(pk, limit=limit)
        except EDAControllerError as exc:
            return _eda_error_response(exc)
        return Response({'count': len(events), 'next': None, 'previous': None, 'results': events})


class EDAActivationActionView(APIView):
    name = _('EDA Activation Action')
    resource_purpose = 'event-driven ansible activation action'
    permission_classes = [EDAActivationOperatePermission]

    def post(self, request, pk, action, format=None):
        if not module_enabled():
            return _eda_module_disabled_response()
        client = EDAControllerClient()
        try:
            activation = client.control_activation(pk, action)
        except EDAControllerError as exc:
            return _eda_error_response(exc)
        return Response({'source': 'eda_controller', 'activation': activation, 'actions': [action]})


class EDAActivationStartView(APIView):
    name = _('EDA Activation Start')
    resource_purpose = 'event-driven ansible activation create/start'
    permission_classes = [EDAActivationStartPermission]

    def post(self, request, format=None):
        if not module_enabled():
            return _eda_module_disabled_response()
        data = request.data if isinstance(request.data, dict) else {}
        rulebook_name = str(data.get('rulebook_name') or data.get('name') or '').strip()
        activation_id = str(data.get('activation_id') or data.get('id') or '').strip()
        event_source = str(data.get('event_source') or '').strip()
        extra_data = data.get('extra_data') if isinstance(data.get('extra_data'), dict) else {}
        extra_data = dict(extra_data)
        for key in UPSTREAM_ACTIVATION_FIELDS:
            if key in data and data[key] not in (None, ''):
                extra_data.setdefault(key, data[key])
        rulebook_id = str(extra_data.get('rulebook_id') or '').strip()
        poll = bool(data.get('poll', True))
        include_events = bool(data.get('include_events', True))

        if not rulebook_name and not activation_id and not rulebook_id:
            return Response({'detail': _('Provide rulebook_name, rulebook_id, or activation_id.')}, status=http_status.HTTP_400_BAD_REQUEST)

        client = EDAControllerClient()
        try:
            result = client.ensure_activation_started(
                rulebook_name or rulebook_id or activation_id,
                activation_id=activation_id,
                event_source=event_source,
                extra_data=extra_data,
                poll=poll,
                include_events=include_events,
            )
        except EDAControllerError as exc:
            return _eda_error_response(exc)

        return Response(
            {
                'source': 'eda_controller',
                'activation': result['activation'],
                'actions': result['actions'],
                'events': result['events'],
            },
            status=http_status.HTTP_200_OK,
        )
