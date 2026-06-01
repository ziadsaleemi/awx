# Copyright (c) 2024 Red Hat, Inc.
# All Rights Reserved.

import json
import time
import logging
import urllib.parse
from base64 import urlsafe_b64decode
from collections import defaultdict
from datetime import timedelta, timezone

import requests
from django.conf import settings
from django.db import connection
from django.utils.dateparse import parse_datetime
from django.utils.timezone import now
from django.utils.translation import gettext_lazy as _
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from rest_framework.permissions import IsAuthenticated

from awx.api.permissions import IsSystemAdmin
from awx.conf.models import Setting
from awx.main.tasks.system import clear_setting_cache

logger = logging.getLogger('awx.api.views.ai')

# Simple in-memory rate limiter: {user_id: [timestamps]}
_rate_limit_store: dict = defaultdict(list)

_OPENAI_CODEX_DEVICE_CODE_URL = 'https://auth.openai.com/api/accounts/deviceauth/usercode'
_OPENAI_CODEX_DEVICE_VERIFY_URL = 'https://auth.openai.com/codex/device'
_OPENAI_CODEX_DEVICE_CALLBACK_URI = 'https://auth.openai.com/deviceauth/callback'
_OPENAI_CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token'
_OPENAI_CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'
_OPENAI_CODEX_MODELS_URL = 'https://api.openai.com/v1/models'
_OPENAI_CODEX_USER_AGENT = 'awx-codex-device-client/1.0'
_OPENAI_MODEL_EXCLUDE_TOKENS = (
    'embedding',
    'moderation',
    'transcribe',
    'tts',
    'realtime',
    'image',
    'search',
    'whisper',
    'dall-e',
)

# ChatGPT device-login OAuth tokens do not reliably expose /v1/models.
# Keep this aligned with the ChatGPT Codex backend models used by the reference app.
_OPENAI_CODEX_MODEL_CATALOG = [
    'gpt-5.2',
    'gpt-5.2-codex',
    'gpt-5.3-codex',
    'gpt-5.1-codex-max',
    'gpt-5.1-codex',
    'gpt-5.1-codex-mini',
]

# Provider → default base URL and chat completions path
_PROVIDER_DEFAULTS = {
    'openai': {
        'base_url': 'https://api.openai.com/v1',
        'path': '/chat/completions',
        'model': 'gpt-4o',
    },
    'azure_openai': {
        'base_url': '',  # Must be configured; format: https://<resource>.openai.azure.com/
        'path': '/openai/deployments/{model}/chat/completions?api-version=2024-02-01',
        'model': 'gpt-4o',
    },
    'redhat_ai': {
        'base_url': 'https://api.openai.com/v1',  # Red Hat AI is OAI-compatible; override URL in settings
        'path': '/chat/completions',
        'model': 'mistralai/Mistral-7B-Instruct-v0.3',
    },
    'watsonx': {
        'base_url': '',  # Region-specific; e.g. https://us-south.ml.cloud.ibm.com
        'path': '/ml/v1/text/chat?version=2024-05-31',
        'model': 'ibm/granite-13b-chat-v2',
    },
    'gemini': {
        'base_url': 'https://generativelanguage.googleapis.com/v1beta/openai',
        'path': '/chat/completions',
        'model': 'gemini-1.5-pro',
    },
    'openai_codex': {
        'base_url': _OPENAI_CODEX_RESPONSES_URL,
        'path': '',
        'model': 'gpt-5.2',
    },
}


class DeviceAuthError(Exception):
    pass


class DeviceAuthPending(Exception):
    pass


class DeviceAuthExpired(Exception):
    pass


class AIProviderError(Exception):
    def __init__(self, detail, status_code=status.HTTP_502_BAD_GATEWAY):
        self.detail = detail
        self.status_code = status_code
        super().__init__(str(detail))


def _check_rate_limit(user_id: int, limit: int) -> bool:
    """Return True if the request is allowed, False if rate-limited."""
    now = time.time()
    window_start = now - 60
    timestamps = _rate_limit_store[user_id]
    # Prune old entries
    _rate_limit_store[user_id] = [t for t in timestamps if t > window_start]
    if len(_rate_limit_store[user_id]) >= limit:
        return False
    _rate_limit_store[user_id].append(now)
    return True


