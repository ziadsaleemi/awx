# Copyright (c) 2026 Red Hat, Inc.
# All Rights Reserved.

from urllib.parse import urljoin, urlparse

import requests
from django.conf import settings


def module_enabled():
    return bool(getattr(settings, 'MODULE_QUAY_ENABLED', False))


def configured_url():
    if not module_enabled():
        return ''
    return (getattr(settings, 'QUAY_REGISTRY_URL', '') or '').rstrip('/')


def configured_namespace():
    return (getattr(settings, 'QUAY_NAMESPACE', '') or '').strip().strip('/')


def connection_status(server_url=None):
    if not module_enabled():
        return 'disabled'
    server_url = configured_url() if server_url is None else (server_url or '').rstrip('/')
    if not server_url:
        return 'not_configured'
    if not (server_url.startswith('http://') or server_url.startswith('https://')):
        return 'invalid'
    return 'configured'


def registry_host(server_url=None):
    server_url = configured_url() if server_url is None else server_url
    parsed = urlparse(server_url or '')
    host = parsed.hostname or ''
    if not host:
        return ''
    if ':' in host and not host.startswith('['):
        host = f'[{host}]'
    return f'{host}:{parsed.port}' if parsed.port else host


class QuayControllerError(Exception):
    def __init__(self, message, status='error'):
        super().__init__(message)
        self.status = status


