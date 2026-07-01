# Copyright (c) 2026 Red Hat, Inc.
# All Rights Reserved.

import hashlib
import re
import shlex
from pathlib import Path, PurePosixPath
from urllib.parse import quote, urlparse

import yaml
from django.core.cache import cache
from django.utils.translation import gettext_lazy as _
from rest_framework.permissions import IsAuthenticated
from rest_framework import status as http_status
from rest_framework.response import Response

from awx.api.generics import APIView
from awx.api.versioning import reverse
from awx.api.views.content_permissions import (
    AutomationHubAdminPermission,
    AutomationHubManagePermission,
    AutomationHubViewPermission,
)
from awx.main.models import Project
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
    'remotes': 'pulp/api/v3/remotes/ansible/collection/',
    'remote-registries': '_ui/v1/execution-environments/registries/',
    'signature-keys': 'pulp/api/v3/signing-services/',
    'collection-approvals': '_ui/v1/collection-versions/',
    'tasks': 'pulp/api/v3/tasks/',
    'execution-environment-images': 'pulp/api/v3/content/container/tags/',
}

GALAXY_NG_DISTRIBUTION_PATH_CHARS = set('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.-')
GALAXY_NG_COLLECTION_TOKEN_RE = re.compile(r'^[A-Za-z0-9_]+$')
GALAXY_NG_COLLECTION_VERSION_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.+-]{0,127}$')
GALAXY_NG_IMAGE_NAME_RE = re.compile(r'^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$')
GALAXY_NG_IMAGE_TAG_RE = re.compile(r'^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$')
GALAXY_NG_CONTAINER_RUNTIMES = ('podman', 'docker')
GALAXY_NG_STATUS_CACHE_TIMEOUT = 15


def _galaxy_ng_status_cache_key(client, server_url):
    fingerprint = '|'.join(
        [
            server_url or '',
            client.api_path_prefix or '',
            client.content_path_prefix or '',
            str(client.verify_ssl),
            str(client.timeout),
            str(client.auth_configured),
        ]
    )
    return f'awx:galaxy-ng:status:{hashlib.sha256(fingerprint.encode()).hexdigest()}'


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


def _validate_collection_token(value, field_name):
    value = str(value or '').strip()
    if not value:
        return '', _('%s is required.') % field_name
    if len(value) > 128:
        return '', _('%s is too long.') % field_name
    if not GALAXY_NG_COLLECTION_TOKEN_RE.match(value):
        return '', _('%s may contain only letters, numbers, and underscores.') % field_name
    return value, ''


def _validate_collection_version(value):
    value = str(value or '').strip()
    if not value:
        return '', _('Version is required.')
    if not GALAXY_NG_COLLECTION_VERSION_RE.match(value):
        return '', _('Version may contain only letters, numbers, dots, underscores, hyphens, and plus signs.')
    return value, ''


def _validate_image_name(value):
    value = str(value or '').strip()
    if not value:
        return '', _('Image name is required.')
    if len(value) > 255:
        return '', _('Image name is too long.')
    if '..' in value or '//' in value or value.startswith('/') or value.endswith('/'):
        return '', _('Image name is invalid.')
    if not GALAXY_NG_IMAGE_NAME_RE.match(value):
        return '', _('Image name may contain lowercase letters, numbers, dots, underscores, hyphens, and slashes.')
    return value, ''


def _validate_image_tag(value):
    value = str(value or '').strip() or 'latest'
    if not GALAXY_NG_IMAGE_TAG_RE.match(value):
        return '', _('Image tag may contain letters, numbers, underscores, dots, and hyphens.')
    return value, ''


def _validate_relative_cli_path(value, default, field_name):
    value = str(value or '').strip() or default
    value = value.replace('\\', '/')
    while value.startswith('./'):
        value = value[2:]
    if '\x00' in value or '\n' in value or '\r' in value:
        return '', _('%s contains invalid characters.') % field_name
    if value.startswith('-'):
        return '', _('%s cannot start with a dash.') % field_name
    pure_path = PurePosixPath(value)
    if pure_path.is_absolute() or '..' in pure_path.parts:
        return '', _('%s must be relative to the selected AWX project and cannot include parent directory traversal.') % field_name
    if any(part.startswith('.') and part not in ('.',) for part in pure_path.parts):
        return '', _('%s cannot include hidden files or directories.') % field_name
    return value, ''


