# Copyright (c) 2026 Red Hat, Inc.
# All Rights Reserved.

import json
import time
from urllib.parse import urljoin, urlparse

import requests
from django.conf import settings

EDA_SUCCESS_STATUSES = {'active', 'completed', 'complete', 'enabled', 'ok', 'running', 'started', 'success', 'successful'}
EDA_FAILURE_STATUSES = {'canceled', 'cancelled', 'deleted', 'disabled', 'error', 'failed', 'failure', 'missing', 'not_found', 'stopped', 'unreachable'}
EDA_STARTABLE_STATUSES = {'created', 'disabled', 'idle', 'new', 'pending', 'planned', 'ready', 'stopped', 'unknown'}
EDA_RUNNING_STATUSES = {'active', 'enabled', 'ok', 'running', 'started', 'successful'}
DEFAULT_ACTIVATION_START_PATH = '/api/eda/v1/activations/{activation_id}/enable/'
DEFAULT_ACTIVATION_INSTANCE_LOGS_PATH = '/api/eda/v1/activation-instances/{activation_instance_id}/logs/'
DEFAULT_RULEBOOKS_PATH = '/api/eda/v1/rulebooks/'
DEFAULT_DECISION_ENVIRONMENTS_PATH = '/api/eda/v1/decision-environments/'
DEFAULT_ORGANIZATIONS_PATH = '/api/eda/v1/organizations/'
EDA_RESOURCE_API_PATHS = {
    'projects': '/api/eda/v1/projects/',
    'rule-audit': '/api/eda/v1/audit-rules/',
    'decision-environments': '/api/eda/v1/decision-environments/',
    'event-streams': '/api/eda/v1/event-streams/',
    'credentials': '/api/eda/v1/eda-credentials/',
    'credential-types': '/api/eda/v1/credential-types/',
    'rulebooks': DEFAULT_RULEBOOKS_PATH,
}
UPSTREAM_ACTIVATION_FIELDS = {
    'name',
    'description',
    'is_enabled',
    'restart_on_project_update',
    'decision_environment_id',
    'rulebook_id',
    'extra_var',
    'organization_id',
    'restart_policy',
    'awx_token_id',
    'log_level',
    'eda_credentials',
    'k8s_service_name',
    'source_mappings',
    'skip_audit_events',
    'enable_persistence',
    'rule_engine_credential_id',
    'k8s_pod_service_account_name',
    'k8s_pod_labels',
    'k8s_pod_annotations',
    'k8s_pod_node_selector',
    'k8s_pod_tolerations',
}


class EDAControllerError(Exception):
    def __init__(self, message, status='unreachable'):
        super().__init__(message)
        self.status = status


def configured_url():
    return (getattr(settings, 'EDA_SERVER_URL', '') or '').strip().rstrip('/')


def resource_path(resource):
    try:
        return EDA_RESOURCE_API_PATHS[str(resource or '').strip()]
    except KeyError as exc:
        raise EDAControllerError('EDA resource is invalid.', 'invalid') from exc


def connection_status(controller_url=None):
    controller_url = configured_url() if controller_url is None else (controller_url or '').strip().rstrip('/')
    if not controller_url:
        return 'not_configured'
    parsed = urlparse(controller_url)
    if parsed.scheme not in ('http', 'https') or not parsed.netloc:
        return 'invalid'
    return 'configured'


def workflow_status_from_activation_status(status):
    normalized = str(status or '').strip().lower().replace(' ', '_')
    if normalized in EDA_FAILURE_STATUSES:
        return 'failed'
    if normalized in EDA_SUCCESS_STATUSES:
        return 'successful'
    return 'successful'


def _pick_first(mapping, keys, default=''):
    for key in keys:
        value = mapping.get(key)
        if value not in (None, ''):
            return value
    return default


def _dict_name(value):
    if isinstance(value, dict):
        return _pick_first(value, ('name', 'rulebook_name', 'id', 'uuid'))
    return value


def _status_token(status):
    return str(status or '').strip().lower().replace(' ', '_')


