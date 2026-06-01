# Copyright (c) 2026 Red Hat, Inc.
# All Rights Reserved.

from urllib.parse import urljoin, urlparse

import requests
from django.conf import settings


EDA_SUCCESS_STATUSES = {'active', 'completed', 'complete', 'enabled', 'ok', 'running', 'started', 'success', 'successful'}
EDA_FAILURE_STATUSES = {'canceled', 'cancelled', 'deleted', 'disabled', 'error', 'failed', 'failure', 'missing', 'not_found', 'stopped', 'unreachable'}


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


class EDAControllerClient:
    def __init__(self):
        self.controller_url = configured_url()
        self.status = connection_status(self.controller_url)
        self.auth_token = getattr(settings, 'EDA_AUTH_TOKEN', '') or ''
        self.verify_ssl = bool(getattr(settings, 'EDA_VERIFY_SSL', True))
        self.timeout = max(int(getattr(settings, 'EDA_REQUEST_TIMEOUT', 5) or 5), 1)
        self.activations_path = (getattr(settings, 'EDA_ACTIVATIONS_API_PATH', '') or '/api/eda/v1/activations/').strip() or '/api/eda/v1/activations/'

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

    def get_json(self, path, params=None):
        if not self.is_configured:
            raise EDAControllerError('EDA Controller URL is not configured.', self.status)
        try:
            response = requests.get(self._url(path), headers=self.headers(), params=params, timeout=self.timeout, verify=self.verify_ssl)
            response.raise_for_status()
            return response.json()
        except requests.Timeout as exc:
            raise EDAControllerError('EDA Controller request timed out.', 'timeout') from exc
        except requests.RequestException as exc:
            status_code = getattr(getattr(exc, 'response', None), 'status_code', None)
            raise EDAControllerError(f'EDA Controller request failed: {status_code or exc}', 'unreachable') from exc
        except ValueError as exc:
            raise EDAControllerError('EDA Controller returned invalid JSON.', 'invalid_response') from exc

    def list_activations(self, page=1, page_size=20):
        payload = self.get_json(self.activations_path, params={'page': page, 'page_size': page_size})
        if isinstance(payload, list):
            items = payload
            count = len(items)
            next_link = None
            previous_link = None
        elif isinstance(payload, dict):
            items = payload.get('results') or payload.get('data') or payload.get('items') or []
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
                return self.normalize_activation(self.get_json(f'{self.activations_path.rstrip("/")}/{activation_id}/'))
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

    def normalize_activation(self, item):
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
