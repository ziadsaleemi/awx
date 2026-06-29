# Copyright (c) 2026 Red Hat, Inc.
# All Rights Reserved.

from django.utils.translation import gettext_lazy as _
from rest_framework.response import Response

from awx.api.generics import APIView
from awx.api.versioning import reverse
from awx.main.utils.galaxy_ng import GalaxyNGClient, GalaxyNGControllerError, configured_url, connection_status, module_enabled


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
