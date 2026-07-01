# Copyright (c) 2026 Red Hat, Inc.
# All Rights Reserved.

import hashlib
import shlex
from urllib.parse import urlparse

from django.core.cache import cache
from django.utils.translation import gettext_lazy as _
from rest_framework import status as http_status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from awx.api.generics import APIView
from awx.api.versioning import reverse
from awx.api.views.content_permissions import QuayManagePermission, QuayViewPermission
from awx.api.views.content_permissions import user_can_manage_quay
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
    normalize_quay_list,
    normalize_repository_list,
    normalize_tag_list,
)

QUAY_CONTAINER_RUNTIMES = ('podman', 'docker')
QUAY_REPOSITORY_VISIBILITIES = ('public', 'private')
QUAY_REPOSITORY_ROLES = ('read', 'write', 'admin')
QUAY_ROBOT_NAMESPACE_KINDS = ('user', 'organization')
QUAY_STATUS_CACHE_TIMEOUT = 15


def _quay_status_cache_key(client, server_url, namespace):
    fingerprint = '|'.join(
        [
            server_url or '',
            namespace or '',
            str(client.verify_ssl),
            str(client.timeout),
            str(client.auth_configured),
        ]
    )
    return f'awx:quay:status:{hashlib.sha256(fingerprint.encode()).hexdigest()}'


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


def _validate_repository_name(value):
    repository, error = _validate_image_name(value)
    if error:
        return '', _('Repository name may contain lowercase letters, numbers, dots, underscores, and hyphens.')
    if '/' in repository:
        return '', _('Repository name cannot include a namespace path. Use the namespace field separately.')
    return repository, ''


def _validate_path_segment(value, label):
    segment = str(value or '').strip().strip('/')
    if not segment:
        return '', _('%(label)s is required.') % {'label': label}
    if '/' in segment:
        return '', _('%(label)s cannot include a slash.') % {'label': label}
    return segment, ''


def _validate_role(value):
    role = str(value or '').strip().lower()
    if role not in QUAY_REPOSITORY_ROLES:
        return '', _('Role must be read, write, or admin.')
    return role, ''


def _validate_robot_shortname(value):
    robot, error = _validate_image_name(value)
    if error:
        return '', _('Robot short name may contain lowercase letters, numbers, dots, underscores, and hyphens.')
    if '/' in robot:
        return '', _('Robot short name cannot include a namespace path.')
    return robot, ''


def _namespace_kind(value):
    kind = str(value or 'user').strip().lower()
    if kind == 'org':
        kind = 'organization'
    if kind not in QUAY_ROBOT_NAMESPACE_KINDS:
        return '', _('Namespace kind must be user or organization.')
    return kind, ''


