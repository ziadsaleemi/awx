# Copyright (c) 2026 Red Hat, Inc.
# All Rights Reserved.

from django.utils.translation import gettext_lazy as _
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