def _project_for_build_plan(user, project_id):
    try:
        project_id = int(project_id)
    except (TypeError, ValueError):
        return None, _('AWX Project is required.')
    project = Project.accessible_objects(user, 'read_role').filter(pk=project_id).first()
    if project is None:
        return None, _('AWX Project was not found or you do not have access to it.')
    project_path = project.get_project_path()
    if not project_path:
        return None, _('AWX Project has not been synced to a local checkout yet.')
    return project, ''


def _resolve_project_build_source(project, definition_file, context_path):
    try:
        root = Path(project.get_project_path()).resolve(strict=True)
    except OSError as exc:
        return None, _('Could not read AWX Project checkout: %(error)s') % {'error': exc}

    definition_path = (root / definition_file).resolve(strict=False)
    context = (root / context_path).resolve(strict=False)
    try:
        definition_path.relative_to(root)
        context.relative_to(root)
    except ValueError:
        return None, _('Execution environment build paths must stay inside the selected AWX Project checkout.')
    try:
        if not definition_path.is_file():
            return None, _('Definition file was not found in the selected AWX Project.')
        if not context.is_dir():
            return None, _('Build context was not found in the selected AWX Project.')
    except OSError as exc:
        return None, _('Could not inspect AWX Project build paths: %(error)s') % {'error': exc}

    return {
        'project_id': project.pk,
        'project_name': project.name,
        'scm_type': project.scm_type or '',
        'scm_url': project.scm_url or '',
        'scm_branch': project.scm_branch or '',
        'scm_revision': project.scm_revision or '',
        'local_path': project.local_path or '',
        'project_path': str(root),
        'definition_file': definition_file,
        'context': context_path,
    }, ''


def _resolve_project_collection_source(project, collection_path, artifact_dir):
    try:
        root = Path(project.get_project_path()).resolve(strict=True)
    except OSError as exc:
        return None, _('Could not read AWX Project checkout: %(error)s') % {'error': exc}

    collection_root = (root / collection_path).resolve(strict=False)
    output_path = (collection_root / artifact_dir).resolve(strict=False)
    try:
        collection_root.relative_to(root)
        output_path.relative_to(root)
    except ValueError:
        return None, _('Collection source and artifact paths must stay inside the selected AWX Project checkout.')
    try:
        if not collection_root.is_dir():
            return None, _('Collection path was not found in the selected AWX Project.')
        galaxy_yml = collection_root / 'galaxy.yml'
        if not galaxy_yml.is_file():
            return None, _('Collection path must contain galaxy.yml.')
        metadata = yaml.safe_load(galaxy_yml.read_text(encoding='utf-8')) or {}
    except (OSError, yaml.YAMLError) as exc:
        return None, _('Could not inspect collection source: %(error)s') % {'error': exc}
    if not isinstance(metadata, dict):
        return None, _('galaxy.yml must be a YAML mapping.')

    namespace, error = _validate_collection_token(metadata.get('namespace'), _('Namespace'))
    if error:
        return None, error
    name, error = _validate_collection_token(metadata.get('name'), _('Collection name'))
    if error:
        return None, error
    version, error = _validate_collection_version(metadata.get('version'))
    if error:
        return None, error

    artifact_name = f'{namespace}-{name}-{version}.tar.gz'
    artifact_path = output_path / artifact_name
    return {
        'project_id': project.pk,
        'project_name': project.name,
        'scm_type': project.scm_type or '',
        'scm_url': project.scm_url or '',
        'scm_branch': project.scm_branch or '',
        'scm_revision': project.scm_revision or '',
        'local_path': project.local_path or '',
        'project_path': str(root),
        'collection_path': collection_path,
        'collection_root': str(collection_root),
        'galaxy_yml': str(galaxy_yml),
        'artifact_dir': artifact_dir,
        'artifact_path': str(artifact_path),
        'metadata': {
            'namespace': namespace,
            'name': name,
            'version': version,
            'description': metadata.get('description') or '',
        },
    }, ''


