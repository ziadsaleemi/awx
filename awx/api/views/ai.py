# Copyright (c) 2024 Red Hat, Inc.
# All Rights Reserved.

import json
import time
import logging
import urllib.parse
from collections import defaultdict

import requests
from django.conf import settings
from django.utils.translation import gettext_lazy as _
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from rest_framework.permissions import IsAuthenticated

logger = logging.getLogger('awx.api.views.ai')

# Simple in-memory rate limiter: {user_id: [timestamps]}
_rate_limit_store: dict = defaultdict(list)

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
}


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
    # Prepend the system prompt as the first message if not already present
    full_messages = messages
    if not any(m.get('role') == 'system' for m in messages):
        full_messages = [{'role': 'system', 'content': system_prompt}] + messages

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

        api_key = getattr(settings, 'AI_API_KEY', '')
        if not api_key:
            return Response(
                {'detail': _('AI_API_KEY is not configured. Set it in Settings → AI Assistant.')},
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

        # Build provider config
        provider = getattr(settings, 'AI_PROVIDER', 'openai')
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
        model = getattr(settings, 'AI_MODEL_NAME', '') or defaults['model']

        url = _build_url(provider, base_url, model)
        headers = _build_headers(provider, api_key)
        payload = _build_request_payload(provider, model, messages, max_tokens, system_prompt)

        try:
            resp = requests.post(url, headers=headers, json=payload, timeout=30)
        except requests.exceptions.ConnectionError as exc:
            logger.error('AI proxy connection error: %s', exc)
            return Response(
                {'detail': _('Could not connect to the AI provider. Check AI_API_URL in settings.')},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        except requests.exceptions.Timeout:
            return Response(
                {'detail': _('The AI provider did not respond in time. Please try again.')},
                status=status.HTTP_504_GATEWAY_TIMEOUT,
            )

        if resp.status_code == 401:
            return Response(
                {'detail': _('AI provider rejected the API key. Check AI_API_KEY in settings.')},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        if not resp.ok:
            logger.warning('AI provider returned %d: %s', resp.status_code, resp.text[:500])
            return Response(
                {'detail': _('The AI provider returned an error. Check your settings and try again.')},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        try:
            data = resp.json()
        except ValueError:
            logger.error('AI provider returned non-JSON response')
            return Response(
                {'detail': _('Unexpected response from AI provider.')},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        # Normalize provider response → standard shape
        try:
            if provider == 'watsonx':
                content = data['results'][0]['generated_text']
            else:
                content = data['choices'][0]['message']['content']
        except (KeyError, IndexError, TypeError) as exc:
            logger.error('Could not parse AI provider response: %s | raw: %s', exc, json.dumps(data)[:500])
            return Response(
                {'detail': _('Could not parse the AI provider response.')},
                status=status.HTTP_502_BAD_GATEWAY,
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
        return Response(
            {
                'enabled': getattr(settings, 'AI_ENABLED', False),
                'provider': getattr(settings, 'AI_PROVIDER', 'openai'),
                'model': getattr(settings, 'AI_MODEL_NAME', ''),
                'configured': bool(getattr(settings, 'AI_API_KEY', '')),
            }
        )
