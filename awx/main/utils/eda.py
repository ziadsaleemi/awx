# Copyright (c) 2026 Red Hat, Inc.
# All Rights Reserved.

import time
from urllib.parse import urljoin, urlparse

import requests
from django.conf import settings


EDA_SUCCESS_STATUSES = {'active', 'completed', 'complete', 'enabled', 'ok', 'running', 'started', 'success', 'successful'}
EDA_FAILURE_STATUSES = {'canceled', 'cancelled', 'deleted', 'disabled', 'error', 'failed', 'failure', 'missing', 'not_found', 'stopped', 'unreachable'}
EDA_STARTABLE_STATUSES = {'created', 'disabled', 'idle', 'new', 'pending', 'planned', 'ready', 'stopped', 'unknown'}
EDA_RUNNING_STATUSES = {'active', 'enabled', 'ok', 'running', 'started', 'successful'}


class EDAControllerError(Exception):
    def __init__(self, message, status='unreachable'):
        super().__init__(message)
        self.status = status


def configured_url():
    return (getattr(settings, 'EDA_SERVER_URL', '') or '').strip().rstrip('/')


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


class EDAControllerClient:
    def __init__(self):
        self.controller_url = configured_url()
        self.status = connection_status(self.controller_url)
        self.auth_token = getattr(settings, 'EDA_AUTH_TOKEN', '') or ''
        self.verify_ssl = bool(getattr(settings, 'EDA_VERIFY_SSL', True))
        self.timeout = max(int(getattr(settings, 'EDA_REQUEST_TIMEOUT', 5) or 5), 1)
        self.activations_path = (getattr(settings, 'EDA_ACTIVATIONS_API_PATH', '') or '/api/eda/v1/activations/').strip() or '/api/eda/v1/activations/'
        self.activation_start_path = (
            getattr(settings, 'EDA_ACTIVATION_START_API_PATH', '') or '/api/eda/v1/activations/{activation_id}/start/'
        ).strip() or '/api/eda/v1/activations/{activation_id}/start/'
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
        return bool(self.auth_token)

    def headers(self):
        headers = {'Accept': 'application/json'}
        if self.auth_token:
            headers['Authorization'] = f'Bearer {self.auth_token}'
        return headers

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
            status_code = getattr(getattr(exc, 'response', None), 'status_code', None)
            raise EDAControllerError(f'EDA Controller request failed: {status_code or exc}', 'unreachable') from exc
        except ValueError as exc:
            raise EDAControllerError('EDA Controller returned invalid JSON.', 'invalid_response') from exc

    def get_json(self, path, params=None):
        return self._request_json('GET', path, params=params)

    def post_json(self, path, payload=None):
        return self._request_json('POST', path, payload=payload or {})

    def _activation_path(self, activation_id):
        return f'{self.activations_path.rstrip("/")}/{activation_id}/'

    def _format_activation_path(self, path_template, activation_id):
        return path_template.format(activation_id=activation_id)

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

    def create_activation(self, rulebook_name, activation_id='', event_source='', extra_data=None):
        payload = self.activation_payload(rulebook_name, activation_id, event_source, extra_data)
        response = self.post_json(self.activations_path, payload)
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
        response = self.post_json(self._format_activation_path(self.activation_start_path, activation_id), {})
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
        return {
            'id': activation_id,
            'name': name,
            'status': status or 'unknown',
            'started': _pick_first(item, ('started', 'started_at', 'created_at', 'created')),
            'finished': _pick_first(item, ('finished', 'finished_at', 'modified_at', 'updated_at')),
            'rulebook': rulebook or name,
            'event_source': event_source or '',
            'source': 'eda_controller',
            'related': {
                'controller_activation': self._url(f'{self.activations_path.rstrip("/")}/{activation_id}/')
                if activation_id
                else self._url(self.activations_path),
            },
        }

    def normalize_event(self, item):
        return {
            'id': _pick_first(item, ('id', 'uuid', 'event_id', 'pk')),
            'event_type': _pick_first(item, ('event_type', 'type', 'kind')),
            'status': _pick_first(item, ('status', 'state', 'level')),
            'rule': _dict_name(_pick_first(item, ('rule', 'rule_name'))),
            'message': _short_text(_pick_first(item, ('message', 'msg', 'stdout', 'summary', 'detail'))),
            'created': _pick_first(item, ('created', 'created_at', 'timestamp', 'time')),
        }
