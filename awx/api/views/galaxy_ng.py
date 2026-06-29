# Copyright (c) 2026 Red Hat, Inc.
# All Rights Reserved.

from django.utils.translation import gettext_lazy as _
from rest_framework import status as http_status
from rest_framework.response import Response

from awx.api.generics import APIView
from awx.api.versioning import reverse
from awx.main.utils.galaxy_ng import (
    GalaxyNGClient,
    GalaxyNGControllerError,
    configured_url,
    connection_status,
    module_enabled,
    normalize_list_response,
)


GALAXY_NG_RESOURCE_PATHS = {
    'namespaces': 'v3/namespaces/',
    'collections': 'v3/collections/',
    'repositories': 'pulp/api/v3/repositories/ansible/ansible/',
    'tasks': 'pulp/api/v3/tasks/',
}

GALAXY_NG_DISTRIBUTION_PATH_CHARS = set('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.-')


def _parse_positive_int(value, default, maximum=None):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    parsed = max(parsed, 1)
    if maximum is not None:
        parsed = min(parsed, maximum)
    return parsed


def _galaxy_list_params(request, page, page_size):
    params = {
        'limit': page_size,
        'offset': (page - 1) * page_size,
    }
    for key, values in request.query_params.lists():
        if key in ('page', 'page_size'):
            continue
        value = values if len(values) > 1 else values[0]
        if key == 'order_by':
            params['ordering'] = value
        elif key in ('name__icontains', 'search'):
            params['search'] = value
        else:
            params[key] = value
    return params


def _empty_resource_response(resource, source, detail=''):
    return {
        'count': 0,
        'next': None,
        'previous': None,
        'source': source,
        'resource': resource,
        'controller_error': '',
        'detail': detail,
        'results': [],
    }


def _galaxy_ng_error_response(exc):
    response_status = (
        http_status.HTTP_400_BAD_REQUEST if exc.status in ('bad_request', 'invalid', 'not_configured', 'missing') else http_status.HTTP_502_BAD_GATEWAY
    )
    return Response({'detail': str(exc), 'status': exc.status}, status=response_status)


def _validate_distribution_path(value):
    value = str(value or '').strip()
    if not value:
        return '', _('Repository or distribution path is required.')
    if any(char not in GALAXY_NG_DISTRIBUTION_PATH_CHARS for char in value):
        return '', _('Distribution path may contain only letters, numbers, dots, underscores, and hyphens.')
    if value in ('.', '..'):
        return '', _('Distribution path is invalid.')
    return value, ''


class GalaxyNGStatusView(APIView):
    name = _('Galaxy NG Status')
    resource_purpose = 'galaxy ng private automation hub status'

    def get(self, request, format=None):
        client = GalaxyNGClient()
        server_url = configured_url()
        status = connection_status(server_url)
        messages = {
            'configured': _('Galaxy NG server URL is configured.'),
            'disabled': _('Galaxy NG module is disabled.'),
            'invalid': _('Galaxy NG server URL is invalid.'),
            'not_configured': _('Galaxy NG server URL is not configured.'),
        }
        response = {
            'enabled': module_enabled(),
            'configured': status == 'configured',
            'status': status,
            'server_url': server_url,
            'api_root_url': f'{server_url}{client.api_path_prefix}' if server_url else '',
            'content_url': f'{server_url}{client.content_path_prefix}' if server_url else '',
            'ui_url': f'{server_url}/ui/' if server_url else '',
            'auth_configured': client.auth_configured,
            'verify_ssl': client.verify_ssl,
            'request_timeout': client.timeout,
            'api_path_prefix': client.api_path_prefix,
            'content_path_prefix': client.content_path_prefix,
            'settings_url': reverse('api:setting_singleton_detail', kwargs={'category_slug': 'galaxy_ng'}, request=request),
            'message': messages.get(status, _('Galaxy NG server URL is not configured.')),
            'counts': {
                'namespaces': 0,
                'collections': 0,
                'repositories': 0,
                'tasks': 0,
            },
            'pulp_status': {},
            'controller_error': '',
        }

        if status != 'configured':
            return Response(response)

        api_prefix = client.api_path_prefix.rstrip('/')
        count_paths = {
            'namespaces': f'{api_prefix}/v3/namespaces/',
            'collections': f'{api_prefix}/v3/collections/',
            'repositories': f'{api_prefix}/pulp/api/v3/repositories/ansible/ansible/',
            'tasks': f'{api_prefix}/pulp/api/v3/tasks/',
        }
        try:
            response['pulp_status'] = client.pulp_status()
            for key, path in count_paths.items():
                try:
                    response['counts'][key] = client.count(path)
                except GalaxyNGControllerError as exc:
                    response['controller_error'] = str(exc)
        except GalaxyNGControllerError as exc:
            response['controller_error'] = str(exc)

        return Response(response)


