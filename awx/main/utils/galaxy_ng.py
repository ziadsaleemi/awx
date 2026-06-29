# Copyright (c) 2026 Red Hat, Inc.
# All Rights Reserved.

import zlib
from urllib.parse import urljoin

import requests
from django.conf import settings


def module_enabled():
    return bool(getattr(settings, 'MODULE_GALAXY_NG_ENABLED', False))


def configured_url():
    if not module_enabled():
        return ''
    return (getattr(settings, 'GALAXY_NG_SERVER_URL', '') or '').rstrip('/')


def connection_status(server_url=None):
    if not module_enabled():
        return 'disabled'
    server_url = configured_url() if server_url is None else server_url
    if not server_url:
        return 'not_configured'
    if not (server_url.startswith('http://') or server_url.startswith('https://')):
        return 'invalid'
    return 'configured'


class GalaxyNGControllerError(Exception):
    def __init__(self, message, status='error'):
        super().__init__(message)
        self.status = status


class GalaxyNGClient:
    def __init__(self):
        self.server_url = configured_url()
        self.api_path_prefix = getattr(settings, 'GALAXY_NG_API_PATH_PREFIX', '/api/galaxy/')
        self.content_path_prefix = getattr(settings, 'GALAXY_NG_CONTENT_PATH_PREFIX', '/pulp/content/')
        self.token = getattr(settings, 'GALAXY_NG_AUTH_TOKEN', '')
        self.username = getattr(settings, 'GALAXY_NG_USERNAME', '')
        self.password = getattr(settings, 'GALAXY_NG_PASSWORD', '')
        self.verify_ssl = bool(getattr(settings, 'GALAXY_NG_VERIFY_SSL', True))
        self.timeout = int(getattr(settings, 'GALAXY_NG_REQUEST_TIMEOUT', 10))

    @property
    def is_configured(self):
        return connection_status(self.server_url) == 'configured'

    @property
    def auth_configured(self):
        return bool(self.token or (self.username and self.password))

    def _headers(self):
        headers = {'Accept': 'application/json'}
        if self.token:
            headers['Authorization'] = f'Bearer {self.token}'
        return headers

    def _auth(self):
        if self.token or not (self.username and self.password):
            return None
        return (self.username, self.password)

    def url(self, path):
        if not self.is_configured:
            raise GalaxyNGControllerError('Galaxy NG is not configured.', status=connection_status(self.server_url))
        return urljoin(f'{self.server_url}/', path.lstrip('/'))

    def get(self, path, params=None):
        try:
            response = requests.get(
                self.url(path),
                params=params,
                headers=self._headers(),
                auth=self._auth(),
                timeout=self.timeout,
                verify=self.verify_ssl,
            )
            response.raise_for_status()
            return response.json() if response.content else {}
        except requests.RequestException as exc:
            raise GalaxyNGControllerError(str(exc)) from exc
        except ValueError as exc:
            raise GalaxyNGControllerError(f'Invalid JSON response from Galaxy NG: {exc}') from exc

    def pulp_status(self):
        return self.get(f'{self.api_path_prefix.rstrip("/")}/pulp/api/v3/status/')

    def count(self, path):
        data = self.get(path, params={'limit': 1})
        if isinstance(data, dict):
            if isinstance(data.get('count'), int):
                return data['count']
            if isinstance(data.get('meta'), dict) and isinstance(data['meta'].get('count'), int):
                return data['meta']['count']
            if isinstance(data.get('results'), list):
                return len(data['results'])
        if isinstance(data, list):
            return len(data)
        return 0


def stable_numeric_id(item, fallback):
    if isinstance(item, dict):
        item_id = item.get('id')
        if isinstance(item_id, int):
            return item_id
        key = item_id or item.get('pulp_href') or item.get('href') or item.get('name') or item.get('namespace') or fallback
    else:
        key = fallback
    return zlib.crc32(str(key).encode()) & 0x7FFFFFFF


def normalize_list_response(payload, offset=0):
    if isinstance(payload, list):
        results = payload
        count = len(results)
    elif isinstance(payload, dict):
        if isinstance(payload.get('results'), list):
            results = payload['results']
            count = payload.get('count', len(results))
        elif isinstance(payload.get('data'), list):
            results = payload['data']
            meta = payload.get('meta') if isinstance(payload.get('meta'), dict) else {}
            count = meta.get('count', payload.get('count', len(results)))
        else:
            results = [payload] if payload else []
            count = len(results)
    else:
        results = []
        count = 0

    normalized_results = []
    for index, item in enumerate(results):
        if isinstance(item, dict):
            normalized_item = dict(item)
        else:
            normalized_item = {'value': item}
        normalized_item.setdefault('id', stable_numeric_id(normalized_item, offset + index + 1))
        normalized_item.setdefault('_awx_key', str(normalized_item['id']))
        normalized_results.append(normalized_item)

    return {
        'count': count,
        'next': None,
        'previous': None,
        'results': normalized_results,
    }
