# Copyright (c) 2026 Red Hat, Inc.
# All Rights Reserved.

import hashlib
import zlib
from urllib.parse import urljoin

import requests
from django.core.cache import cache
from django.conf import settings

GALAXY_NG_ADAPTER_CONTRACT_VERSION = 1
GALAXY_NG_CAPABILITY_CACHE_TIMEOUT = 60
GALAXY_NG_MUTATION_CAPABILITIES = (
    'approve_collections',
    'publish_collections',
    'sync_repositories',
)


def galaxy_ng_capability_contracts(api_path_prefix):
    api_prefix = api_path_prefix.rstrip('/')
    return {
        'read_namespaces': (('get', f'{api_prefix}/v3/namespaces/'),),
        'read_collections': (('get', f'{api_prefix}/v3/collections/'),),
        'search_collections': (('get', f'{api_prefix}/v3/plugin/ansible/search/collection-versions/'),),
        'read_repositories': (('get', f'{api_prefix}/pulp/api/v3/repositories/ansible/ansible/'),),
        'read_remotes': (('get', f'{api_prefix}/pulp/api/v3/remotes/ansible/collection/'),),
        'read_remote_registries': (('get', f'{api_prefix}/_ui/v1/execution-environments/registries/'),),
        'read_signature_keys': (('get', f'{api_prefix}/pulp/api/v3/signing-services/'),),
        'read_collection_approvals': (('get', f'{api_prefix}/_ui/v1/collection-versions/'),),
        'read_tasks': (
            ('get', f'{api_prefix}/v3/tasks/'),
            ('get', f'{api_prefix}/pulp/api/v3/tasks/'),
        ),
        'approve_collections': (
            (
                'post',
                f'{api_prefix}/v3/collections/{{namespace}}/{{name}}/versions/{{version}}/move/{{source_path}}/{{dest_path}}/',
            ),
        ),
        'publish_collections': (('post', f'{api_prefix}/v3/artifacts/collections/'),),
        'sync_repositories': (('post', f'{api_prefix}/content/{{path}}/v3/sync/'),),
    }


def galaxy_ng_capability_report(schema, api_path_prefix):
    contracts = galaxy_ng_capability_contracts(api_path_prefix)
    paths = schema.get('paths') if isinstance(schema, dict) else None
    schema_available = isinstance(paths, dict)
    capabilities = {}
    for capability, alternatives in contracts.items():
        capabilities[capability] = bool(schema_available and any(isinstance(paths.get(path), dict) and method in paths[path] for method, path in alternatives))

    missing_capabilities = [name for name, supported in capabilities.items() if not supported]
    missing_mutation_capabilities = [name for name in GALAXY_NG_MUTATION_CAPABILITIES if not capabilities.get(name)]
    if not schema_available:
        state = 'unknown'
        message = 'Galaxy NG OpenAPI capabilities could not be verified. Mutations are blocked until compatibility can be confirmed.'
    elif missing_capabilities:
        state = 'degraded'
        message = 'The connected Galaxy NG API is missing capabilities used by Capstan. Unsupported operations are blocked.'
    else:
        state = 'compatible'
        message = 'The connected Galaxy NG API advertises every capability required by this Capstan adapter.'

    info = schema.get('info') if isinstance(schema, dict) and isinstance(schema.get('info'), dict) else {}
    return {
        'adapter_contract_version': GALAXY_NG_ADAPTER_CONTRACT_VERSION,
        'state': state,
        'schema_available': schema_available,
        'schema_version': str(info.get('version') or ''),
        'openapi_version': str(schema.get('openapi') or '') if isinstance(schema, dict) else '',
        'capabilities': capabilities,
        'missing_capabilities': missing_capabilities,
        'missing_mutation_capabilities': missing_mutation_capabilities,
        'mutation_safe': not missing_mutation_capabilities,
        'message': message,
    }


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

    def _authorization_value(self):
        token = self.token.strip()
        if not token:
            return ''
        if token.lower().startswith(('bearer ', 'token ')):
            return token
        if token.count('.') == 2:
            return f'Bearer {token}'
        return f'Token {token}'

    def _headers(self):
        headers = {'Accept': 'application/json'}
        if self.token:
            headers['Authorization'] = self._authorization_value()
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

    def post(self, path, payload=None):
        try:
            response = requests.post(
                self.url(path),
                json=payload or {},
                headers={**self._headers(), 'Content-Type': 'application/json'},
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

    def openapi_schema(self):
        return self.get(f'{self.api_path_prefix.rstrip("/")}/v3/openapi.json')

    def capability_report(self, refresh=False):
        cache_fingerprint = '|'.join(
            [
                str(GALAXY_NG_ADAPTER_CONTRACT_VERSION),
                self.server_url,
                self.api_path_prefix,
                str(self.verify_ssl),
                str(self.timeout),
                str(self.auth_configured),
            ]
        )
        cache_key = f'awx:galaxy-ng:capabilities:{hashlib.sha256(cache_fingerprint.encode()).hexdigest()}'
        if not refresh:
            cached_report = cache.get(cache_key)
            if cached_report is not None:
                return cached_report
        report = galaxy_ng_capability_report(self.openapi_schema(), self.api_path_prefix)
        cache.set(cache_key, report, GALAXY_NG_CAPABILITY_CACHE_TIMEOUT)
        return report

    def require_capability(self, capability):
        report = self.capability_report(refresh=True)
        if report['capabilities'].get(capability):
            return report
        raise GalaxyNGControllerError(
            (
                f'The connected Galaxy NG API does not advertise the required "{capability}" capability. '
                'Capstan blocked this operation before changing Galaxy state. Review the Galaxy compatibility status before upgrading.'
            ),
            status='incompatible',
        )

    def count(self, path, params=None):
        count_params = {'limit': 1}
        if params:
            count_params.update(params)
        data = self.get(path, params=count_params)
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

    def ansible_distribution_base_path(self, repository_name):
        distributions_path = f'{self.api_path_prefix.rstrip("/")}/pulp/api/v3/distributions/ansible/ansible/'
        for query_key in ('base_path', 'name'):
            payload = self.get(distributions_path, params={query_key: repository_name, 'limit': 1})
            if isinstance(payload, dict) and isinstance(payload.get('results'), list) and payload['results']:
                base_path = payload['results'][0].get('base_path')
                if base_path:
                    return base_path
        return repository_name

    def sync_ansible_distribution(self, base_path):
        return self.post(f'{self.api_path_prefix.rstrip("/")}/content/{base_path}/v3/sync/')


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