class GalaxyNGResourceListView(APIView):
    name = _('Galaxy NG Resources')
    resource_purpose = 'galaxy ng private automation hub resources'
    resource = ''

    def get_resource_path(self, client):
        return f'{client.api_path_prefix.rstrip("/")}/{GALAXY_NG_RESOURCE_PATHS[self.resource]}'

    def get(self, request, format=None):
        if not module_enabled():
            return Response(
                _empty_resource_response(
                    self.resource,
                    'module_disabled',
                    _('Galaxy NG module is disabled.'),
                )
            )
        if connection_status() != 'configured':
            return Response(_empty_resource_response(self.resource, 'not_configured'))

        page = _parse_positive_int(request.query_params.get('page'), 1)
        page_size = _parse_positive_int(request.query_params.get('page_size'), 20, maximum=200)
        client = GalaxyNGClient()
        try:
            payload = client.get(
                self.get_resource_path(client),
                params=_galaxy_list_params(request, page, page_size),
            )
        except GalaxyNGControllerError as exc:
            return Response(
                {
                    'count': 0,
                    'next': None,
                    'previous': None,
                    'source': 'galaxy_ng',
                    'resource': self.resource,
                    'controller_error': str(exc),
                    'results': [],
                },
                status=502,
            )

        response = normalize_list_response(payload, offset=(page - 1) * page_size)
        response['source'] = 'galaxy_ng'
        response['resource'] = self.resource
        response['controller_error'] = ''
        return Response(response)


class GalaxyNGNamespacesListView(GalaxyNGResourceListView):
    name = _('Galaxy NG Namespaces')
    resource = 'namespaces'


class GalaxyNGCollectionsListView(GalaxyNGResourceListView):
    name = _('Galaxy NG Collections')
    resource = 'collections'


class GalaxyNGRepositoriesListView(GalaxyNGResourceListView):
    name = _('Galaxy NG Repositories')
    resource = 'repositories'


class GalaxyNGTasksListView(GalaxyNGResourceListView):
    name = _('Galaxy NG Tasks')
    resource = 'tasks'


class GalaxyNGRepositorySyncView(APIView):
    name = _('Galaxy NG Repository Sync')
    resource_purpose = 'galaxy ng private automation hub repository sync'

    def post(self, request, format=None):
        if not request.user.is_superuser:
            return Response(
                {'detail': _('You do not have permission to sync Galaxy NG repositories.')},
                status=http_status.HTTP_403_FORBIDDEN,
            )
        if not module_enabled():
            return Response(
                {'detail': _('Galaxy NG module is disabled.'), 'status': 'disabled'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        if connection_status() != 'configured':
            return Response(
                {'detail': _('Galaxy NG server URL is not configured.'), 'status': connection_status()},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        data = request.data if isinstance(request.data, dict) else {}
        repository = data.get('repository') or data.get('name') or data.get('base_path') or data.get('distro_base_path')
        repository, error = _validate_distribution_path(repository)
        if error:
            return Response({'detail': error, 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)

        client = GalaxyNGClient()
        try:
            base_path = client.ansible_distribution_base_path(repository)
            base_path, error = _validate_distribution_path(base_path)
            if error:
                return Response({'detail': error, 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)
            payload = client.sync_ansible_distribution(base_path)
        except GalaxyNGControllerError as exc:
            return _galaxy_ng_error_response(exc)

        return Response(
            {
                'source': 'galaxy_ng',
                'repository': repository,
                'base_path': base_path,
                'task': payload.get('task') if isinstance(payload, dict) else None,
                'response': payload,
            },
            status=http_status.HTTP_202_ACCEPTED,
        )
