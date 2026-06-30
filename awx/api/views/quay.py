# Copyright (c) 2026 Red Hat, Inc.
# All Rights Reserved.

import shlex
from urllib.parse import urlparse

from django.utils.translation import gettext_lazy as _
from rest_framework import status as http_status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from awx.api.generics import APIView
from awx.api.versioning import reverse
from awx.api.views.galaxy_ng import (
    _project_for_build_plan,
    _resolve_project_build_source,
    _validate_image_name,
    _validate_image_tag,
    _validate_relative_cli_path,
)
from awx.main.utils.quay import (
    QuayClient,
    QuayControllerError,
    configured_namespace,
    configured_url,
    connection_status,
    module_enabled,
    normalize_repository_list,
    normalize_tag_list,
)

QUAY_CONTAINER_RUNTIMES = ('podman', 'docker')


def _parse_positive_int(value, default, maximum=None):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    parsed = max(parsed, 1)
    if maximum is not None:
        parsed = min(parsed, maximum)
    return parsed


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


def _quay_error_response(exc):
    response_status = (
        http_status.HTTP_400_BAD_REQUEST if exc.status in ('bad_request', 'invalid', 'not_configured', 'missing') else http_status.HTTP_502_BAD_GATEWAY
    )
    return Response({'detail': str(exc), 'status': exc.status}, status=response_status)


class QuayStatusView(APIView):
    name = _('Project Quay Status')
    resource_purpose = 'project quay execution environment registry status'
    permission_classes = (IsAuthenticated,)

    def get(self, request, format=None):
        client = QuayClient()
        server_url = configured_url()
        status = connection_status(server_url)
        namespace = configured_namespace()
        messages = {
            'configured': _('Project Quay registry URL is configured.'),
            'disabled': _('Project Quay module is disabled.'),
            'invalid': _('Project Quay registry URL is invalid.'),
            'not_configured': _('Project Quay registry URL is not configured.'),
        }
        response = {
            'enabled': module_enabled(),
            'configured': status == 'configured',
            'status': status,
            'server_url': server_url,
            'registry': client.registry,
            'namespace': namespace,
            'auth_configured': client.auth_configured,
            'push_configured': client.push_configured,
            'push_username_configured': bool(client.push_username),
            'push_token_configured': bool(client.push_token),
            'verify_ssl': client.verify_ssl,
            'request_timeout': client.timeout,
            'settings_url': reverse('api:setting_singleton_detail', kwargs={'category_slug': 'quay'}, request=request),
            'message': messages.get(status, _('Project Quay registry URL is not configured.')),
            'counts': {
                'repositories': 0,
                'tags': 0,
            },
            'controller_error': '',
        }

        if status != 'configured' or not namespace:
            if status == 'configured' and not namespace:
                response['controller_error'] = _('Project Quay namespace is not configured.')
            return Response(response)

        try:
            repositories = normalize_repository_list(client.repositories(namespace=namespace, params={'limit': 100}))
            response['counts']['repositories'] = repositories['count']
        except QuayControllerError as exc:
            response['controller_error'] = str(exc)

        return Response(response)


class QuayRepositoriesListView(APIView):
    name = _('Project Quay Repositories')
    resource_purpose = 'project quay repositories'
    permission_classes = (IsAuthenticated,)

    def get(self, request, format=None):
        if not module_enabled():
            return Response(_empty_resource_response('repositories', 'module_disabled', _('Project Quay module is disabled.')))
        if connection_status() != 'configured':
            return Response(_empty_resource_response('repositories', 'not_configured', _('Project Quay registry URL is not configured.')))

        page = _parse_positive_int(request.query_params.get('page'), 1)
        page_size = _parse_positive_int(request.query_params.get('page_size'), 20, maximum=100)
        namespace = request.query_params.get('namespace') or configured_namespace()
        params = {'limit': page_size, 'next_page': request.query_params.get('next_page') or ''}
        query = request.query_params.get('search') or request.query_params.get('name__icontains')
        if query:
            params['query'] = query
        client = QuayClient()
        try:
            payload = client.repositories(namespace=namespace, params=params)
        except QuayControllerError as exc:
            return _quay_error_response(exc)

        response = normalize_repository_list(payload, offset=(page - 1) * page_size)
        response['source'] = 'quay'
        response['resource'] = 'repositories'
        response['namespace'] = namespace
        response['controller_error'] = ''
        return Response(response)