class QuayClient:
    def __init__(self):
        self.server_url = configured_url()
        self.namespace = configured_namespace()
        self.token = getattr(settings, 'QUAY_API_TOKEN', '')
        self.push_username = getattr(settings, 'QUAY_PUSH_USERNAME', '')
        self.push_token = getattr(settings, 'QUAY_PUSH_TOKEN', '')
        self.verify_ssl = bool(getattr(settings, 'QUAY_VERIFY_SSL', True))
        self.timeout = int(getattr(settings, 'QUAY_REQUEST_TIMEOUT', 10))

    @property
    def is_configured(self):
        return connection_status(self.server_url) == 'configured'

    @property
    def auth_configured(self):
        return bool(self.token)

    @property
    def push_configured(self):
        return bool(self.push_username and self.push_token)

    @property
    def registry(self):
        return registry_host(self.server_url)

    def _headers(self):
        headers = {'Accept': 'application/json'}
        if self.token:
            headers['Authorization'] = f'Bearer {self.token}'
        return headers

    def url(self, path):
        if not self.is_configured:
            raise QuayControllerError('Project Quay is not configured.', status=connection_status(self.server_url))
        return urljoin(f'{self.server_url}/', path.lstrip('/'))

    def request(self, method, path, params=None, json=None):
        transport = {
            'GET': requests.get,
            'POST': requests.post,
            'PUT': requests.put,
            'DELETE': requests.delete,
        }.get(method.upper())
        if transport is None:
            raise QuayControllerError(f'Unsupported Project Quay request method: {method}', status='bad_request')
        try:
            response = transport(
                self.url(path),
                params=params,
                json=json,
                headers=self._headers(),
                timeout=self.timeout,
                verify=self.verify_ssl,
            )
            response.raise_for_status()
            return response.json() if response.content else {}
        except requests.RequestException as exc:
            raise QuayControllerError(str(exc)) from exc
        except ValueError as exc:
            raise QuayControllerError(f'Invalid JSON response from Project Quay: {exc}') from exc

    def get(self, path, params=None):
        return self.request('GET', path, params=params)

    def user(self):
        return self.get('/api/v1/user/')

    def discovery(self):
        return self.get('/api/v1/discovery')

    def post(self, path, json=None):
        return self.request('POST', path, json=json or {})

    def put(self, path, json=None):
        return self.request('PUT', path, json=json or {})

    def delete(self, path):
        return self.request('DELETE', path)

    def _namespace_or_error(self, namespace=None):
        namespace = namespace or self.namespace
        if not namespace:
            raise QuayControllerError('Project Quay namespace is not configured.', status='not_configured')
        return namespace

    def _repository_or_error(self, repository):
        repository = (repository or '').strip().strip('/')
        if not repository:
            raise QuayControllerError('Project Quay repository is required.', status='bad_request')
        return repository

    def repositories(self, namespace=None, params=None):
        namespace = self._namespace_or_error(namespace)
        return self.get('/api/v1/repository', params={'namespace': namespace, **(params or {})})

    def create_repository(self, repository, namespace=None, visibility='private', description='', repo_kind='image'):
        namespace = self._namespace_or_error(namespace)
        return self.post(
            '/api/v1/repository',
            json={
                'namespace': namespace,
                'repository': repository,
                'visibility': visibility,
                'description': description,
                'repo_kind': repo_kind,
            },
        )

    def update_repository(self, repository, namespace=None, description=''):
        namespace = self._namespace_or_error(namespace)
        return self.put(f'/api/v1/repository/{namespace}/{repository}', json={'description': description})

    def change_repository_visibility(self, repository, namespace=None, visibility='private'):
        namespace = self._namespace_or_error(namespace)
        return self.post(f'/api/v1/repository/{namespace}/{repository}/changevisibility', json={'visibility': visibility})

    def delete_repository(self, repository, namespace=None):
        namespace = self._namespace_or_error(namespace)
        return self.delete(f'/api/v1/repository/{namespace}/{repository}')

    def tags(self, repository, namespace=None, params=None):
        namespace = self._namespace_or_error(namespace)
        repository = self._repository_or_error(repository)
        return self.get(f'/api/v1/repository/{namespace}/{repository}/tag/', params=params or {})

    def delete_tag(self, repository, tag, namespace=None):
        namespace = self._namespace_or_error(namespace)
        repository = self._repository_or_error(repository)
        tag = (tag or '').strip()
        if not tag:
            raise QuayControllerError('Project Quay tag is required.', status='bad_request')
        return self.delete(f'/api/v1/repository/{namespace}/{repository}/tag/{tag}')

    def repository_user_permissions(self, repository, namespace=None):
        namespace = self._namespace_or_error(namespace)
        repository = self._repository_or_error(repository)
        return self.get(f'/api/v1/repository/{namespace}/{repository}/permissions/user/')

    def set_repository_user_permission(self, repository, username, role, namespace=None):
        namespace = self._namespace_or_error(namespace)
        repository = self._repository_or_error(repository)
        return self.put(f'/api/v1/repository/{namespace}/{repository}/permissions/user/{username}', json={'role': role})

    def delete_repository_user_permission(self, repository, username, namespace=None):
        namespace = self._namespace_or_error(namespace)
        repository = self._repository_or_error(repository)
        return self.delete(f'/api/v1/repository/{namespace}/{repository}/permissions/user/{username}')

    def repository_team_permissions(self, repository, namespace=None):
        namespace = self._namespace_or_error(namespace)
        repository = self._repository_or_error(repository)
        return self.get(f'/api/v1/repository/{namespace}/{repository}/permissions/team/')

    def set_repository_team_permission(self, repository, teamname, role, namespace=None):
        namespace = self._namespace_or_error(namespace)
        repository = self._repository_or_error(repository)
        return self.put(f'/api/v1/repository/{namespace}/{repository}/permissions/team/{teamname}', json={'role': role})

    def delete_repository_team_permission(self, repository, teamname, namespace=None):
        namespace = self._namespace_or_error(namespace)
        repository = self._repository_or_error(repository)
        return self.delete(f'/api/v1/repository/{namespace}/{repository}/permissions/team/{teamname}')

    def robots(self, namespace_kind='user', namespace=None, params=None):
        if namespace_kind == 'organization':
            namespace = self._namespace_or_error(namespace)
            return self.get(f'/api/v1/organization/{namespace}/robots', params=params or {})
        return self.get('/api/v1/user/robots', params=params or {})

    def create_robot(self, robot, namespace_kind='user', namespace=None, description='', metadata=None):
        robot = (robot or '').strip()
        if not robot:
            raise QuayControllerError('Project Quay robot short name is required.', status='bad_request')
        payload = {'description': description}
        if metadata:
            payload['unstructured_metadata'] = metadata
        if namespace_kind == 'organization':
            namespace = self._namespace_or_error(namespace)
            return self.put(f'/api/v1/organization/{namespace}/robots/{robot}', json=payload)
        return self.put(f'/api/v1/user/robots/{robot}', json=payload)

    def delete_robot(self, robot, namespace_kind='user', namespace=None):
        robot = (robot or '').strip()
        if not robot:
            raise QuayControllerError('Project Quay robot short name is required.', status='bad_request')
        if namespace_kind == 'organization':
            namespace = self._namespace_or_error(namespace)
            return self.delete(f'/api/v1/organization/{namespace}/robots/{robot}')
        return self.delete(f'/api/v1/user/robots/{robot}')

    def regenerate_robot_token(self, robot, namespace_kind='user', namespace=None):
        robot = (robot or '').strip()
        if not robot:
            raise QuayControllerError('Project Quay robot short name is required.', status='bad_request')
        if namespace_kind == 'organization':
            namespace = self._namespace_or_error(namespace)
            return self.post(f'/api/v1/organization/{namespace}/robots/{robot}/regenerate')
        return self.post(f'/api/v1/user/robots/{robot}/regenerate')


