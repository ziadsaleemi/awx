# Copyright (c) 2026 Red Hat, Inc.
# All Rights Reserved.

from urllib.parse import urlparse

from django.conf import settings
from django.db.models import Q
from django.utils.dateparse import parse_datetime
from django.utils.translation import gettext_lazy as _
from rest_framework.response import Response

from awx.api.generics import APIView
from awx.api.versioning import reverse
from awx.main import models
from awx.main.access import get_user_queryset


_EDA_JOB_MATCH_FIELDS = ('name', 'description')


def _configured_url():
    return (getattr(settings, 'EDA_SERVER_URL', '') or '').strip().rstrip('/')


def _connection_status(controller_url):
    if not controller_url:
        return 'not_configured'
    parsed = urlparse(controller_url)
    if parsed.scheme not in ('http', 'https') or not parsed.netloc:
        return 'invalid'
    return 'configured'


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

    def get(self, request, format=None):
        controller_url = _configured_url()
        status = _connection_status(controller_url)
        return Response(
            {
                'configured': status == 'configured',
                'status': status,
                'controller_url': controller_url,
                'message': _('EDA Controller URL is configured.') if status == 'configured' else _('EDA Controller URL is not configured.'),
                'settings_url': reverse('api:setting_singleton_detail', kwargs={'category_slug': 'eda'}, request=request),
                'activations_url': reverse('api:eda_activation_list', request=request),
            }
        )


class EDAActivationListView(APIView):
    name = _('EDA Activations')
    resource_purpose = 'event-driven ansible activation summary'

    def get(self, request, format=None):
        page = _parse_positive_int(request.query_params.get('page'), 1)
        page_size = _parse_positive_int(request.query_params.get('page_size'), 20, maximum=200)
        controller_url = _configured_url()

        if not controller_url:
            return Response({'count': 0, 'next': None, 'previous': None, 'results': []})

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
                'results': results,
            }
        )