class QuayTagsListView(APIView):
    name = _('Project Quay Repository Tags')
    resource_purpose = 'project quay repository image tags'
    permission_classes = (IsAuthenticated,)

    def get(self, request, format=None):
        if not module_enabled():
            return Response(_empty_resource_response('tags', 'module_disabled', _('Project Quay module is disabled.')))
        if connection_status() != 'configured':
            return Response(_empty_resource_response('tags', 'not_configured', _('Project Quay registry URL is not configured.')))

        page = _parse_positive_int(request.query_params.get('page'), 1)
        page_size = _parse_positive_int(request.query_params.get('page_size'), 20, maximum=100)
        namespace = request.query_params.get('namespace') or configured_namespace()
        repository = request.query_params.get('repository') or request.query_params.get('name')
        if not repository:
            return Response({'detail': _('Project Quay repository is required.'), 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)

        client = QuayClient()
        try:
            payload = client.tags(repository, namespace=namespace, params={'limit': page_size, 'page': page})
        except QuayControllerError as exc:
            return _quay_error_response(exc)

        response = normalize_tag_list(payload, offset=(page - 1) * page_size)
        response['source'] = 'quay'
        response['resource'] = 'tags'
        response['namespace'] = namespace
        response['repository'] = repository
        response['controller_error'] = ''
        return Response(response)


class QuayExecutionEnvironmentImageBuildPlanView(APIView):
    name = _('Project Quay Execution Environment Image Build Plan')
    resource_purpose = 'project quay execution environment image build and push command plan'
    permission_classes = (IsAuthenticated,)

    def post(self, request, format=None):
        if not module_enabled():
            return Response(
                {'detail': _('Project Quay module is disabled.'), 'status': 'disabled'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        if connection_status() != 'configured':
            return Response(
                {'detail': _('Project Quay registry URL is not configured.'), 'status': connection_status()},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        data = request.data if isinstance(request.data, dict) else {}
        project, error = _project_for_build_plan(request.user, data.get('project_id') or data.get('project'))
        if error:
            return Response({'detail': error, 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)

        namespace = str(data.get('namespace') or configured_namespace()).strip().strip('/')
        if not namespace:
            return Response({'detail': _('Project Quay namespace is required.'), 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)

        image_name, error = _validate_image_name(data.get('image_name') or data.get('repository') or 'custom-ee')
        if error:
            return Response({'detail': error, 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)
        image_tag, error = _validate_image_tag(data.get('tag') or data.get('image_tag') or 'latest')
        if error:
            return Response({'detail': error, 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)

        runtime = str(data.get('runtime') or 'podman').strip().lower()
        if runtime not in QUAY_CONTAINER_RUNTIMES:
            return Response(
                {'detail': _('Container runtime must be podman or docker.'), 'status': 'bad_request'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        definition_file, error = _validate_relative_cli_path(
            data.get('definition_file') or data.get('definition'), 'execution-environment.yml', _('Definition file')
        )
        if error:
            return Response({'detail': error, 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)
        context_path, error = _validate_relative_cli_path(data.get('context') or data.get('context_path'), '.', _('Build context'))
        if error:
            return Response({'detail': error, 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)
        project_source, error = _resolve_project_build_source(project, definition_file, context_path)
        if error:
            return Response({'detail': error, 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)

        client = QuayClient()
        registry = client.registry
        if not registry:
            return Response(
                {'detail': _('Project Quay registry URL does not include a registry hostname.'), 'status': 'bad_request'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        parsed = urlparse(client.server_url)
        insecure_registry = parsed.scheme == 'http' or not client.verify_ssl
        repository_path = f'{namespace}/{image_name}'
        full_image = f'{registry}/{repository_path}:{image_tag}'
        working_directory = project_source['project_path']
        username = client.push_username or '$QUAY_USERNAME'
        login_command = f'echo \"$QUAY_TOKEN\" | {runtime} login {shlex.quote(registry)} --username {shlex.quote(username)} --password-stdin'
        push_command = f'{runtime} push {shlex.quote(full_image)}'
        if runtime == 'podman' and insecure_registry:
            login_command = (
                f'echo \"$QUAY_TOKEN\" | {runtime} login --tls-verify=false {shlex.quote(registry)} --username {shlex.quote(username)} --password-stdin'
            )
            push_command = f'{runtime} push --tls-verify=false {shlex.quote(full_image)}'

        response = {
            'source': 'quay',
            'project': project_source,
            'registry': {
                'server_url': client.server_url,
                'registry': registry,
                'namespace': namespace,
                'insecure': insecure_registry,
                'api_token_configured': client.auth_configured,
                'push_username_configured': bool(client.push_username),
                'push_token_configured': bool(client.push_token),
            },
            'image': {
                'repository': image_name,
                'tag': image_tag,
                'repository_path': repository_path,
                'awx': full_image,
                'push': full_image,
            },
            'commands': [
                {
                    'label': _('Build execution environment'),
                    'command': '%s && %s'
                    % (
                        f'cd {shlex.quote(working_directory)}',
                        ' '.join(
                            [
                                'ansible-builder',
                                'build',
                                '--container-runtime',
                                shlex.quote(runtime),
                                '-f',
                                shlex.quote(definition_file),
                                '-t',
                                shlex.quote(full_image),
                                shlex.quote(context_path),
                            ]
                        ),
                    ),
                    'working_directory': working_directory,
                },
                {
                    'label': _('Log in to Project Quay'),
                    'command': login_command,
                },
                {
                    'label': _('Push to Project Quay'),
                    'command': push_command,
                },
            ],
            'awx_execution_environment': {
                'image': full_image,
                'pull': 'missing',
            },
            'notes': [
                _('Project Quay hosts AWX execution environment container images. Galaxy NG remains the Automation Hub for collections and related content.'),
                _('Set QUAY_TOKEN to a robot account token before running the generated login command; AWX does not print stored secret values.'),
                _('Use the AWX image value when creating or updating an AWX execution environment.'),
            ],
        }
        if runtime == 'docker' and insecure_registry:
            response['notes'].append(_('Docker requires the Project Quay registry to be configured as an insecure registry before pushing over HTTP.'))
        return Response(response)