def normalize_repository_list(payload, offset=0):
    repositories = []
    if isinstance(payload, dict):
        if isinstance(payload.get('repositories'), list):
            repositories = payload['repositories']
        elif isinstance(payload.get('results'), list):
            repositories = payload['results']
        elif payload:
            repositories = [payload]
    elif isinstance(payload, list):
        repositories = payload

    normalized = []
    for index, item in enumerate(repositories):
        normalized_item = dict(item) if isinstance(item, dict) else {'name': str(item)}
        normalized_item.setdefault('id', offset + index + 1)
        normalized_item.setdefault('_awx_key', str(normalized_item['id']))
        normalized.append(normalized_item)
    return {'count': len(normalized), 'next': None, 'previous': None, 'results': normalized}


def normalize_tag_list(payload, offset=0):
    tags = []
    if isinstance(payload, dict):
        if isinstance(payload.get('tags'), list):
            tags = payload['tags']
        elif isinstance(payload.get('results'), list):
            tags = payload['results']
        elif payload:
            tags = [payload]
    elif isinstance(payload, list):
        tags = payload

    normalized = []
    for index, item in enumerate(tags):
        normalized_item = dict(item) if isinstance(item, dict) else {'name': str(item)}
        normalized_item.setdefault('id', offset + index + 1)
        normalized_item.setdefault('_awx_key', str(normalized_item['id']))
        normalized.append(normalized_item)
    return {'count': len(normalized), 'next': None, 'previous': None, 'results': normalized}


def normalize_quay_list(payload, keys, offset=0):
    items = []
    if isinstance(payload, dict):
        found_keyed_list = False
        for key in keys:
            if isinstance(payload.get(key), list):
                items = payload[key]
                found_keyed_list = True
                break
        if not found_keyed_list and isinstance(payload.get('results'), list):
            items = payload['results']
            found_keyed_list = True
        elif not found_keyed_list and payload:
            items = [payload]
    elif isinstance(payload, list):
        items = payload

    normalized = []
    for index, item in enumerate(items):
        normalized_item = dict(item) if isinstance(item, dict) else {'name': str(item)}
        normalized_item.setdefault('id', offset + index + 1)
        normalized_item.setdefault('_awx_key', str(normalized_item['id']))
        normalized.append(normalized_item)
    return {'count': len(normalized), 'next': None, 'previous': None, 'results': normalized}
