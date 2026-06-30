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

    def post(self, path, json=None):
        return self.request('POST', path, json=json or {})

    def put(self, path, json=None):
        return self.request('PUT', path, json=json or {})

    def delete(self, path):
        return self.request('DELETE', path)

    def repositories(self, namespace=None, params=None):
        namespace = namespace or self.namespace
        if not namespace:
            raise QuayControllerError('Project Quay namespace is not configured.', status='not_configured')
        return self.get('/api/v1/repository', params={'namespace': namespace, **(params or {})})

    def create_repository(self, repository, namespace=None, visibility='private', description='', repo_kind='image'):
        namespace = namespace or self.namespace
        if not namespace:
            raise QuayControllerError('Project Quay namespace is not configured.', status='not_configured')
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
        namespace = namespace or self.namespace
        if not namespace:
            raise QuayControllerError('Project Quay namespace is not configured.', status='not_configured')
        return self.put(f'/api/v1/repository/{namespace}/{repository}', json={'description': description})

    def change_repository_visibility(self, repository, namespace=None, visibility='private'):
        namespace = namespace or self.namespace
        if not namespace:
            raise QuayControllerError('Project Quay namespace is not configured.', status='not_configured')
        return self.post(f'/api/v1/repository/{namespace}/{repository}/changevisibility', json={'visibility': visibility})

    def delete_repository(self, repository, namespace=None):
        namespace = namespace or self.namespace
        if not namespace:
            raise QuayControllerError('Project Quay namespace is not configured.', status='not_configured')
        return self.delete(f'/api/v1/repository/{namespace}/{repository}')

    def tags(self, repository, namespace=None, params=None):
        namespace = namespace or self.namespace
        if not namespace:
            raise QuayControllerError('Project Quay namespace is not configured.', status='not_configured')
        repository = (repository or '').strip().strip('/')
        if not repository:
            raise QuayControllerError('Project Quay repository is required.', status='bad_request')
        return self.get(f'/api/v1/repository/{namespace}/{repository}/tag/', params=params or {})


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