def _repository_action_payload(request):
    if not module_enabled():
        return None, Response({'detail': _('Project Quay module is disabled.'), 'status': 'disabled'}, status=http_status.HTTP_400_BAD_REQUEST)
    if connection_status() != 'configured':
        return None, Response(
            {'detail': _('Project Quay registry URL is not configured.'), 'status': connection_status()},
            status=http_status.HTTP_400_BAD_REQUEST,
        )
    data = request.data if isinstance(request.data, dict) else {}
    namespace = str(data.get('namespace') or configured_namespace()).strip().strip('/')
    if not namespace:
        return None, Response({'detail': _('Project Quay namespace is required.'), 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)
    repository, error = _validate_repository_name(data.get('repository') or data.get('name'))
    if error:
        return None, Response({'detail': error, 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)
    return (data, namespace, repository), None


def _repository_query_payload(request):
    if not module_enabled():
        return None, Response({'detail': _('Project Quay module is disabled.'), 'status': 'disabled'}, status=http_status.HTTP_400_BAD_REQUEST)
    if connection_status() != 'configured':
        return None, Response(
            {'detail': _('Project Quay registry URL is not configured.'), 'status': connection_status()},
            status=http_status.HTTP_400_BAD_REQUEST,
        )
    namespace = str(request.query_params.get('namespace') or configured_namespace()).strip().strip('/')
    if not namespace:
        return None, Response({'detail': _('Project Quay namespace is required.'), 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)
    repository, error = _validate_repository_name(request.query_params.get('repository') or request.query_params.get('name'))
    if error:
        return None, Response({'detail': error, 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)
    return (namespace, repository), None


def _repository_action_response(action, namespace, repository, payload):
    return {
        'source': 'quay',
        'action': action,
        'namespace': namespace,
        'repository': repository,
        'repository_path': f'{namespace}/{repository}',
        'response': payload,
    }


def _normalize_permissions(payload, principal_key):
    if isinstance(payload, dict):
        if isinstance(payload.get('permissions'), list):
            items = payload['permissions']
        elif isinstance(payload.get('results'), list):
            items = payload['results']
        elif payload and all(isinstance(value, dict) for value in payload.values()):
            items = [{principal_key: key, **value} for key, value in payload.items()]
        elif payload:
            items = [payload]
        else:
            items = []
    elif isinstance(payload, list):
        items = payload
    else:
        items = []

    results = []
    for index, item in enumerate(items):
        normalized = dict(item) if isinstance(item, dict) else {principal_key: str(item)}
        if 'name' in normalized and principal_key not in normalized:
            normalized[principal_key] = normalized['name']
        normalized.setdefault('id', index + 1)
        normalized.setdefault('_awx_key', str(normalized['id']))
        results.append(normalized)
    return {'count': len(results), 'next': None, 'previous': None, 'results': results}


class QuayStatusView(APIView):
    name = _('Project Quay Status')
    resource_purpose = 'project quay execution environment registry status'
    permission_classes = (IsAuthenticated, QuayViewPermission)

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
            'can_manage': user_can_manage_quay(request.user),
            'management_configured': client.auth_configured,
            'management_required_scopes': ['repo:read', 'repo:create', 'repo:write', 'repo:admin', 'user:admin', 'org:admin'],
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

        cache_key = _quay_status_cache_key(client, server_url, namespace)
        live_status = None if request.query_params.get('refresh') else cache.get(cache_key)
        if live_status is None:
            live_status = {
                'counts': {
                    'repositories': 0,
                    'tags': 0,
                },
                'controller_error': '',
            }
            try:
                repositories = normalize_repository_list(client.repositories(namespace=namespace, params={'limit': 100}))
                live_status['counts']['repositories'] = repositories['count']
            except QuayControllerError as exc:
                live_status['controller_error'] = str(exc)
            cache.set(cache_key, live_status, QUAY_STATUS_CACHE_TIMEOUT)

        response['counts'].update(live_status.get('counts') or {})
        response['controller_error'] = live_status.get('controller_error') or ''

        return Response(response)


class QuayApiTokenPlanView(APIView):
    name = _("Project Quay API Token Plan")
    resource_purpose = "project quay OAuth and API token setup plan"
    permission_classes = (IsAuthenticated, QuayManagePermission)

    def get(self, request, format=None):
        client = QuayClient()
        server_url = configured_url()
        namespace = configured_namespace()
        registry_status = connection_status(server_url)
        required_scopes = ["repo:read", "repo:create", "repo:write", "repo:admin", "user:admin", "org:admin"]
        response = {
            "source": "quay",
            "configured": registry_status == "configured",
            "status": registry_status,
            "server_url": server_url,
            "namespace": namespace,
            "auth_configured": client.auth_configured,
            "settings_url": reverse("api:setting_singleton_detail", kwargs={"category_slug": "quay"}, request=request),
            "required_scopes": required_scopes,
            "token_setting": "QUAY_API_TOKEN",
            "push_settings": ["QUAY_PUSH_USERNAME", "QUAY_PUSH_TOKEN"],
            "oauth_application": {
                "name": "AWX Project Quay Management",
                "description": _("OAuth application used by AWX to manage Project Quay repositories, robots, permissions, and tags."),
                "create_method": "POST",
                "create_url": f"{server_url}/api/v1/organization/{namespace}/applications" if registry_status == "configured" and namespace else "",
                "payload": {
                    "name": "AWX Project Quay Management",
                    "description": "AWX-managed Project Quay integration",
                    "application_uri": server_url,
                    "redirect_uri": server_url,
                },
            },
            "app_specific_token": {
                "create_method": "POST",
                "create_url": f"{server_url}/api/v1/user/apptoken" if registry_status == "configured" else "",
                "payload": {"friendlyName": "AWX Project Quay Management"},
            },
            "validation_commands": [],
            "notes": [
                _("Store only the final token value in QUAY_API_TOKEN. AWX does not display stored secret values."),
                _("Use robot push credentials separately for image push commands; QUAY_API_TOKEN is for Quay API management."),
            ],
        }
        if registry_status == "configured":
            response["validation_commands"] = [
                {
                    "label": _("Validate repository read access"),
                    "command": (
                        'curl -fsS -H "Authorization: Bearer $QUAY_API_TOKEN" '
                        f"{shlex.quote(f'{server_url}/api/v1/repository?namespace={namespace}&limit=1')}"
                    ),
                },
                {
                    "label": _("Validate robot management scope"),
                    "command": (
                        (
                            'curl -fsS -H "Authorization: Bearer $QUAY_API_TOKEN" '
                            f"{shlex.quote(f'{server_url}/api/v1/organization/{namespace}/robots?token=false&permissions=true')}"
                        )
                        if namespace
                        else ""
                    ),
                },
                {
                    "label": _("Validate user token scope"),
                    "command": (
                        'curl -fsS -H "Authorization: Bearer $QUAY_API_TOKEN" '
                        f"{shlex.quote(f'{server_url}/api/v1/user/robots?token=false&permissions=true')}"
                    ),
                },
            ]
        return Response(response)


class QuayRepositoryCreateView(APIView):
    name = _('Project Quay Repository Create')
    resource_purpose = 'create project quay repository'
    permission_classes = (IsAuthenticated, QuayManagePermission)

    def post(self, request, format=None):
        payload, error_response = _repository_action_payload(request)
        if error_response:
            return error_response
        data, namespace, repository = payload
        visibility = str(data.get('visibility') or 'private').strip().lower()
        if visibility not in QUAY_REPOSITORY_VISIBILITIES:
            return Response({'detail': _('Visibility must be public or private.'), 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)
        repo_kind = str(data.get('repo_kind') or 'image').strip().lower()
        if repo_kind not in ('image', 'application'):
            return Response({'detail': _('Repository kind must be image or application.'), 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)
        description = str(data.get('description') or '')
        try:
            result = QuayClient().create_repository(repository, namespace=namespace, visibility=visibility, description=description, repo_kind=repo_kind)
        except QuayControllerError as exc:
            return _quay_error_response(exc)
        return Response(_repository_action_response('create', namespace, repository, result), status=http_status.HTTP_201_CREATED)


class QuayRepositoryUpdateView(APIView):
    name = _('Project Quay Repository Update')
    resource_purpose = 'update project quay repository'
    permission_classes = (IsAuthenticated, QuayManagePermission)

    def post(self, request, format=None):
        payload, error_response = _repository_action_payload(request)
        if error_response:
            return error_response
        data, namespace, repository = payload
        try:
            result = QuayClient().update_repository(repository, namespace=namespace, description=str(data.get('description') or ''))
        except QuayControllerError as exc:
            return _quay_error_response(exc)
        return Response(_repository_action_response('update', namespace, repository, result))


class QuayRepositoryChangeVisibilityView(APIView):
    name = _('Project Quay Repository Change Visibility')
    resource_purpose = 'change project quay repository visibility'
    permission_classes = (IsAuthenticated, QuayManagePermission)

    def post(self, request, format=None):
        payload, error_response = _repository_action_payload(request)
        if error_response:
            return error_response
        data, namespace, repository = payload
        visibility = str(data.get('visibility') or '').strip().lower()
        if visibility not in QUAY_REPOSITORY_VISIBILITIES:
            return Response({'detail': _('Visibility must be public or private.'), 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)
        try:
            result = QuayClient().change_repository_visibility(repository, namespace=namespace, visibility=visibility)
        except QuayControllerError as exc:
            return _quay_error_response(exc)
        response = _repository_action_response('change_visibility', namespace, repository, result)
        response['visibility'] = visibility
        return Response(response)


class QuayRepositoryDeleteView(APIView):
    name = _('Project Quay Repository Delete')
    resource_purpose = 'delete project quay repository'
    permission_classes = (IsAuthenticated, QuayManagePermission)

    def post(self, request, format=None):
        payload, error_response = _repository_action_payload(request)
        if error_response:
            return error_response
        _data, namespace, repository = payload
        try:
            result = QuayClient().delete_repository(repository, namespace=namespace)
        except QuayControllerError as exc:
            return _quay_error_response(exc)
        return Response(_repository_action_response('delete', namespace, repository, result))


class QuayRepositoriesListView(APIView):
    name = _('Project Quay Repositories')
    resource_purpose = 'project quay repositories'
    permission_classes = (IsAuthenticated, QuayViewPermission)

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
    permission_classes = (IsAuthenticated, QuayViewPermission)

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


class QuayTagDeleteView(APIView):
    name = _('Project Quay Tag Delete')
    resource_purpose = 'delete project quay repository image tag'
    permission_classes = (IsAuthenticated, QuayManagePermission)

    def post(self, request, format=None):
        payload, error_response = _repository_action_payload(request)
        if error_response:
            return error_response
        data, namespace, repository = payload
        tag, error = _validate_image_tag(data.get('tag') or data.get('name'))
        if error:
            return Response({'detail': _('Project Quay tag is required.'), 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)
        try:
            result = QuayClient().delete_tag(repository, tag, namespace=namespace)
        except QuayControllerError as exc:
            return _quay_error_response(exc)
        response = _repository_action_response('delete_tag', namespace, repository, result)
        response['tag'] = tag
        return Response(response)


class QuayRepositoryPermissionsView(APIView):
    name = _('Project Quay Repository Permissions')
    resource_purpose = 'project quay repository user and team permissions'
    permission_classes = (IsAuthenticated, QuayManagePermission)

    def get(self, request, format=None):
        payload, error_response = _repository_query_payload(request)
        if error_response:
            return error_response
        namespace, repository = payload
        client = QuayClient()
        if not client.auth_configured:
            response = _empty_resource_response('repository_permissions', 'api_token_missing', _('Project Quay API token is not configured.'))
            response['namespace'] = namespace
            response['repository'] = repository
            response['users'] = []
            response['teams'] = []
            return Response(response)
        try:
            users = _normalize_permissions(client.repository_user_permissions(repository, namespace=namespace), 'username')
            teams = _normalize_permissions(client.repository_team_permissions(repository, namespace=namespace), 'teamname')
        except QuayControllerError as exc:
            return _quay_error_response(exc)
        return Response(
            {
                'source': 'quay',
                'resource': 'repository_permissions',
                'namespace': namespace,
                'repository': repository,
                'users': users['results'],
                'teams': teams['results'],
                'count': users['count'] + teams['count'],
                'controller_error': '',
            }
        )


class QuayRepositoryUserPermissionSetView(APIView):
    name = _('Project Quay Repository User Permission Set')
    resource_purpose = 'set project quay repository user permission'
    permission_classes = (IsAuthenticated, QuayManagePermission)

    def post(self, request, format=None):
        payload, error_response = _repository_action_payload(request)
        if error_response:
            return error_response
        data, namespace, repository = payload
        username, error = _validate_path_segment(data.get('username') or data.get('user'), _('Username'))
        if error:
            return Response({'detail': error, 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)
        role, error = _validate_role(data.get('role'))
        if error:
            return Response({'detail': error, 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)
        try:
            result = QuayClient().set_repository_user_permission(repository, username, role, namespace=namespace)
        except QuayControllerError as exc:
            return _quay_error_response(exc)
        response = _repository_action_response('set_user_permission', namespace, repository, result)
        response.update({'username': username, 'role': role})
        return Response(response)


class QuayRepositoryUserPermissionDeleteView(APIView):
    name = _('Project Quay Repository User Permission Delete')
    resource_purpose = 'delete project quay repository user permission'
    permission_classes = (IsAuthenticated, QuayManagePermission)

    def post(self, request, format=None):
        payload, error_response = _repository_action_payload(request)
        if error_response:
            return error_response
        data, namespace, repository = payload
        username, error = _validate_path_segment(data.get('username') or data.get('user'), _('Username'))
        if error:
            return Response({'detail': error, 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)
        try:
            result = QuayClient().delete_repository_user_permission(repository, username, namespace=namespace)
        except QuayControllerError as exc:
            return _quay_error_response(exc)
        response = _repository_action_response('delete_user_permission', namespace, repository, result)
        response['username'] = username
        return Response(response)


class QuayRepositoryTeamPermissionSetView(APIView):
    name = _('Project Quay Repository Team Permission Set')
    resource_purpose = 'set project quay repository team permission'
    permission_classes = (IsAuthenticated, QuayManagePermission)

    def post(self, request, format=None):
        payload, error_response = _repository_action_payload(request)
        if error_response:
            return error_response
        data, namespace, repository = payload
        teamname, error = _validate_path_segment(data.get('teamname') or data.get('team'), _('Team name'))
        if error:
            return Response({'detail': error, 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)
        role, error = _validate_role(data.get('role'))
        if error:
            return Response({'detail': error, 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)
        try:
            result = QuayClient().set_repository_team_permission(repository, teamname, role, namespace=namespace)
        except QuayControllerError as exc:
            return _quay_error_response(exc)
        response = _repository_action_response('set_team_permission', namespace, repository, result)
        response.update({'teamname': teamname, 'role': role})
        return Response(response)


class QuayRepositoryTeamPermissionDeleteView(APIView):
    name = _('Project Quay Repository Team Permission Delete')
    resource_purpose = 'delete project quay repository team permission'
    permission_classes = (IsAuthenticated, QuayManagePermission)

    def post(self, request, format=None):
        payload, error_response = _repository_action_payload(request)
        if error_response:
            return error_response
        data, namespace, repository = payload
        teamname, error = _validate_path_segment(data.get('teamname') or data.get('team'), _('Team name'))
        if error:
            return Response({'detail': error, 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)
        try:
            result = QuayClient().delete_repository_team_permission(repository, teamname, namespace=namespace)
        except QuayControllerError as exc:
            return _quay_error_response(exc)
        response = _repository_action_response('delete_team_permission', namespace, repository, result)
        response['teamname'] = teamname
        return Response(response)


class QuayRobotsListView(APIView):
    name = _('Project Quay Robot Accounts')
    resource_purpose = 'project quay robot accounts'
    permission_classes = (IsAuthenticated, QuayManagePermission)

    def get(self, request, format=None):
        if not module_enabled():
            return Response(_empty_resource_response('robots', 'module_disabled', _('Project Quay module is disabled.')))
        if connection_status() != 'configured':
            return Response(_empty_resource_response('robots', 'not_configured', _('Project Quay registry URL is not configured.')))
        namespace_kind, error = _namespace_kind(request.query_params.get('namespace_kind'))
        if error:
            return Response({'detail': error, 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)
        namespace = str(request.query_params.get('namespace') or configured_namespace()).strip().strip('/')
        if namespace_kind == 'organization' and not namespace:
            return Response({'detail': _('Project Quay organization namespace is required.'), 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)

        client = QuayClient()
        if not client.auth_configured:
            response = _empty_resource_response('robots', 'api_token_missing', _('Project Quay API token is not configured.'))
            response['namespace'] = namespace
            response['namespace_kind'] = namespace_kind
            return Response(response)
        params = {
            'limit': _parse_positive_int(request.query_params.get('page_size'), 50, maximum=100),
            'token': False,
            'permissions': True,
        }
        try:
            payload = client.robots(namespace_kind=namespace_kind, namespace=namespace, params=params)
        except QuayControllerError as exc:
            return _quay_error_response(exc)
        response = normalize_quay_list(payload, ('robots',), offset=0)
        response['source'] = 'quay'
        response['resource'] = 'robots'
        response['namespace'] = namespace
        response['namespace_kind'] = namespace_kind
        response['controller_error'] = ''
        return Response(response)


class QuayRobotCreateView(APIView):
    name = _('Project Quay Robot Account Create')
    resource_purpose = 'create project quay robot account'
    permission_classes = (IsAuthenticated, QuayManagePermission)

    def post(self, request, format=None):
        if not module_enabled() or connection_status() != 'configured':
            return Response({'detail': _('Project Quay is not configured.'), 'status': connection_status()}, status=http_status.HTTP_400_BAD_REQUEST)
        data = request.data if isinstance(request.data, dict) else {}
        namespace_kind, error = _namespace_kind(data.get('namespace_kind'))
        if error:
            return Response({'detail': error, 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)
        namespace = str(data.get('namespace') or configured_namespace()).strip().strip('/')
        if namespace_kind == 'organization' and not namespace:
            return Response({'detail': _('Project Quay organization namespace is required.'), 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)
        robot, error = _validate_robot_shortname(data.get('robot') or data.get('name') or data.get('shortname'))
        if error:
            return Response({'detail': error, 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)
        description = str(data.get('description') or '')[:255]
        try:
            result = QuayClient().create_robot(robot, namespace_kind=namespace_kind, namespace=namespace, description=description)
        except QuayControllerError as exc:
            return _quay_error_response(exc)
        return Response(
            {
                'source': 'quay',
                'action': 'create_robot',
                'namespace_kind': namespace_kind,
                'namespace': namespace,
                'robot': robot,
                'response': result,
            },
            status=http_status.HTTP_201_CREATED,
        )


class QuayRobotDeleteView(APIView):
    name = _('Project Quay Robot Account Delete')
    resource_purpose = 'delete project quay robot account'
    permission_classes = (IsAuthenticated, QuayManagePermission)

    def post(self, request, format=None):
        if not module_enabled() or connection_status() != 'configured':
            return Response({'detail': _('Project Quay is not configured.'), 'status': connection_status()}, status=http_status.HTTP_400_BAD_REQUEST)
        data = request.data if isinstance(request.data, dict) else {}
        namespace_kind, error = _namespace_kind(data.get('namespace_kind'))
        if error:
            return Response({'detail': error, 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)
        namespace = str(data.get('namespace') or configured_namespace()).strip().strip('/')
        robot, error = _validate_robot_shortname(data.get('robot') or data.get('name') or data.get('shortname'))
        if error:
            return Response({'detail': error, 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)
        try:
            result = QuayClient().delete_robot(robot, namespace_kind=namespace_kind, namespace=namespace)
        except QuayControllerError as exc:
            return _quay_error_response(exc)
        return Response(
            {'source': 'quay', 'action': 'delete_robot', 'namespace_kind': namespace_kind, 'namespace': namespace, 'robot': robot, 'response': result}
        )


class QuayRobotRegenerateTokenView(APIView):
    name = _('Project Quay Robot Account Token Regenerate')
    resource_purpose = 'regenerate project quay robot account token'
    permission_classes = (IsAuthenticated, QuayManagePermission)

    def post(self, request, format=None):
        if not module_enabled() or connection_status() != 'configured':
            return Response({'detail': _('Project Quay is not configured.'), 'status': connection_status()}, status=http_status.HTTP_400_BAD_REQUEST)
        data = request.data if isinstance(request.data, dict) else {}
        namespace_kind, error = _namespace_kind(data.get('namespace_kind'))
        if error:
            return Response({'detail': error, 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)
        namespace = str(data.get('namespace') or configured_namespace()).strip().strip('/')
        robot, error = _validate_robot_shortname(data.get('robot') or data.get('name') or data.get('shortname'))
        if error:
            return Response({'detail': error, 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)
        try:
            result = QuayClient().regenerate_robot_token(robot, namespace_kind=namespace_kind, namespace=namespace)
        except QuayControllerError as exc:
            return _quay_error_response(exc)
        return Response(
            {'source': 'quay', 'action': 'regenerate_robot_token', 'namespace_kind': namespace_kind, 'namespace': namespace, 'robot': robot, 'response': result}
        )


class QuayExecutionEnvironmentImageBuildPlanView(APIView):
    name = _('Project Quay Execution Environment Image Build Plan')
    resource_purpose = 'project quay execution environment image build and push command plan'
    permission_classes = (IsAuthenticated, QuayManagePermission)

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