def _galaxy_registry_hosts(server_url):
    parsed = urlparse(server_url)
    host = parsed.hostname or ''
    if not host:
        return '', ''
    if ':' in host and not host.startswith('['):
        host = f'[{host}]'
    registry_host = f'{host}:{parsed.port}' if parsed.port else host
    local_host = registry_host
    if parsed.hostname == 'host.docker.internal':
        local_host = f'localhost:{parsed.port}' if parsed.port else 'localhost'
    return registry_host, local_host


class GalaxyNGStatusView(APIView):
    name = _('Galaxy NG Status')
    resource_purpose = 'galaxy ng private automation hub status'
    permission_classes = (IsAuthenticated, AutomationHubViewPermission)

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
        api_path_prefix = f'{client.api_path_prefix.rstrip("/")}/'
        api_root_url = f'{server_url}{api_path_prefix}' if server_url else ''
        response = {
            'enabled': module_enabled(),
            'configured': status == 'configured',
            'status': status,
            'server_url': server_url,
            'api_root_url': api_root_url,
            'api_browser_url': f'{api_root_url}v3/swagger-ui/' if api_root_url else '',
            'content_url': f'{server_url}{client.content_path_prefix}' if server_url else '',
            'ui_url': f'{server_url}/ui/' if server_url else '',
            'auth_configured': client.auth_configured,
            'verify_ssl': client.verify_ssl,
            'request_timeout': client.timeout,
            'api_path_prefix': client.api_path_prefix,
            'content_path_prefix': client.content_path_prefix,
            'settings_url': reverse('api:setting_singleton_detail', kwargs={'category_slug': 'galaxy-ng'}, request=request),
            'message': messages.get(status, _('Galaxy NG server URL is not configured.')),
            'counts': {
                'namespaces': 0,
                'collections': 0,
                'repositories': 0,
                'remotes': 0,
                'remote_registries': 0,
                'signature_keys': 0,
                'collection_approvals': 0,
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
            'remotes': f'{api_prefix}/pulp/api/v3/remotes/ansible/collection/',
            'remote_registries': f'{api_prefix}/_ui/v1/execution-environments/registries/',
            'signature_keys': f'{api_prefix}/pulp/api/v3/signing-services/',
            'collection_approvals': f'{api_prefix}/_ui/v1/collection-versions/',
            'tasks': f'{api_prefix}/pulp/api/v3/tasks/',
        }
        cache_key = _galaxy_ng_status_cache_key(client, server_url)
        live_status = None if request.query_params.get('refresh') else cache.get(cache_key)
        if live_status is None:
            live_status = {
                'counts': {
                    'namespaces': 0,
                    'collections': 0,
                    'repositories': 0,
                    'remotes': 0,
                    'remote_registries': 0,
                    'signature_keys': 0,
                    'collection_approvals': 0,
                    'tasks': 0,
                },
                'pulp_status': {},
                'controller_error': '',
            }
            try:
                live_status['pulp_status'] = client.pulp_status()
                for key, path in count_paths.items():
                    try:
                        params = {'repository': 'staging'} if key == 'collection_approvals' else None
                        live_status['counts'][key] = client.count(path, params=params)
                    except GalaxyNGControllerError as exc:
                        live_status['controller_error'] = str(exc)
            except GalaxyNGControllerError as exc:
                live_status['controller_error'] = str(exc)
            cache.set(cache_key, live_status, GALAXY_NG_STATUS_CACHE_TIMEOUT)

        response['counts'].update(live_status.get('counts') or {})
        response['pulp_status'] = live_status.get('pulp_status') or {}
        response['controller_error'] = live_status.get('controller_error') or ''

        return Response(response)


class GalaxyNGResourceListView(APIView):
    name = _('Galaxy NG Resources')
    resource_purpose = 'galaxy ng private automation hub resources'
    permission_classes = (IsAuthenticated, AutomationHubViewPermission)
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
        params = _galaxy_list_params(request, page, page_size)
        if self.resource == 'collection-approvals':
            params.setdefault('repository', 'staging')
        try:
            payload = client.get(
                self.get_resource_path(client),
                params=params,
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


class GalaxyNGRemotesListView(GalaxyNGResourceListView):
    name = _('Galaxy NG Remotes')
    resource = 'remotes'


class GalaxyNGRemoteRegistriesListView(GalaxyNGResourceListView):
    name = _('Galaxy NG Remote Registries')
    resource = 'remote-registries'


class GalaxyNGSignatureKeysListView(GalaxyNGResourceListView):
    name = _('Galaxy NG Signature Keys')
    resource = 'signature-keys'


class GalaxyNGCollectionApprovalsListView(GalaxyNGResourceListView):
    name = _('Galaxy NG Collection Approvals')
    permission_classes = (IsAuthenticated, AutomationHubAdminPermission)
    resource = 'collection-approvals'


class GalaxyNGCollectionApprovalActionView(APIView):
    name = _('Galaxy NG Collection Approval Action')
    resource_purpose = 'galaxy ng private automation hub collection approval action'
    permission_classes = (IsAuthenticated, AutomationHubAdminPermission)

    action = ''

    def post(self, request, format=None):
        if not request.user.is_superuser:
            return Response(
                {'detail': _('You do not have permission to approve or reject Galaxy NG collections.')},
                status=http_status.HTTP_403_FORBIDDEN,
            )
        if self.action not in ('approve', 'reject'):
            return Response({'detail': _('Unsupported Galaxy NG approval action.'), 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)
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
        namespace, error = _validate_collection_token(data.get('namespace'), _('Namespace'))
        if error:
            return Response({'detail': error, 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)
        name, error = _validate_collection_token(data.get('name'), _('Collection name'))
        if error:
            return Response({'detail': error, 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)
        version, error = _validate_collection_version(data.get('version'))
        if error:
            return Response({'detail': error, 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)

        source = 'staging'
        destination = 'published' if self.action == 'approve' else 'rejected'
        client = GalaxyNGClient()
        api_prefix = client.api_path_prefix.rstrip('/')
        move_path = (
            f'{api_prefix}/v3/collections/{quote(namespace, safe="")}/{quote(name, safe="")}/versions/'
            f'{quote(version, safe="")}/move/{source}/{destination}/'
        )
        try:
            payload = client.post(move_path)
        except GalaxyNGControllerError as exc:
            return _galaxy_ng_error_response(exc)

        task = payload.get('copy_task_id') or payload.get('task') or payload.get('task_id') if isinstance(payload, dict) else None
        remove_task = payload.get('remove_task_id') if isinstance(payload, dict) else None
        return Response(
            {
                'source': 'galaxy_ng',
                'action': self.action,
                'namespace': namespace,
                'name': name,
                'version': version,
                'source_repository': source,
                'destination_repository': destination,
                'task': task,
                'remove_task': remove_task,
                'response': payload,
            },
            status=http_status.HTTP_202_ACCEPTED,
        )


class GalaxyNGCollectionApprovalApproveView(GalaxyNGCollectionApprovalActionView):
    name = _('Approve Galaxy NG Collection')
    action = 'approve'


class GalaxyNGCollectionApprovalRejectView(GalaxyNGCollectionApprovalActionView):
    name = _('Reject Galaxy NG Collection')
    action = 'reject'


class GalaxyNGTasksListView(GalaxyNGResourceListView):
    name = _('Galaxy NG Tasks')
    permission_classes = (IsAuthenticated, AutomationHubAdminPermission)
    resource = 'tasks'


class GalaxyNGExecutionEnvironmentImagesListView(GalaxyNGResourceListView):
    name = _('Galaxy NG Execution Environment Images')
    permission_classes = (IsAuthenticated, AutomationHubViewPermission)
    resource = 'execution-environment-images'

    def get(self, request, format=None):
        return Response(
            {
                **_empty_resource_response(
                    self.resource,
                    'quay',
                    _('Execution environment images are managed through the Project Quay module.'),
                ),
                'quay_build_plan_url': reverse('api:quay_execution_environment_image_build_plan', request=request),
                'quay_repositories_url': reverse('api:quay_repositories_list', request=request),
            },
            status=http_status.HTTP_410_GONE,
        )


class GalaxyNGExecutionEnvironmentImageBuildPlanView(APIView):
    name = _('Galaxy NG Execution Environment Image Build Plan')
    resource_purpose = 'galaxy ng execution environment image build and push command plan'
    permission_classes = (IsAuthenticated, AutomationHubViewPermission)

    def post(self, request, format=None):
        return Response(
            {
                'detail': _('Execution environment image build plans are managed through the Project Quay module.'),
                'status': 'moved_to_quay',
                'source': 'quay',
                'quay_build_plan_url': reverse('api:quay_execution_environment_image_build_plan', request=request),
            },
            status=http_status.HTTP_410_GONE,
        )


class GalaxyNGCollectionImportPlanView(APIView):
    name = _('Galaxy NG Collection Import Plan')
    resource_purpose = 'galaxy ng project-backed collection build and publish command plan'
    permission_classes = (IsAuthenticated, AutomationHubManagePermission)

    def post(self, request, format=None):
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
        project, error = _project_for_build_plan(request.user, data.get('project_id') or data.get('project'))
        if error:
            return Response({'detail': error, 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)

        collection_path, error = _validate_relative_cli_path(data.get('collection_path'), '.', _('Collection path'))
        if error:
            return Response({'detail': error, 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)
        artifact_dir, error = _validate_relative_cli_path(data.get('artifact_dir'), 'dist', _('Artifact output path'))
        if error:
            return Response({'detail': error, 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)

        project_source, error = _resolve_project_collection_source(project, collection_path, artifact_dir)
        if error:
            return Response({'detail': error, 'status': 'bad_request'}, status=http_status.HTTP_400_BAD_REQUEST)

        client = GalaxyNGClient()
        api_root_url = client.url(client.api_path_prefix)
        ignore_certs = not client.verify_ssl or urlparse(client.server_url).scheme == 'http'
        metadata = project_source['metadata']
        collection_ref = f'{metadata["namespace"]}.{metadata["name"]}:{metadata["version"]}'
        publish_flags = ['--server', shlex.quote(api_root_url), '--api-key', '"$GALAXY_TOKEN"']
        install_flags = ['--server', shlex.quote(api_root_url)]
        if ignore_certs:
            publish_flags.append('--ignore-certs')
            install_flags.append('--ignore-certs')

        response = {
            'source': 'galaxy_ng',
            'project': project_source,
            'hub': {
                'server_url': client.server_url,
                'api_root_url': api_root_url,
                'verify_ssl': client.verify_ssl,
                'auth_configured': client.auth_configured,
            },
            'collection': {
                'namespace': metadata['namespace'],
                'name': metadata['name'],
                'version': metadata['version'],
                'fqcn': f'{metadata["namespace"]}.{metadata["name"]}',
                'reference': collection_ref,
                'artifact': project_source['artifact_path'],
            },
            'commands': [
                {
                    'label': _('Build collection artifact'),
                    'command': '%s && %s'
                    % (
                        f'cd {shlex.quote(project_source["collection_root"])}',
                        ' '.join(
                            [
                                'mkdir',
                                '-p',
                                shlex.quote(artifact_dir),
                                '&&',
                                'ansible-galaxy',
                                'collection',
                                'build',
                                '--output-path',
                                shlex.quote(artifact_dir),
                            ]
                        ),
                    ),
                    'working_directory': project_source['collection_root'],
                },
                {
                    'label': _('Publish collection to Galaxy NG'),
                    'command': ' '.join(['ansible-galaxy', 'collection', 'publish', shlex.quote(project_source['artifact_path']), *publish_flags]),
                },
                {
                    'label': _('Install from Galaxy NG'),
                    'command': ' '.join(['ansible-galaxy', 'collection', 'install', shlex.quote(collection_ref), *install_flags]),
                },
            ],
            'approval': {
                'required': 'depends_on_galaxy_ng_settings',
                'next_url': '/galaxy-ng/collection-approvals',
                'message': _('If Galaxy NG requires content approval, the uploaded collection will appear in Collection Approvals before it is published.'),
            },
            'notes': [
                _('Set GALAXY_TOKEN to a Galaxy NG token before running the generated publish command; AWX does not print stored secret values.'),
                _('The selected AWX Project must be synced before generating this plan so the collection source is available on disk.'),
                _('Execution environment images remain in Project Quay; Galaxy NG stores Ansible collection content.'),
            ],
        }
        return Response(response)


class GalaxyNGRepositorySyncView(APIView):
    name = _('Galaxy NG Repository Sync')
    resource_purpose = 'galaxy ng private automation hub repository sync'
    permission_classes = (IsAuthenticated, AutomationHubAdminPermission)

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
