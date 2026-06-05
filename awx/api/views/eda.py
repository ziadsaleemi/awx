# Copyright (c) 2026 Red Hat, Inc.
# All Rights Reserved.

from django.db.models import Q
from django.utils.dateparse import parse_datetime
from django.utils.translation import gettext_lazy as _
from rest_framework import status as http_status
from rest_framework.response import Response

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
from awx.main.utils.eda import EDAControllerClient, EDAControllerError, configured_url, connection_status

_EDA_JOB_MATCH_FIELDS = ('name', 'description')


def _parse_positive_int(value, default, maximum=None):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    parsed = max(parsed, 1)
    if maximum is not None:
        parsed = min(parsed, maximum)
    return parsed


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
    return request.build_absolute_uri(f'{request.path}?{query.urlencode()}')


class EDAStatusView(APIView):
    name = _('EDA Status')
    resource_purpose = 'event-driven ansible controller status'
    permission_classes = [EDAActivationViewPermission]

    def get(self, request, format=None):
        client = EDAControllerClient()
        controller_url = configured_url()
        status = connection_status(controller_url)
        return Response(
            {
                'configured': status == 'configured',
                'status': status,
                'controller_url': controller_url,
                'auth_configured': client.auth_configured,
                'verify_ssl': client.verify_ssl,
                'request_timeout': client.timeout,
                'activations_api_path': client.activations_path,
                'activation_start_api_path': client.activation_start_path,
                'activation_instance_logs_api_path': client.activation_instance_logs_path,
                'activation_events_api_path': client.activation_events_path,
                'activation_poll_attempts': client.poll_attempts,
                'activation_poll_interval': client.poll_interval,
                'message': _('EDA Controller URL is configured.') if status == 'configured' else _('EDA Controller URL is not configured.'),
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
                'event_source': 'AWX job metadata',
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
    response_status = http_status.HTTP_400_BAD_REQUEST if exc.status in ('invalid', 'not_configured', 'missing') else http_status.HTTP_503_SERVICE_UNAVAILABLE
    return Response({'detail': str(exc), 'status': exc.status}, status=response_status)


class EDAActivationDetailView(APIView):
    name = _('EDA Activation Detail')
    resource_purpose = 'event-driven ansible activation detail'
    permission_classes = [EDAActivationViewPermission]

    def get(self, request, pk, format=None):
        client = EDAControllerClient()
        try:
            activation = client.get_activation(pk)
        except EDAControllerError as exc:
            return _eda_error_response(exc)
        return Response(activation)

    def delete(self, request, pk, format=None):
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
        data = request.data if isinstance(request.data, dict) else {}
        rulebook_name = str(data.get('rulebook_name') or data.get('name') or '').strip()
        activation_id = str(data.get('activation_id') or data.get('id') or '').strip()
        event_source = str(data.get('event_source') or '').strip()
        extra_data = data.get('extra_data') if isinstance(data.get('extra_data'), dict) else {}
        poll = bool(data.get('poll', True))
        include_events = bool(data.get('include_events', True))

        if not rulebook_name and not activation_id:
            return Response({'detail': _('Provide rulebook_name or activation_id.')}, status=http_status.HTTP_400_BAD_REQUEST)

        client = EDAControllerClient()
        try:
            result = client.ensure_activation_started(
                rulebook_name or activation_id,
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