def _build_request_payload(provider: str, model: str, messages: list, max_tokens: int, system_prompt: str) -> dict:
    """Build the chat-completions request body for the given provider."""
    full_messages = _messages_with_system(messages, system_prompt)

    if provider == 'watsonx':
        # watsonx uses a slightly different schema
        return {
            'model_id': model,
            'messages': full_messages,
            'parameters': {'max_new_tokens': max_tokens},
        }

    return {
        'model': model,
        'messages': full_messages,
        'max_tokens': max_tokens,
    }


def _build_url(provider: str, base_url: str, model: str) -> str:
    defaults = _PROVIDER_DEFAULTS.get(provider, _PROVIDER_DEFAULTS['openai'])
    path = defaults['path'].replace('{model}', urllib.parse.quote(model, safe=''))
    base = (base_url or defaults['base_url']).rstrip('/')
    return base + path


def _build_headers(provider: str, api_key: str) -> dict:
    headers = {'Content-Type': 'application/json'}
    if provider == 'azure_openai':
        headers['api-key'] = api_key
    else:
        headers['Authorization'] = f'Bearer {api_key}'
    return headers


def _messages_with_system(messages: list, system_prompt: str) -> list:
    if any(m.get('role') == 'system' for m in messages):
        return messages
    return [{'role': 'system', 'content': system_prompt}] + messages


def _decode_jwt_payload(token: str) -> dict:
    try:
        _header, payload, *_rest = token.split('.')
        padded = payload + '=' * (-len(payload) % 4)
        decoded = urlsafe_b64decode(padded.encode('ascii')).decode('utf-8')
        data = json.loads(decoded)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _jwt_scopes(token: str) -> set:
    payload = _decode_jwt_payload(token)
    raw = payload.get('scope') or payload.get('scp') or ''
    if isinstance(raw, str):
        return {scope for scope in raw.split() if scope}
    if isinstance(raw, list):
        return {str(scope) for scope in raw if str(scope)}
    return set()


def _openai_codex_runtime(token: str) -> dict:
    payload = _decode_jwt_payload(token)
    auth_payload = payload.get('https://api.openai.com/auth')
    openai_auth = auth_payload if isinstance(auth_payload, dict) else {}
    scopes = _jwt_scopes(token)
    return {
        'chatgpt_account_id': str(openai_auth.get('chatgpt_account_id') or '') or None,
        'chatgpt_plan_type': str(openai_auth.get('chatgpt_plan_type') or '') or None,
        'use_codex_backend': 'api.responses.write' in scopes or 'model.request' not in scopes,
    }


_CODEX_UNSUPPORTED_MODELS = frozenset(
    {
        'gpt-4o',
        'gpt-4o-2024-05-13',
        'gpt-4o-2024-08-06',
        'gpt-4o-2024-11-20',
        'gpt-4o-audio-preview',
        'gpt-4o-mini',
        'gpt-4-turbo',
        'gpt-4-turbo-preview',
        'gpt-4-32k',
        'gpt-4-32k-0613',
        'gpt-4-0613',
        'gpt-4-0314',
    }
)


def _codex_model_name(model: str) -> str:
    if model == 'gpt-5.1':
        return 'gpt-5.1-codex'
    if model.startswith('gpt-5'):
        return model
    if model.startswith('gpt-4') and model not in _CODEX_UNSUPPORTED_MODELS:
        return model
    return 'gpt-5.2'


def _codex_input_messages(messages: list, system_prompt: str) -> tuple:
    full_messages = _messages_with_system(messages, system_prompt)
    system_message = next((message for message in full_messages if message.get('role') == 'system'), None)
    instructions = system_message.get('content') if system_message else 'You are a helpful AI assistant.'
    input_messages = []

    for index, message in enumerate(message for message in full_messages if message.get('role') != 'system'):
        role = message.get('role')
        content = message.get('content')
        if role == 'assistant':
            input_messages.append(
                {
                    'type': 'message',
                    'role': 'assistant',
                    'status': 'completed',
                    'id': f'msg_past_{index}',
                    'content': content,
                }
            )
        else:
            input_messages.append({'type': 'message', 'role': role, 'content': content})

    return instructions, input_messages


