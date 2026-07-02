# Copyright (c) 2026 Red Hat, Inc.
# All Rights Reserved.

import hashlib
import shlex
from urllib.parse import urlparse

from django.contrib.contenttypes.models import ContentType
from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils.translation import gettext_lazy as _
from rest_framework import status as http_status
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from awx.api import serializers
from awx.api.generics import (
    APIView,
    GenericCancelView,
    ListAPIView,
    RetrieveDestroyAPIView,
    SubListAPIView,
    SubListCreateAPIView,
    SubListCreateAttachDetachAPIView,
)
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
from awx.main import models
from awx.main.models import QuayImageBuild, QuayImageBuildJob, QuayImageBuildTemplate
from awx.main.tasks.quay import run_quay_image_build
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


def _quay_image_build_plan_for_request(request):
    data = request.data if isinstance(request.data, dict) else {}
    return _quay_image_build_plan_from_data(request, data)


def _quay_image_build_plan_from_data(request, data):
    if not module_enabled():
        return None, Response(
            {'detail': _('Project Quay module is disabled.'), 'status': 'disabled'},
            status=http_status.HTTP_400_BAD_REQUEST,
        )
    if connection_status() != 'configured':
        return None, Response(
            {'detail': _('Project Quay registry URL is not configured.'), 'status': connection_status()},
            status=http_status.HTTP_400_BAD_REQUEST,
        )

    project, error = _project_for_build_plan(request.user, data.get('project_id') or data.get('project'))
    if error:
        return None, Response({'detail': error, 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)

    namespace = str(data.get('namespace') or configured_namespace()).strip().strip('/')
    if not namespace:
        return None, Response({'detail': _('Project Quay namespace is required.'), 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)

    image_name, error = _validate_image_name(data.get('image_name') or data.get('repository') or 'custom-ee')
    if error:
        return None, Response({'detail': error, 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)
    image_tag, error = _validate_image_tag(data.get('tag') or data.get('image_tag') or 'latest')
    if error:
        return None, Response({'detail': error, 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)

    runtime = str(data.get('runtime') or 'podman').strip().lower()
    if runtime not in QUAY_CONTAINER_RUNTIMES:
        return None, Response(
            {'detail': _('Container runtime must be podman or docker.'), 'status': 'bad_request'},
            status=http_status.HTTP_400_BAD_REQUEST,
        )

    definition_file, error = _validate_relative_cli_path(
        data.get('definition_file') or data.get('definition'), 'execution-environment.yml', _('Definition file')
    )
    if error:
        return None, Response({'detail': error, 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)
    context_path, error = _validate_relative_cli_path(data.get('context') or data.get('context_path'), '.', _('Build context'))
    if error:
        return None, Response({'detail': error, 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)
    project_source, error = _resolve_project_build_source(project, definition_file, context_path)
    if error:
        return None, Response({'detail': error, 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)

    client = QuayClient()
    registry = client.registry
    if not registry:
        return None, Response(
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
        login_command = f'echo \"$QUAY_TOKEN\" | {runtime} login --tls-verify=false {shlex.quote(registry)} --username {shlex.quote(username)} --password-stdin'
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
                            '-c',
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
    return response, None


def _serialize_quay_image_build(build, include_log=True):
    return {
        'id': build.id,
        'type': 'quay_image_build',
        'url': build.get_absolute_url(),
        'created': build.created,
        'modified': build.modified,
        'created_by': build.created_by.username if build.created_by_id else '',
        'project': {
            'id': build.project_id,
            'name': build.project_name,
            'path': build.project_path,
            'scm_revision': build.scm_revision,
        },
        'namespace': build.namespace,
        'repository': build.repository,
        'repository_path': build.repository_path,
        'tag': build.tag,
        'image': build.image,
        'registry': build.registry,
        'runtime': build.runtime,
        'definition_file': build.definition_file,
        'context': build.context_path,
        'status': build.status,
        'progress': build.progress,
        'started': build.started,
        'finished': build.finished,
        'error': build.error,
        'log': build.log if include_log else '',
        'command_summary': build.command_summary or [],
        'template': {
            'id': build.template_id,
            'name': build.template.name if build.template_id and build.template else '',
        },
        'unified_job': {
            'id': build.unified_job_id,
            'url': build.unified_job.get_absolute_url() if build.unified_job_id and build.unified_job else '',
        },
    }


def _build_image_from_template(template):
    registry = QuayClient().registry
    if registry:
        return f'{registry}/{template.repository_path}:{template.tag}'
    return f'{template.repository_path}:{template.tag}'


def _serialize_quay_image_build_template(template):
    latest_build = getattr(template, 'latest_build', None)
    return {
        'id': template.id,
        'type': 'quay_image_build_template',
        'url': template.get_absolute_url(),
        'launch_url': reverse('api:quay_image_build_template_launch', kwargs={'pk': template.pk}),
        'created': template.created,
        'modified': template.modified,
        'created_by': template.created_by.username if template.created_by_id else '',
        'name': template.name,
        'description': template.description,
        'project': {
            'id': template.project_id,
            'name': template.project.name if template.project_id and template.project else '',
            'organization': {
                'id': template.project.organization_id,
                'name': template.project.organization.name,
            }
            if template.project_id and template.project and template.project.organization_id
            else None,
        },
        'namespace': template.namespace,
        'repository': template.repository,
        'repository_path': template.repository_path,
        'tag': template.tag,
        'image': _build_image_from_template(template),
        'runtime': template.runtime,
        'definition_file': template.definition_file,
        'context': template.context_path,
        'latest_build': _serialize_quay_image_build(latest_build, include_log=False) if latest_build else None,
    }


def _create_quay_image_build_from_plan(plan, runtime, template=None, unified_job=None):
    project_data = plan['project']
    image_data = plan['image']
    registry_data = plan['registry']
    return QuayImageBuild.objects.create(
        template=template,
        unified_job=unified_job,
        project_id=project_data['project_id'],
        project_name=project_data['project_name'],
        project_path=project_data['project_path'],
        scm_revision=project_data['scm_revision'],
        namespace=registry_data['namespace'],
        repository=image_data['repository'],
        tag=image_data['tag'],
        image=image_data['awx'],
        registry=registry_data['registry'],
        runtime=runtime,
        definition_file=project_data['definition_file'],
        context_path=project_data['context'],
        command_summary=[{**command, 'label': str(command.get('label') or '')} for command in plan['commands']],
    )


def _apply_quay_image_build_plan_to_job(job, plan, runtime):
    project_data = plan['project']
    image_data = plan['image']
    registry_data = plan['registry']
    job.project_id = project_data['project_id']
    job.namespace = registry_data['namespace']
    job.repository = image_data['repository']
    job.tag = image_data['tag']
    job.image = image_data['awx']
    job.registry = registry_data['registry']
    job.runtime = runtime
    job.definition_file = project_data['definition_file']
    job.context_path = project_data['context']
    job.scm_revision = project_data['scm_revision']
    job.command_summary = [{**command, 'label': str(command.get('label') or '')} for command in plan['commands']]
    job.save(
        update_fields=[
            'project',
            'namespace',
            'repository',
            'tag',
            'image',
            'registry',
            'runtime',
            'definition_file',
            'context_path',
            'scm_revision',
            'command_summary',
        ]
    )
    return job


def _template_payload_from_plan(data, plan):
    project_data = plan['project']
    image_data = plan['image']
    registry_data = plan['registry']
    return {
        'project_id': project_data['project_id'],
        'namespace': registry_data['namespace'],
        'repository': image_data['repository'],
        'tag': image_data['tag'],
        'runtime': str(data.get('runtime') or 'podman').strip().lower(),
        'definition_file': project_data['definition_file'],
        'context_path': project_data['context'],
    }


def _data_from_template(template):
    return {
        'project_id': template.project_id,
        'namespace': template.namespace,
        'repository': template.repository,
        'tag': template.tag,
        'runtime': template.runtime,
        'definition_file': template.definition_file,
        'context': template.context_path,
    }


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
        plan, error_response = _quay_image_build_plan_for_request(request)
        if error_response:
            return error_response
        return Response(plan)


class QuayExecutionEnvironmentImageBuildTemplatesView(APIView):
    name = _('Project Quay Execution Environment Image Build Templates')
    resource_purpose = 'saved project quay execution environment image build templates'
    permission_classes = (IsAuthenticated,)

    def get(self, request, format=None):
        page = _parse_positive_int(request.query_params.get('page'), 1)
        page_size = _parse_positive_int(request.query_params.get('page_size'), 20, maximum=100)
        queryset = request.user.get_queryset(QuayImageBuildTemplate).select_related('project__organization', 'created_by').all()
        namespace = str(request.query_params.get('namespace') or '').strip().strip('/')
        repository = str(request.query_params.get('repository') or '').strip().strip('/')
        search = str(request.query_params.get('search') or '').strip()
        if namespace:
            queryset = queryset.filter(namespace=namespace)
        if repository:
            queryset = queryset.filter(repository=repository)
        if search:
            queryset = queryset.filter(
                Q(name__icontains=search)
                | Q(description__icontains=search)
                | Q(namespace__icontains=search)
                | Q(repository__icontains=search)
                | Q(project__name__icontains=search)
            )
        order_by = str(request.query_params.get('order_by') or 'name').strip()
        descending = order_by.startswith('-')
        order_key = order_by[1:] if descending else order_by
        allowed_order_fields = {
            'name': 'name',
            'namespace': 'namespace',
            'repository': 'repository',
            'modified': 'modified',
            'created': 'created',
            'project': 'project__name',
            'project__name': 'project__name',
        }
        order_field = allowed_order_fields.get(order_key, 'name')
        queryset = queryset.order_by(f'-{order_field}' if descending else order_field, 'id')
        count = queryset.count()
        offset = (page - 1) * page_size
        items = list(queryset[offset : offset + page_size])
        latest_builds = {}
        for build in (
            QuayImageBuild.objects.select_related('template', 'project', 'created_by')
            .filter(template_id__in=[template.id for template in items])
            .order_by('template_id', '-created', '-id')
        ):
            latest_builds.setdefault(build.template_id, build)
        for template in items:
            template.latest_build = latest_builds.get(template.id)
        return Response(
            {
                'count': count,
                'next': None,
                'previous': None,
                'source': 'quay',
                'resource': 'image_build_templates',
                'results': [_serialize_quay_image_build_template(template) for template in items],
            }
        )

    def post(self, request, format=None):
        data = request.data if isinstance(request.data, dict) else {}
        name = str(data.get('name') or '').strip()
        if not name:
            return Response({'detail': _('Name is required.'), 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)
        plan, error_response = _quay_image_build_plan_from_data(request, data)
        if error_response:
            return error_response
        template_data = _template_payload_from_plan(data, plan)
        access_data = {'project': template_data['project_id']}
        if not request.user.can_access(QuayImageBuildTemplate, 'add', access_data):
            raise PermissionDenied()
        try:
            template = QuayImageBuildTemplate.objects.create(
                name=name,
                description=str(data.get('description') or ''),
                project_id=template_data['project_id'],
                namespace=template_data['namespace'],
                repository=template_data['repository'],
                tag=template_data['tag'],
                runtime=template_data['runtime'],
                definition_file=template_data['definition_file'],
                context_path=template_data['context_path'],
            )
        except IntegrityError:
            return Response(
                {'detail': _('A Project Quay image build template with this name already exists.'), 'status': 'bad_request'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        return Response(_serialize_quay_image_build_template(template), status=http_status.HTTP_201_CREATED)


class QuayExecutionEnvironmentImageBuildTemplateDetailView(APIView):
    name = _('Project Quay Execution Environment Image Build Template Detail')
    resource_purpose = 'saved project quay execution environment image build template detail'
    permission_classes = (IsAuthenticated,)

    def get_object(self, request, pk):
        return request.user.get_queryset(QuayImageBuildTemplate).select_related('project__organization', 'created_by').filter(pk=pk).first()

    def get(self, request, pk, format=None):
        template = self.get_object(request, pk)
        if template is None:
            return Response({'detail': _('Project Quay image build template was not found.'), 'status': 'not_found'}, status=http_status.HTTP_404_NOT_FOUND)
        template.latest_build = (
            QuayImageBuild.objects.select_related('template', 'project', 'created_by').filter(template=template).order_by('-created', '-id').first()
        )
        return Response(_serialize_quay_image_build_template(template))

    def patch(self, request, pk, format=None):
        template = self.get_object(request, pk)
        if template is None:
            return Response({'detail': _('Project Quay image build template was not found.'), 'status': 'not_found'}, status=http_status.HTTP_404_NOT_FOUND)
        if not request.user.can_access(QuayImageBuildTemplate, 'change', template, request.data):
            raise PermissionDenied()
        data = request.data if isinstance(request.data, dict) else {}
        merged = _data_from_template(template)
        merged.update(data)
        plan, error_response = _quay_image_build_plan_from_data(request, merged)
        if error_response:
            return error_response
        name = str(data.get('name') if 'name' in data else template.name).strip()
        if not name:
            return Response({'detail': _('Name is required.'), 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)
        template_data = _template_payload_from_plan(merged, plan)
        template.name = name
        if 'description' in data:
            template.description = str(data.get('description') or '')
        template.project_id = template_data['project_id']
        template.namespace = template_data['namespace']
        template.repository = template_data['repository']
        template.tag = template_data['tag']
        template.runtime = template_data['runtime']
        template.definition_file = template_data['definition_file']
        template.context_path = template_data['context_path']
        try:
            template.save()
        except IntegrityError:
            return Response(
                {'detail': _('A Project Quay image build template with this name already exists.'), 'status': 'bad_request'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        return Response(_serialize_quay_image_build_template(template))

    def delete(self, request, pk, format=None):
        template = self.get_object(request, pk)
        if template is None:
            return Response({'detail': _('Project Quay image build template was not found.'), 'status': 'not_found'}, status=http_status.HTTP_404_NOT_FOUND)
        if not request.user.can_access(QuayImageBuildTemplate, 'delete', template):
            raise PermissionDenied()
        template.delete()
        return Response(status=http_status.HTTP_204_NO_CONTENT)


class QuayExecutionEnvironmentImageBuildTemplateLaunchView(APIView):
    name = _('Project Quay Execution Environment Image Build Template Launch')
    resource_purpose = 'launch saved project quay execution environment image build template'
    permission_classes = (IsAuthenticated,)

    def post(self, request, pk, format=None):
        template = request.user.get_queryset(QuayImageBuildTemplate).select_related('project').filter(pk=pk).first()
        if template is None:
            return Response({'detail': _('Project Quay image build template was not found.'), 'status': 'not_found'}, status=http_status.HTTP_404_NOT_FOUND)
        if not request.user.can_access(QuayImageBuildTemplate, 'start', template):
            raise PermissionDenied()
        if template.project_id is None:
            return Response(
                {'detail': _('Project Quay image build template no longer has an AWX Project.'), 'status': 'bad_request'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        plan, error_response = _quay_image_build_plan_from_data(request, _data_from_template(template))
        if error_response:
            return error_response
        if not plan['registry']['push_username_configured'] or not plan['registry']['push_token_configured']:
            return Response(
                {'detail': _('Project Quay push credentials are required before AWX can launch an image build.'), 'status': 'bad_request'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        job = template.create_quay_image_build_job()
        _apply_quay_image_build_plan_to_job(job, plan, template.runtime)
        build = _create_quay_image_build_from_plan(plan, template.runtime, template=template, unified_job=job)
        job.signal_start()
        headers = {'Location': job.get_absolute_url(request)}
        return Response(_serialize_quay_image_build(build), status=http_status.HTTP_202_ACCEPTED, headers=headers)


class QuayImageBuildTemplateJobsList(SubListAPIView):
    model = models.QuayImageBuildJob
    serializer_class = serializers.QuayImageBuildJobListSerializer
    parent_model = models.QuayImageBuildTemplate
    relationship = 'jobs'
    parent_key = 'quay_image_build_template'
    resource_purpose = 'Project Quay image build jobs of an execution environment build template'


class QuayImageBuildTemplateSchedulesList(SubListCreateAPIView):
    name = _('Project Quay Image Build Template Schedules')
    model = models.Schedule
    serializer_class = serializers.ScheduleSerializer
    parent_model = models.QuayImageBuildTemplate
    relationship = 'schedules'
    parent_key = 'unified_job_template'
    resource_purpose = 'schedules of a Project Quay image build template'


class QuayImageBuildTemplateNotificationTemplatesAnyList(SubListCreateAttachDetachAPIView):
    model = models.NotificationTemplate
    serializer_class = serializers.NotificationTemplateSerializer
    parent_model = models.QuayImageBuildTemplate
    resource_purpose = 'base view for notification templates of a Project Quay image build template'


class QuayImageBuildTemplateNotificationTemplatesStartedList(QuayImageBuildTemplateNotificationTemplatesAnyList):
    relationship = 'notification_templates_started'
    resource_purpose = 'notification templates triggered on Project Quay image build start'


class QuayImageBuildTemplateNotificationTemplatesErrorList(QuayImageBuildTemplateNotificationTemplatesAnyList):
    relationship = 'notification_templates_error'
    resource_purpose = 'notification templates triggered on Project Quay image build error'


class QuayImageBuildTemplateNotificationTemplatesSuccessList(QuayImageBuildTemplateNotificationTemplatesAnyList):
    relationship = 'notification_templates_success'
    resource_purpose = 'notification templates triggered on Project Quay image build success'


class QuayImageBuildTemplateObjectRolesList(SubListAPIView):
    deprecated = True
    model = models.Role
    serializer_class = serializers.RoleSerializer
    parent_model = models.QuayImageBuildTemplate
    search_fields = ('role_field', 'content_type__model')
    resource_purpose = 'roles of a Project Quay image build template'

    def get_queryset(self):
        template = self.get_parent_object()
        content_type = ContentType.objects.get_for_model(self.parent_model)
        return models.Role.objects.filter(content_type=content_type, object_id=template.pk)


class QuayImageBuildJobList(ListAPIView):
    model = models.QuayImageBuildJob
    serializer_class = serializers.QuayImageBuildJobListSerializer
    resource_purpose = 'Project Quay image build jobs'


class QuayImageBuildJobDetail(RetrieveDestroyAPIView):
    model = models.QuayImageBuildJob
    serializer_class = serializers.QuayImageBuildJobSerializer
    resource_purpose = 'Project Quay image build job detail'


class QuayImageBuildJobCancel(GenericCancelView):
    model = models.QuayImageBuildJob
    serializer_class = serializers.QuayImageBuildJobCancelSerializer
    resource_purpose = 'cancel a Project Quay image build job'


class QuayExecutionEnvironmentImageBuildsView(APIView):
    name = _('Project Quay Execution Environment Image Builds')
    resource_purpose = 'project quay execution environment image build runs'
    permission_classes = (IsAuthenticated, QuayManagePermission)

    def get(self, request, format=None):
        page = _parse_positive_int(request.query_params.get('page'), 1)
        page_size = _parse_positive_int(request.query_params.get('page_size'), 20, maximum=100)
        queryset = QuayImageBuild.objects.select_related('project', 'created_by', 'template').all()
        namespace = str(request.query_params.get('namespace') or '').strip().strip('/')
        repository = str(request.query_params.get('repository') or '').strip().strip('/')
        template_id = str(request.query_params.get('template') or '').strip()
        if namespace:
            queryset = queryset.filter(namespace=namespace)
        if repository:
            queryset = queryset.filter(repository=repository)
        if template_id:
            queryset = queryset.filter(template_id=template_id)
        count = queryset.count()
        offset = (page - 1) * page_size
        items = queryset[offset : offset + page_size]
        return Response(
            {
                'count': count,
                'next': None,
                'previous': None,
                'source': 'quay',
                'resource': 'image_builds',
                'results': [_serialize_quay_image_build(build, include_log=False) for build in items],
            }
        )

    def post(self, request, format=None):
        plan, error_response = _quay_image_build_plan_for_request(request)
        if error_response:
            return error_response
        if not plan['registry']['push_username_configured'] or not plan['registry']['push_token_configured']:
            return Response(
                {'detail': _('Project Quay push credentials are required before AWX can launch an image build.'), 'status': 'bad_request'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        build = _create_quay_image_build_from_plan(plan, str((request.data or {}).get('runtime') or 'podman').strip().lower())
        transaction.on_commit(lambda: run_quay_image_build.delay(build.id))
        return Response(_serialize_quay_image_build(build), status=http_status.HTTP_202_ACCEPTED)


class QuayExecutionEnvironmentImageBuildDetailView(APIView):
    name = _('Project Quay Execution Environment Image Build Detail')
    resource_purpose = 'project quay execution environment image build run detail'
    permission_classes = (IsAuthenticated, QuayManagePermission)

    def get(self, request, pk, format=None):
        build = QuayImageBuild.objects.select_related('project', 'created_by', 'template').filter(pk=pk).first()
        if build is None:
            return Response({'detail': _('Project Quay image build was not found.'), 'status': 'not_found'}, status=http_status.HTTP_404_NOT_FOUND)
        return Response(_serialize_quay_image_build(build))