def _coerce_items(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        return payload.get('results') or payload.get('data') or payload.get('items') or payload.get('events') or []
    return []


def _coerce_activation_payload(payload):
    if isinstance(payload, dict):
        for key in ('activation', 'result', 'data'):
            value = payload.get(key)
            if isinstance(value, dict):
                return value
        return payload
    return {}


def _short_text(value, length=1000):
    return str(value or '')[:length]


def _normalize_instance(item):
    if not isinstance(item, dict):
        return {}
    return {
        'id': _pick_first(item, ('id', 'uuid', 'activation_instance_id', 'pk')),
        'name': _pick_first(item, ('name', 'activation_name')),
        'status': _pick_first(item, ('status', 'state', 'activation_status')),
        'started': _pick_first(item, ('started', 'started_at', 'created_at', 'created')),
        'finished': _pick_first(item, ('finished', 'ended_at', 'finished_at', 'modified_at', 'updated_at')),
    }


class EDAControllerClient:
    def __init__(self):
        self.controller_url = configured_url()
        self.status = connection_status(self.controller_url)
        self.auth_token = getattr(settings, 'EDA_AUTH_TOKEN', '') or ''
        self.username = getattr(settings, 'EDA_USERNAME', '') or ''
        self.password = getattr(settings, 'EDA_PASSWORD', '') or ''
        self.verify_ssl = bool(getattr(settings, 'EDA_VERIFY_SSL', True))
        self.timeout = max(int(getattr(settings, 'EDA_REQUEST_TIMEOUT', 5) or 5), 1)
        self.activations_path = (getattr(settings, 'EDA_ACTIVATIONS_API_PATH', '') or '/api/eda/v1/activations/').strip() or '/api/eda/v1/activations/'
        self.activation_start_path = (
            getattr(settings, 'EDA_ACTIVATION_START_API_PATH', '') or DEFAULT_ACTIVATION_START_PATH
        ).strip() or DEFAULT_ACTIVATION_START_PATH
        self.activation_instance_logs_path = (
            getattr(settings, 'EDA_ACTIVATION_INSTANCE_LOGS_API_PATH', '') or DEFAULT_ACTIVATION_INSTANCE_LOGS_PATH
        ).strip() or DEFAULT_ACTIVATION_INSTANCE_LOGS_PATH
        self.activation_events_path = (
            getattr(settings, 'EDA_ACTIVATION_EVENTS_API_PATH', '') or '/api/eda/v1/activations/{activation_id}/events/'
        ).strip() or '/api/eda/v1/activations/{activation_id}/events/'
        self.poll_attempts = max(int(getattr(settings, 'EDA_ACTIVATION_POLL_ATTEMPTS', 1) or 0), 0)
        self.poll_interval = max(int(getattr(settings, 'EDA_ACTIVATION_POLL_INTERVAL', 0) or 0), 0)

    @property
    def is_configured(self):
        return self.status == 'configured'

    @property
    def auth_configured(self):
        return bool(self.auth_token or (self.username and self.password))

    def headers(self):
        headers = {'Accept': 'application/json'}
        if self.auth_token:
            headers['Authorization'] = f'Bearer {self.auth_token}'
        return headers

    def auth(self):
        if self.auth_token:
            return None
        if self.username and self.password:
            return (self.username, self.password)
        return None

    def _url(self, path):
        if path.startswith('http://') or path.startswith('https://'):
            return path
        return urljoin(f'{self.controller_url}/', path.lstrip('/'))

    def _request_json(self, method, path, params=None, payload=None):
        if not self.is_configured:
            raise EDAControllerError('EDA Controller URL is not configured.', self.status)
        try:
            response = requests.request(
                method,
                self._url(path),
                headers=self.headers(),
                auth=self.auth(),
                params=params,
                json=payload,
                timeout=self.timeout,
                verify=self.verify_ssl,
            )
            response.raise_for_status()
            if response.status_code == 204 or not response.content:
                return {}
            return response.json()
        except requests.Timeout as exc:
            raise EDAControllerError('EDA Controller request timed out.', 'timeout') from exc
        except requests.RequestException as exc:
            response = getattr(exc, 'response', None)
            status_code = getattr(response, 'status_code', None)
            detail = ''
            if response is not None:
                detail = _short_text(getattr(response, 'text', '') or getattr(response, 'content', '') or '', 500)
            message = f'EDA Controller request failed: {status_code or exc}'
            if detail:
                message = f'{message}: {detail}'
            raise EDAControllerError(message, 'bad_request' if status_code == 400 else 'unreachable') from exc
        except ValueError as exc:
            raise EDAControllerError('EDA Controller returned invalid JSON.', 'invalid_response') from exc

    def get_json(self, path, params=None):
        return self._request_json('GET', path, params=params)

    def post_json(self, path, payload=None):
        return self._request_json('POST', path, payload=payload or {})

    def put_json(self, path, payload=None):
        return self._request_json('PUT', path, payload=payload or {})

    def patch_json(self, path, payload=None):
        return self._request_json('PATCH', path, payload=payload or {})

    def delete_json(self, path):
        return self._request_json('DELETE', path)

    def _resource_path(self, resource, resource_id=None):
        base_path = resource_path(resource).rstrip('/')
        if resource_id not in (None, ''):
            return f'{base_path}/{resource_id}/'
        return f'{base_path}/'

    def list_resource(self, resource, params=None):
        return self.get_json(self._resource_path(resource), params=params)

    def get_resource(self, resource, resource_id):
        if resource_id in (None, ''):
            raise EDAControllerError('EDA resource id is required.', 'missing')
        return self.get_json(self._resource_path(resource, resource_id))

    def default_organization_id(self):
        return self.find_controller_item_id(DEFAULT_ORGANIZATIONS_PATH, 'Default') or self.find_controller_item_id(DEFAULT_ORGANIZATIONS_PATH)

    def upstream_resource_payload(self, resource, payload=None, add_defaults=False):
        normalized = dict(payload or {})
        resource = str(resource or '').strip()

        if resource == 'projects':
            if not normalized.get('url') and normalized.get('scm_url'):
                normalized['url'] = normalized.get('scm_url')
            normalized.pop('scm_url', None)
            normalized.pop('scm_type', None)
            if add_defaults:
                normalized.setdefault('verify_ssl', True)
        elif resource == 'decision-environments':
            if not normalized.get('image_url'):
                image = normalized.get('image') or normalized.get('container_image')
                if image:
                    normalized['image_url'] = image
            normalized.pop('image', None)
            normalized.pop('container_image', None)

        if add_defaults and resource in ('projects', 'decision-environments', 'credentials', 'event-streams') and not normalized.get('organization_id'):
            organization_id = self.default_organization_id()
            if organization_id:
                normalized['organization_id'] = organization_id

        return normalized

    def create_resource(self, resource, payload=None):
        return self.post_json(self._resource_path(resource), self.upstream_resource_payload(resource, payload, add_defaults=True))

    def update_resource(self, resource, resource_id, payload=None, method='PATCH'):
        if resource_id in (None, ''):
            raise EDAControllerError('EDA resource id is required.', 'missing')
        method = str(method or 'PATCH').upper()
        path = self._resource_path(resource, resource_id)
        payload = self.upstream_resource_payload(resource, payload, add_defaults=False)
        if method == 'PUT':
            return self.put_json(path, payload)
        return self.patch_json(path, payload)

    def sync_project(self, project_id, payload=None):
        if project_id in (None, ''):
            raise EDAControllerError('EDA project id is required.', 'missing')
        return self.post_json(f'{self._resource_path("projects", project_id)}sync/', payload or {})

    def list_event_stream_activations(self, event_stream_id, params=None):
        if event_stream_id in (None, ''):
            raise EDAControllerError('EDA event stream id is required.', 'missing')
        return self.get_json(f'{self._resource_path("event-streams", event_stream_id)}activations/', params=params)

    def delete_resource(self, resource, resource_id):
        if resource_id in (None, ''):
            raise EDAControllerError('EDA resource id is required.', 'missing')
        self.delete_json(self._resource_path(resource, resource_id))
        return {'id': resource_id, 'status': 'deleted'}

    def _activation_path(self, activation_id):
        return f'{self.activations_path.rstrip("/")}/{activation_id}/'

    def _format_activation_path(self, path_template, activation_id):
        return path_template.format(activation_id=activation_id)

    def _activation_instances_path(self, activation_id):
        return f'{self._activation_path(activation_id).rstrip("/")}/instances/'

    def _format_activation_instance_logs_path(self, path_template, activation_instance_id):
        return path_template.format(activation_instance_id=activation_instance_id)

    def get_activation(self, activation_id):
        if not activation_id:
            raise EDAControllerError('EDA activation id is required.', 'missing')
        return self.normalize_activation(self.get_json(self._activation_path(activation_id)))

    def delete_activation(self, activation_id):
        if not activation_id:
            raise EDAControllerError('EDA activation id is required.', 'missing')
        self.delete_json(self._activation_path(activation_id))
        return {'id': activation_id, 'status': 'deleted'}

    def control_activation(self, activation_id, action):
        if not activation_id:
            raise EDAControllerError('EDA activation id is required.', 'missing')
        action = str(action or '').strip().lower()
        if action not in ('enable', 'disable', 'restart'):
            raise EDAControllerError('EDA activation action is invalid.', 'invalid')
        response = self.post_json(f'{self._activation_path(activation_id)}{action}/', {})
        normalized = self.normalize_activation(_coerce_activation_payload(response))
        return normalized if normalized.get('id') or normalized.get('status') != 'unknown' else self.get_activation(activation_id)

    def list_activations(self, page=1, page_size=20):
        payload = self.get_json(self.activations_path, params={'page': page, 'page_size': page_size})
        if isinstance(payload, list):
            items = payload
            count = len(items)
            next_link = None
            previous_link = None
        elif isinstance(payload, dict):
            items = _coerce_items(payload)
            count = payload.get('count', len(items))
            next_link = payload.get('next')
            previous_link = payload.get('previous')
        else:
            items = []
            count = 0
            next_link = None
            previous_link = None
        return {
            'count': count,
            'next': next_link,
            'previous': previous_link,
            'results': [self.normalize_activation(item) for item in items if isinstance(item, dict)],
        }

    def list_activation_instances(self, activation_id, page=1, page_size=20):
        if not activation_id:
            return []
        payload = self.get_json(self._activation_instances_path(activation_id), params={'page': page, 'page_size': page_size})
        return [_normalize_instance(item) for item in _coerce_items(payload) if isinstance(item, dict)]

    def find_activation(self, activation_id='', rulebook_name=''):
        if activation_id:
            try:
                return self.normalize_activation(self.get_json(self._activation_path(activation_id)))
            except EDAControllerError:
                pass

        response = self.list_activations(page=1, page_size=200)
        activation_id = str(activation_id or '').strip()
        rulebook_name = str(rulebook_name or '').strip().lower()
        for activation in response['results']:
            candidate_id = str(activation.get('id') or '').strip()
            candidate_name = str(activation.get('name') or '').strip().lower()
            candidate_rulebook = str(activation.get('rulebook') or '').strip().lower()
            if activation_id and candidate_id == activation_id:
                return activation
            if rulebook_name and rulebook_name in (candidate_name, candidate_rulebook):
                return activation
        return None

    def activation_payload(self, rulebook_name, activation_id='', event_source='', extra_data=None):
        payload = dict(extra_data or {})
        payload.setdefault('name', rulebook_name)
        payload.setdefault('rulebook_name', rulebook_name)
        if activation_id:
            payload.setdefault('activation_id', activation_id)
        if event_source:
            payload.setdefault('event_source', event_source)
        return payload

    def upstream_activation_payload(self, rulebook_name, activation_id='', event_source='', extra_data=None):
        payload = {key: value for key, value in dict(extra_data or {}).items() if key in UPSTREAM_ACTIVATION_FIELDS}
        payload.setdefault('name', rulebook_name or activation_id)
        payload.setdefault('is_enabled', False)
        if 'extra_var' in payload and isinstance(payload['extra_var'], (dict, list)):
            payload['extra_var'] = json.dumps(payload['extra_var'])
        if 'rulebook_id' not in payload:
            rulebook_id = self.find_controller_item_id(DEFAULT_RULEBOOKS_PATH, rulebook_name)
            if rulebook_id:
                payload['rulebook_id'] = rulebook_id
        if 'decision_environment_id' not in payload:
            decision_environment_id = self.find_controller_item_id(DEFAULT_DECISION_ENVIRONMENTS_PATH)
            if decision_environment_id:
                payload['decision_environment_id'] = decision_environment_id
        if 'organization_id' not in payload:
            organization_id = self.find_controller_item_id(DEFAULT_ORGANIZATIONS_PATH, 'Default') or self.find_controller_item_id(DEFAULT_ORGANIZATIONS_PATH)
            if organization_id:
                payload['organization_id'] = organization_id
        if event_source and 'source_mappings' not in payload:
            payload.setdefault('description', f'Event source: {event_source}')
        return payload

    def find_controller_item_id(self, path, name=''):
        try:
            payload = self.get_json(path, params={'page': 1, 'page_size': 200})
        except EDAControllerError:
            return ''
        items = [item for item in _coerce_items(payload) if isinstance(item, dict)]
        if not items:
            return ''
        normalized_name = str(name or '').strip().lower()
        if normalized_name:
            for item in items:
                item_name = str(_pick_first(item, ('name', 'rulebook_name', 'id'))).strip().lower()
                if item_name == normalized_name:
                    return _pick_first(item, ('id', 'uuid', 'pk'))
        return _pick_first(items[0], ('id', 'uuid', 'pk'))

    def create_activation(self, rulebook_name, activation_id='', event_source='', extra_data=None):
        payload = self.activation_payload(rulebook_name, activation_id, event_source, extra_data)
        try:
            response = self.post_json(self.activations_path, payload)
        except EDAControllerError as exc:
            if exc.status != 'bad_request':
                raise
            upstream_payload = self.upstream_activation_payload(rulebook_name, activation_id, event_source, extra_data)
            if upstream_payload == payload:
                raise
            response = self.post_json(self.activations_path, upstream_payload)
        return self.normalize_activation(_coerce_activation_payload(response))

    def should_start_activation(self, activation):
        status = _status_token(activation.get('status') if activation else '')
        if not status:
            return True
        if status in EDA_RUNNING_STATUSES:
            return False
        return status in EDA_STARTABLE_STATUSES or status not in EDA_SUCCESS_STATUSES

    def start_activation(self, activation):
        activation_id = activation.get('id') if activation else ''
        if not activation_id:
            raise EDAControllerError('EDA activation id is required to start an activation.', 'missing')
        try:
            response = self.post_json(self._format_activation_path(self.activation_start_path, activation_id), {})
        except EDAControllerError as exc:
            missing_custom_endpoint = any(marker in str(exc).lower() for marker in ('404', '405', 'not found', 'method not allowed'))
            if self.activation_start_path == DEFAULT_ACTIVATION_START_PATH or not missing_custom_endpoint:
                raise
            response = self.post_json(self._format_activation_path(DEFAULT_ACTIVATION_START_PATH, activation_id), {})
        normalized = self.normalize_activation(_coerce_activation_payload(response))
        return normalized if normalized.get('id') or normalized.get('status') != 'unknown' else activation

    def poll_activation(self, activation_id='', rulebook_name='', attempts=None):
        attempts = self.poll_attempts if attempts is None else max(int(attempts or 0), 0)
        activation = None
        for index in range(attempts):
            if index and self.poll_interval:
                time.sleep(self.poll_interval)
            activation = self.find_activation(activation_id, rulebook_name)
            if activation and _status_token(activation.get('status')) in EDA_SUCCESS_STATUSES | EDA_FAILURE_STATUSES:
                break
        return activation

    def activation_events(self, activation_id='', limit=20):
        if not activation_id:
            return []
        instance_id = ''
        try:
            activation = self.get_activation(activation_id)
            instance_id = self._activation_instance_id(activation)
        except EDAControllerError:
            pass
        if not instance_id:
            try:
                instance_id = self._activation_instance_id({'instances': self.list_activation_instances(activation_id, page_size=limit)})
            except EDAControllerError:
                instance_id = ''

        if instance_id:
            try:
                payload = self.get_json(
                    self._format_activation_instance_logs_path(self.activation_instance_logs_path, instance_id), params={'page_size': limit}
                )
                return [self.normalize_event(item) for item in _coerce_items(payload)[:limit] if isinstance(item, dict)]
            except EDAControllerError:
                pass

        payload = self.get_json(self._format_activation_path(self.activation_events_path, activation_id), params={'page_size': limit})
        return [self.normalize_event(item) for item in _coerce_items(payload)[:limit] if isinstance(item, dict)]

    def ensure_activation_started(self, rulebook_name, activation_id='', event_source='', extra_data=None, poll=True, include_events=True):
        actions = []
        activation = self.find_activation(activation_id, rulebook_name)
        if activation:
            actions.append('found')
        else:
            activation = self.create_activation(rulebook_name, activation_id, event_source, extra_data)
            actions.append('created')

        if self.should_start_activation(activation):
            activation = self.start_activation(activation)
            actions.append('started')

        if poll:
            polled = self.poll_activation(activation.get('id') or activation_id, rulebook_name)
            if polled:
                activation = polled
                actions.append('polled')

        events = []
        if include_events:
            try:
                events = self.activation_events(activation.get('id') or activation_id)
                if events:
                    actions.append('events')
            except EDAControllerError:
                events = []

        return {'activation': activation, 'actions': actions, 'events': events}

    def normalize_activation(self, item):
        item = _coerce_activation_payload(item)
        rulebook = _dict_name(_pick_first(item, ('rulebook', 'rulebook_name', 'rulebook_id')))
        status = _pick_first(item, ('status', 'state', 'activation_status', 'event_source_status'))
        if not status and item.get('is_enabled') is True:
            status = 'running'
        elif not status and item.get('is_enabled') is False:
            status = 'disabled'

        activation_id = _pick_first(item, ('id', 'uuid', 'activation_id', 'pk'))
        name = _pick_first(item, ('name', 'activation_name', 'rulebook_name'), rulebook or activation_id)
        event_source = _dict_name(_pick_first(item, ('event_source', 'event_stream', 'source', 'source_name')))
        instances = [_normalize_instance(instance) for instance in _coerce_items(item.get('instances')) if isinstance(instance, dict)]
        return {
            'id': activation_id,
            'name': name,
            'status': status or 'unknown',
            'started': _pick_first(item, ('started', 'started_at', 'created_at', 'created')),
            'finished': _pick_first(item, ('finished', 'finished_at', 'modified_at', 'updated_at')),
            'rulebook': rulebook or name,
            'event_source': event_source or '',
            'current_job_id': _pick_first(item, ('current_job_id', 'current_instance_id', 'activation_instance_id')),
            'instances': instances,
            'source': 'eda_controller',
            'related': {
                'controller_activation': (
                    self._url(f'{self.activations_path.rstrip("/")}/{activation_id}/') if activation_id else self._url(self.activations_path)
                ),
            },
        }

    def _activation_instance_id(self, activation):
        instance_id = _pick_first(activation, ('current_job_id', 'current_instance_id', 'activation_instance_id'))
        if instance_id:
            return instance_id
        instances = activation.get('instances') if isinstance(activation, dict) else None
        if isinstance(instances, list):
            for instance in sorted(instances, key=lambda item: str(item.get('started') or item.get('id') or ''), reverse=True):
                instance_id = _pick_first(instance, ('id', 'uuid', 'activation_instance_id', 'pk'))
                if instance_id:
                    return instance_id
        return ''

    def normalize_event(self, item):
        return {
            'id': _pick_first(item, ('id', 'uuid', 'event_id', 'pk')),
            'event_type': _pick_first(item, ('event_type', 'type', 'kind')),
            'status': _pick_first(item, ('status', 'state', 'level')),
            'rule': _dict_name(_pick_first(item, ('rule', 'rule_name'))),
            'message': _short_text(_pick_first(item, ('message', 'msg', 'stdout', 'summary', 'detail', 'log'))),
            'created': _pick_first(item, ('created', 'created_at', 'timestamp', 'time', 'log_timestamp', 'log_created_at')),
        }