def _parse_codex_sse_data(data: dict, current: str) -> str:
    if data.get('type') == 'response.output_text.delta' and data.get('delta'):
        return current + str(data['delta'])

    response = data.get('response')
    if isinstance(response, dict):
        output_text = response.get('output_text')
        if isinstance(output_text, dict) and output_text.get('delta'):
            return current + str(output_text['delta'])

        output = response.get('output')
        if isinstance(output, list) and output:
            content = output[0].get('content') if isinstance(output[0], dict) else None
            if isinstance(content, list) and content:
                text = content[0].get('text') if isinstance(content[0], dict) else None
                if isinstance(text, dict) and text.get('delta'):
                    return current + str(text['delta'])
                if isinstance(text, str):
                    return text

    message = data.get('message')
    if isinstance(message, dict):
        content = message.get('content')
        if isinstance(content, dict):
            parts = content.get('parts')
            if isinstance(parts, list) and parts:
                return str(parts[0])

    return current


def _setting_changed(key: str, value) -> bool:
    try:
        settings._awx_conf_memoizedcache
    except AttributeError:
        settings._awx_conf_memoizedcache = {}

    setting = Setting.objects.filter(key=key, user__isnull=True).order_by('pk').first()
    if not setting:
        Setting.objects.create(key=key, value=value)
        return True
    if setting.value != value:
        setting.value = value
        setting.save(update_fields=['value'])
        return True
    return False


def _save_ai_settings(values: dict) -> None:
    changed = [key for key, value in values.items() if _setting_changed(key, value)]
    if changed:
        connection.on_commit(lambda: clear_setting_cache(changed))


def _openai_codex_configured() -> bool:
    return bool(getattr(settings, 'AI_OPENAI_CODEX_ACCESS_TOKEN', ''))


def _provider_configured(provider: str) -> bool:
    if provider == 'openai_codex':
        return _openai_codex_configured()
    return bool(getattr(settings, 'AI_API_KEY', ''))


def _normalize_model_list(values) -> list:
    if isinstance(values, str):
        values = [values]
    if not isinstance(values, (list, tuple)):
        return []

    normalized = []
    seen = set()
    for raw_value in values:
        if not isinstance(raw_value, str):
            continue
        value = raw_value.strip()
        if not value or value in seen:
            continue
        normalized.append(value)
        seen.add(value)
    return normalized


def _openai_model_allowed(model_id: str) -> bool:
    lowered = model_id.lower()
    if any(token in lowered for token in _OPENAI_MODEL_EXCLUDE_TOKENS):
        return False
    return lowered.startswith(('gpt', 'o1', 'o3', 'o4', 'chatgpt'))


def _openai_codex_cached_models() -> list:
    return _normalize_model_list(getattr(settings, 'AI_OPENAI_CODEX_AVAILABLE_MODELS', []))


def _openai_codex_available_models() -> list:
    return _openai_codex_cached_models() or list(_OPENAI_CODEX_MODEL_CATALOG)


def _openai_codex_effective_default_model(models: list | None = None) -> str:
    model_options = _normalize_model_list(models) or _openai_codex_available_models()
    configured_model = str(getattr(settings, 'AI_MODEL_NAME', '') or '').strip()
    if configured_model and configured_model in model_options:
        return configured_model

    provider_default = _PROVIDER_DEFAULTS['openai_codex']['model']
    if provider_default in model_options:
        return provider_default
    return model_options[0] if model_options else provider_default


def _openai_codex_model_payload(models: list | None = None, source: str | None = None, model_fetch_error: str = '', default_model: str | None = None) -> dict:
    cached_models = _openai_codex_cached_models()
    model_options = _normalize_model_list(models) or cached_models or list(_OPENAI_CODEX_MODEL_CATALOG)
    return {
        'configured': _openai_codex_configured(),
        'models': model_options,
        'default_model': default_model or _openai_codex_effective_default_model(model_options),
        'source': source or ('cached' if cached_models else 'curated'),
        'model_fetch_error': str(model_fetch_error) if model_fetch_error else '',
    }


def _fetch_openai_codex_models(access_token: str | None = None) -> tuple:
    access_token = access_token or _get_openai_codex_access_token()
    if not access_token:
        raise AIProviderError(
            _('OpenAI Codex device login is not connected. Connect it before refreshing models.'),
            status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    try:
        response = requests.get(
            _OPENAI_CODEX_MODELS_URL,
            headers={'Authorization': f'Bearer {access_token}', 'User-Agent': _OPENAI_CODEX_USER_AGENT},
            timeout=20,
        )
        if response.status_code == 200:
            payload = response.json()
            models = _normalize_model_list(
                [
                    str(item['id'])
                    for item in payload.get('data', [])
                    if isinstance(item, dict) and isinstance(item.get('id'), str) and _openai_model_allowed(str(item['id']))
                ]
            )
            if models:
                return models, 'live', ''
            return list(_OPENAI_CODEX_MODEL_CATALOG), 'curated', _('OpenAI returned no compatible chat models; using the curated Codex catalog.')

        logger.info('OpenAI Codex model refresh fell back to curated catalog after status %d.', response.status_code)
        return list(_OPENAI_CODEX_MODEL_CATALOG), 'curated', _('OpenAI model refresh used the curated Codex catalog.')
    except (requests.exceptions.RequestException, ValueError) as exc:
        logger.warning('OpenAI Codex model refresh failed: %s', exc)
        return list(_OPENAI_CODEX_MODEL_CATALOG), 'curated', _('Could not fetch live OpenAI models; using the curated Codex catalog.')


def _token_expired_or_expiring(expires_at_value) -> bool:
    if not expires_at_value:
        return False
    expires_at = parse_datetime(str(expires_at_value))
    if not expires_at:
        return False
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return expires_at <= now() + timedelta(minutes=1)


def _save_openai_codex_token(data: dict) -> dict:
    access_token = data.get('access_token')
    if not access_token:
        raise DeviceAuthError('Token exchange succeeded without an access token.')

    runtime = _openai_codex_runtime(access_token)
    account_id = runtime.get('chatgpt_account_id') or ''
    plan_type = runtime.get('chatgpt_plan_type') or ''
    expires_at = ''
    if data.get('expires_in'):
        expires_at = (now() + timedelta(seconds=int(data.get('expires_in')))).isoformat()

    values = {
        'AI_OPENAI_CODEX_ACCESS_TOKEN': access_token,
        'AI_OPENAI_CODEX_REFRESH_TOKEN': data.get('refresh_token') or getattr(settings, 'AI_OPENAI_CODEX_REFRESH_TOKEN', ''),
        'AI_OPENAI_CODEX_TOKEN_EXPIRES_AT': expires_at,
        'AI_OPENAI_CODEX_SCOPE': data.get('scope') or getattr(settings, 'AI_OPENAI_CODEX_SCOPE', ''),
        'AI_OPENAI_CODEX_CHATGPT_ACCOUNT_ID': account_id,
        'AI_OPENAI_CODEX_PLAN_TYPE': plan_type,
    }
    _save_ai_settings(values)
    return values


def _refresh_openai_codex_token() -> str | None:
    refresh_token = getattr(settings, 'AI_OPENAI_CODEX_REFRESH_TOKEN', '')
    if not refresh_token:
        return None

    payload = {
        'grant_type': 'refresh_token',
        'client_id': getattr(settings, 'AI_OPENAI_CODEX_CLIENT_ID', ''),
        'refresh_token': refresh_token,
    }
    response = requests.post(
        _OPENAI_CODEX_TOKEN_URL,
        data=payload,
        headers={'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': _OPENAI_CODEX_USER_AGENT},
        timeout=15,
    )
    if response.status_code >= 400:
        return None

    data = response.json()
    values = _save_openai_codex_token(data)
    return values['AI_OPENAI_CODEX_ACCESS_TOKEN']


def _get_openai_codex_access_token() -> str | None:
    access_token = getattr(settings, 'AI_OPENAI_CODEX_ACCESS_TOKEN', '')
    if not access_token:
        return None
    if _token_expired_or_expiring(getattr(settings, 'AI_OPENAI_CODEX_TOKEN_EXPIRES_AT', '')):
        return _refresh_openai_codex_token() or access_token
    return access_token


def _start_openai_codex_device_code(scope: str | None = None) -> dict:
    client_id = getattr(settings, 'AI_OPENAI_CODEX_CLIENT_ID', '')
    if not client_id:
        raise DeviceAuthError('AI_OPENAI_CODEX_CLIENT_ID is not configured.')

    payload = {
        'client_id': client_id,
        'scope': scope or getattr(settings, 'AI_OPENAI_CODEX_SCOPE', ''),
    }
    response = requests.post(
        _OPENAI_CODEX_DEVICE_CODE_URL,
        json=payload,
        headers={'Content-Type': 'application/json', 'User-Agent': _OPENAI_CODEX_USER_AGENT},
        timeout=15,
    )
    if response.status_code == 404:
        raise DeviceAuthError('OpenAI Codex device login is not enabled for this account.')
    if response.status_code >= 400:
        raise DeviceAuthError(f'Failed to start OpenAI Codex device login: {response.text[:300]}')

    data = response.json()
    if not {'device_auth_id', 'user_code'}.issubset(data):
        raise DeviceAuthError('Device code response was missing required fields.')

    return {
        'device_code': data['device_auth_id'],
        'device_auth_id': data['device_auth_id'],
        'user_code': data['user_code'],
        'verification_uri': _OPENAI_CODEX_DEVICE_VERIFY_URL,
        'verification_uri_complete': _OPENAI_CODEX_DEVICE_VERIFY_URL,
        'expires_in': int(data.get('expires_in') or 900),
        'interval': int(data.get('interval') or 5),
    }


def _poll_openai_codex_authorization_code(device_code: str, user_code: str) -> tuple | None:
    response = requests.post(
        _OPENAI_CODEX_DEVICE_CODE_URL.replace('/usercode', '/token'),
        json={'device_auth_id': device_code, 'user_code': user_code},
        headers={'Content-Type': 'application/json', 'User-Agent': _OPENAI_CODEX_USER_AGENT},
        timeout=15,
    )
    if response.status_code in {403, 404}:
        return None
    if response.status_code >= 400:
        raise DeviceAuthError(f'OpenAI Codex device polling failed: status {response.status_code}.')

    data = response.json()
    authorization_code = data.get('authorization_code')
    code_verifier = data.get('code_verifier')
    if not authorization_code or not code_verifier:
        raise DeviceAuthError('Device polling succeeded without an authorization code.')
    return str(authorization_code), str(code_verifier)


def _exchange_openai_codex_authorization_code(authorization_code: str, code_verifier: str) -> dict:
    payload = {
        'grant_type': 'authorization_code',
        'code': authorization_code,
        'redirect_uri': _OPENAI_CODEX_DEVICE_CALLBACK_URI,
        'client_id': getattr(settings, 'AI_OPENAI_CODEX_CLIENT_ID', ''),
        'code_verifier': code_verifier,
    }
    response = requests.post(
        _OPENAI_CODEX_TOKEN_URL,
        data=payload,
        headers={'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': _OPENAI_CODEX_USER_AGENT},
        timeout=15,
    )
    data = response.json() if response.headers.get('content-type', '').startswith('application/json') else {}
    if response.status_code >= 400:
        error = data.get('error')
        if error in {'expired_token', 'access_denied'}:
            raise DeviceAuthExpired()
        raise DeviceAuthError(f"OpenAI Codex token exchange failed: {error or 'unknown_error'}.")
    return data


def _poll_openai_codex_device_code_once(device_code: str, user_code: str | None) -> dict:
    if not user_code:
        raise DeviceAuthError('User code is required for OpenAI Codex device polling.')

    authorization = _poll_openai_codex_authorization_code(device_code, user_code)
    if authorization is None:
        raise DeviceAuthPending()

    authorization_code, code_verifier = authorization
    data = _exchange_openai_codex_authorization_code(authorization_code, code_verifier)
    return _save_openai_codex_token(data)


def _call_openai_codex(model: str, messages: list, system_prompt: str) -> str:
    access_token = _get_openai_codex_access_token()
    if not access_token:
        raise AIProviderError(
            _('OpenAI Codex device login is not connected. Connect it in Settings → AI Assistant.'),
            status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    runtime = _openai_codex_runtime(access_token)
    account_id = runtime.get('chatgpt_account_id') or getattr(settings, 'AI_OPENAI_CODEX_CHATGPT_ACCOUNT_ID', '')
    if not account_id:
        raise AIProviderError(_('OpenAI Codex token is missing a ChatGPT account id. Reconnect device login.'))

    instructions, input_messages = _codex_input_messages(messages, system_prompt)
    headers = {
        'Authorization': f'Bearer {access_token}',
        'chatgpt-account-id': account_id,
        'OpenAI-Beta': 'responses=experimental',
        'originator': 'pi',
        'accept': 'text/event-stream',
        'content-type': 'application/json',
        'User-Agent': _OPENAI_CODEX_USER_AGENT,
    }
    body = {
        'model': _codex_model_name(model),
        'store': False,
        'stream': True,
        'instructions': instructions,
        'input': input_messages,
    }

    response = requests.post(_OPENAI_CODEX_RESPONSES_URL, headers=headers, json=body, timeout=90, stream=True)
    if response.status_code == 401:
        raise AIProviderError(_('OpenAI Codex rejected the device token. Reconnect device login.'))
    if not response.ok:
        logger.warning('OpenAI Codex provider returned %d: %s', response.status_code, response.text[:500])
        raise AIProviderError(_('OpenAI Codex returned an error. Check settings and try again.'))

    assistant_content = ''
    last_payload = None
    for raw_line in response.iter_lines(decode_unicode=True):
        if isinstance(raw_line, bytes):
            line = raw_line.decode('utf-8', errors='ignore').strip()
        else:
            line = (raw_line or '').strip()
        if not line or not line.startswith('data: '):
            continue
        data_string = line.removeprefix('data: ').strip()
        if data_string == '[DONE]':
            break
        try:
            parsed = json.loads(data_string)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            last_payload = parsed
            assistant_content = _parse_codex_sse_data(parsed, assistant_content)

    if assistant_content:
        return assistant_content.strip()
    if last_payload:
        return str(last_payload)[:1000]
    raise AIProviderError(_('OpenAI Codex did not return a response.'))


def _call_ai_provider(provider: str, model: str, messages: list, max_tokens: int, system_prompt: str, api_key: str, base_url: str) -> str:
    if provider == 'openai_codex':
        return _call_openai_codex(model, messages, system_prompt)

    url = _build_url(provider, base_url, model)
    headers = _build_headers(provider, api_key)
    payload = _build_request_payload(provider, model, messages, max_tokens, system_prompt)

    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=30)
    except requests.exceptions.ConnectionError as exc:
        logger.error('AI proxy connection error: %s', exc)
        raise AIProviderError(_('Could not connect to the AI provider. Check AI_API_URL in settings.'))
    except requests.exceptions.Timeout:
        raise AIProviderError(_('The AI provider did not respond in time. Please try again.'), status.HTTP_504_GATEWAY_TIMEOUT)

    if resp.status_code == 401:
        raise AIProviderError(_('AI provider rejected the API key. Check AI_API_KEY in settings.'))

    if not resp.ok:
        logger.warning('AI provider returned %d: %s', resp.status_code, resp.text[:500])
        raise AIProviderError(_('The AI provider returned an error. Check your settings and try again.'))

    try:
        data = resp.json()
    except ValueError:
        logger.error('AI provider returned non-JSON response')
        raise AIProviderError(_('Unexpected response from AI provider.'))

    try:
        if provider == 'watsonx':
            return data['results'][0]['generated_text']
        return data['choices'][0]['message']['content']
    except (KeyError, IndexError, TypeError) as exc:
        logger.error('Could not parse AI provider response: %s | raw: %s', exc, json.dumps(data)[:500])
        raise AIProviderError(_('Could not parse the AI provider response.'))


class AIChatView(APIView):
    """
    POST /api/v2/ai/chat/

    Body:
        {
            "messages": [
                {"role": "user", "content": "How do I create a job template?"}
            ]
        }

    Returns:
        {
            "message": {"role": "assistant", "content": "..."},
            "model": "gpt-4o",
            "provider": "openai"
        }

    Requires authentication. Respects AI_ENABLED, AI_RATE_LIMIT_PER_MINUTE, and
    per-request RBAC (any authenticated user may call this endpoint).
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, *args, **kwargs):
        # Feature flag check
        if not getattr(settings, 'AI_ENABLED', False):
            return Response(
                {'detail': _('The AI assistant is not enabled. Enable it in Settings → AI Assistant.')},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        # Rate limiting
        rate_limit = getattr(settings, 'AI_RATE_LIMIT_PER_MINUTE', 20)
        if not _check_rate_limit(request.user.pk, rate_limit):
            return Response(
                {'detail': _('Rate limit exceeded. Please wait before sending another message.')},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        # Validate request body
        messages = request.data.get('messages')
        if not messages or not isinstance(messages, list):
            return Response(
                {'detail': _('Request body must include a non-empty "messages" array.')},
                status=status.HTTP_400_BAD_REQUEST,
            )

        for msg in messages:
            if not isinstance(msg, dict) or msg.get('role') not in ('user', 'assistant', 'system') or not isinstance(msg.get('content'), str):
                return Response(
                    {'detail': _('Each message must have a "role" (user/assistant/system) and a string "content".')},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        if len(messages) > 100:
            return Response(
                {'detail': _('Message history too long. Maximum 100 messages per request.')},
                status=status.HTTP_400_BAD_REQUEST,
            )

        provider = getattr(settings, 'AI_PROVIDER', 'openai')
        api_key = getattr(settings, 'AI_API_KEY', '')
        if provider != 'openai_codex' and not api_key:
            return Response(
                {'detail': _('AI_API_KEY is not configured. Set it in Settings → AI Assistant.')},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        base_url = getattr(settings, 'AI_API_URL', '')
        max_tokens = getattr(settings, 'AI_MAX_TOKENS', 2048)
        system_prompt = getattr(settings, 'AI_SYSTEM_PROMPT', '')
        # Allow callers to override the system prompt for specialised tasks (e.g. code generation).
        # The override must be a non-empty string and is validated to be under 4 KB.
        system_override = request.data.get('system_override')
        if system_override is not None:
            if not isinstance(system_override, str) or len(system_override) > 4096:
                return Response(
                    {'detail': _('system_override must be a string of at most 4096 characters.')},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            system_prompt = system_override
        defaults = _PROVIDER_DEFAULTS.get(provider, _PROVIDER_DEFAULTS['openai'])
        if provider == 'openai_codex':
            model = _openai_codex_effective_default_model()
        else:
            model = getattr(settings, 'AI_MODEL_NAME', '') or defaults['model']

        try:
            content = _call_ai_provider(provider, model, messages, max_tokens, system_prompt, api_key, base_url)
        except AIProviderError as exc:
            return Response(
                {'detail': exc.detail},
                status=exc.status_code,
            )

        return Response(
            {
                'message': {'role': 'assistant', 'content': content},
                'model': model,
                'provider': provider,
            },
            status=status.HTTP_200_OK,
        )


class AISettingsView(APIView):
    """
    GET /api/v2/ai/settings/

    Returns the public (non-secret) AI configuration so the UI knows whether
    the assistant is enabled and which provider is active.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, *args, **kwargs):
        provider = getattr(settings, 'AI_PROVIDER', 'openai')
        return Response(
            {
                'enabled': getattr(settings, 'AI_ENABLED', False),
                'provider': provider,
                'model': getattr(settings, 'AI_MODEL_NAME', ''),
                'configured': _provider_configured(provider),
                'openai_codex_connected': _openai_codex_configured(),
                'openai_codex_account_id': getattr(settings, 'AI_OPENAI_CODEX_CHATGPT_ACCOUNT_ID', ''),
                'openai_codex_plan_type': getattr(settings, 'AI_OPENAI_CODEX_PLAN_TYPE', ''),
                'openai_codex_expires_at': getattr(settings, 'AI_OPENAI_CODEX_TOKEN_EXPIRES_AT', ''),
                'openai_codex_available_models': _openai_codex_available_models(),
                'openai_codex_default_model': _openai_codex_effective_default_model(),
            }
        )


class OpenAICodexDeviceCodeStartView(APIView):
    permission_classes = [IsSystemAdmin]

    def post(self, request, *args, **kwargs):
        scope = request.data.get('scope')
        if scope is not None and not isinstance(scope, str):
            return Response({'detail': _('scope must be a string.')}, status=status.HTTP_400_BAD_REQUEST)
        try:
            return Response(_start_openai_codex_device_code(scope=scope), status=status.HTTP_200_OK)
        except DeviceAuthError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except requests.exceptions.RequestException as exc:
            logger.warning('OpenAI Codex device login start failed: %s', exc)
            return Response(
                {'detail': _('Could not start OpenAI Codex device login. Check network connectivity and settings.')},
                status=status.HTTP_502_BAD_GATEWAY,
            )


class OpenAICodexDeviceCodePollView(APIView):
    permission_classes = [IsSystemAdmin]

    def post(self, request, *args, **kwargs):
        device_code = request.data.get('device_code')
        user_code = request.data.get('user_code')
        if not isinstance(device_code, str) or not device_code:
            return Response({'detail': _('device_code is required.')}, status=status.HTTP_400_BAD_REQUEST)
        if user_code is not None and not isinstance(user_code, str):
            return Response({'detail': _('user_code must be a string.')}, status=status.HTTP_400_BAD_REQUEST)

        try:
            values = _poll_openai_codex_device_code_once(device_code, user_code)
        except DeviceAuthPending:
            return Response({'status': 'pending'}, status=status.HTTP_200_OK)
        except DeviceAuthExpired:
            return Response({'status': 'expired'}, status=status.HTTP_200_OK)
        except DeviceAuthError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except requests.exceptions.RequestException as exc:
            logger.warning('OpenAI Codex device login polling failed: %s', exc)
            return Response(
                {'detail': _('Could not poll OpenAI Codex device login. Check network connectivity and settings.')},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        return Response(
            {
                'status': 'approved',
                'provider': 'openai_codex',
                'expires_at': values.get('AI_OPENAI_CODEX_TOKEN_EXPIRES_AT', ''),
                'account_id': values.get('AI_OPENAI_CODEX_CHATGPT_ACCOUNT_ID', ''),
                'plan_type': values.get('AI_OPENAI_CODEX_PLAN_TYPE', ''),
            },
            status=status.HTTP_200_OK,
        )


class OpenAICodexModelsView(APIView):
    permission_classes = [IsSystemAdmin]

    def get(self, request, *args, **kwargs):
        return Response(_openai_codex_model_payload(), status=status.HTTP_200_OK)


class OpenAICodexModelsRefreshView(APIView):
    permission_classes = [IsSystemAdmin]

    def post(self, request, *args, **kwargs):
        try:
            models, source, model_fetch_error = _fetch_openai_codex_models()
        except AIProviderError as exc:
            return Response({'detail': exc.detail}, status=exc.status_code)
        except requests.exceptions.RequestException as exc:
            logger.warning('OpenAI Codex model refresh failed: %s', exc)
            return Response(
                {'detail': _('Could not refresh OpenAI Codex models. Check network connectivity and settings.')},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        _save_ai_settings({'AI_OPENAI_CODEX_AVAILABLE_MODELS': models})
        return Response(_openai_codex_model_payload(models=models, source=source, model_fetch_error=model_fetch_error), status=status.HTTP_200_OK)


class OpenAICodexDefaultModelView(APIView):
    permission_classes = [IsSystemAdmin]

    def post(self, request, *args, **kwargs):
        model = request.data.get('model')
        if not isinstance(model, str) or not model.strip():
            return Response({'detail': _('model is required.')}, status=status.HTTP_400_BAD_REQUEST)

        model = model.strip()
        models = _openai_codex_available_models()
        if model not in models:
            return Response({'detail': _('Select an available OpenAI Codex model.')}, status=status.HTTP_400_BAD_REQUEST)

        _save_ai_settings({'AI_MODEL_NAME': model})
        return Response(_openai_codex_model_payload(models=models, source='cached', default_model=model), status=status.HTTP_200_OK)
