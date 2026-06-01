# Copyright (c) 2024 Red Hat, Inc.
# All Rights Reserved.

import json
import time
import logging
import re
import shutil
import urllib.parse
from base64 import urlsafe_b64decode
from collections import defaultdict
from datetime import timedelta, timezone
from pathlib import Path, PurePosixPath
from types import SimpleNamespace

import requests
from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import connection, transaction
from django.utils.dateparse import parse_datetime
from django.utils.text import slugify
from django.utils.timezone import now
from django.utils.translation import gettext_lazy as _
from rest_framework import status
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from rest_framework.permissions import IsAuthenticated

from ansible_base.rbac.permission_registry import permission_registry

from awx.api.permissions import IsSystemAdmin
from awx.api.serializers import (
    CatalogItemSerializer,
    ConstructedInventorySerializer,
    InventorySerializer,
    InventorySourceSerializer,
    JobTemplateSerializer,
    ProjectSerializer,
    ScheduleSerializer,
    TerraformJobTemplateSerializer,
    WorkflowJobTemplateNodeDetailSerializer,
    WorkflowJobTemplateSerializer,
)
from awx.api.views.opa import check_opa_policy
from awx.conf.models import Setting
from awx.main import models
from awx.main.access import get_user_queryset
from awx.main.constants import SURVEY_TYPE_MAPPING
from awx.main.models.rbac import give_creator_permissions
from awx.main.tasks.system import clear_setting_cache
from awx.main.utils import parse_yaml_or_json
from awx.main.utils.encryption import encrypt_value
from awx.main.utils.filters import SmartFilter

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
_AI_CONTEXT_LIST_LIMIT = 25
_AI_DIRECT_LIST_LIMIT = 200
_AI_RESOURCE_PREVIEW_LIMIT = 10
_AI_PROJECT_FILE_MAX_BYTES = 256 * 1024
_AI_PROJECT_FILE_ALLOWED_SUFFIXES = {'.cfg', '.ini', '.j2', '.json', '.md', '.toml', '.txt', '.yaml', '.yml'}
_AI_PROJECT_FILE_BLOCKED_PARTS = {'.git', '.hg', '.svn', '__pycache__'}
_AI_PROJECT_LOCAL_PATH_MAX_LENGTH = 128
_AI_PROJECT_WORKSPACE_FLAGS = ('create_local_path', 'create_workspace', 'create_project_workspace')

_CONSTRUCTED_INPUT_INVENTORY_FIELDS = (
    'input_inventories',
    'input_inventory_ids',
    'source_inventories',
    'source_inventory_ids',
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

_AI_RESOURCE_TYPE_ALIASES = {
    'catalog': 'catalog_item',
    'catalog_item': 'catalog_item',
    'catalog_items': 'catalog_item',
    'constructed_inventory': 'constructed_inventory',
    'constructed_inventories': 'constructed_inventory',
    'credential_reference': 'credential_reference',
    'credential_references': 'credential_reference',
    'inventory': 'inventory',
    'inventories': 'inventory',
    'inventory_source': 'inventory_source',
    'inventory_sources': 'inventory_source',
    'job_template': 'job_template',
    'job_templates': 'job_template',
    'project': 'project',
    'project_file': 'project_file',
    'project_files': 'project_file',
    'project_content': 'project_file',
    'project_contents': 'project_file',
    'playbook_file': 'project_file',
    'playbook_files': 'project_file',
    'role_file': 'project_file',
    'role_files': 'project_file',
    'projects': 'project',
    'permission_assignment': 'role_assignment',
    'permission_assignments': 'role_assignment',
    'role_assignment': 'role_assignment',
    'role_assignments': 'role_assignment',
    'schedule': 'schedule',
    'schedules': 'schedule',
    'smart_inventory': 'smart_inventory',
    'smart_inventories': 'smart_inventory',
    'survey': 'survey_spec',
    'surveys': 'survey_spec',
    'survey_question': 'survey_spec',
    'survey_questions': 'survey_spec',
    'survey_spec': 'survey_spec',
    'survey_specs': 'survey_spec',
    'workflow': 'workflow_job_template',
    'workflow_job_template': 'workflow_job_template',
    'workflow_job_templates': 'workflow_job_template',
}

_AI_OPERATION_ALIASES = {
    'associate': 'attach',
    'disassociate': 'detach',
}

_AI_RESOURCE_TYPES = {
    'catalog_item': {
        'model': models.CatalogItem,
        'serializer': CatalogItemSerializer,
        'audit_relation': 'catalog_item',
    },
    'constructed_inventory': {
        'model': models.Inventory,
        'serializer': ConstructedInventorySerializer,
        'audit_relation': 'inventory',
        'forced_data': {'kind': 'constructed'},
    },
    'inventory': {
        'model': models.Inventory,
        'serializer': InventorySerializer,
        'audit_relation': 'inventory',
        'default_data': {'kind': ''},
    },
    'inventory_source': {
        'model': models.InventorySource,
        'serializer': InventorySourceSerializer,
        'audit_relation': 'inventory_source',
    },
    'job_template': {
        'model': models.JobTemplate,
        'serializer': JobTemplateSerializer,
        'audit_relation': 'job_template',
    },
    'project': {
        'model': models.Project,
        'serializer': ProjectSerializer,
        'audit_relation': 'project',
    },
    'schedule': {
        'model': models.Schedule,
        'serializer': ScheduleSerializer,
        'audit_relation': 'schedule',
    },
    'smart_inventory': {
        'model': models.Inventory,
        'serializer': InventorySerializer,
        'audit_relation': 'inventory',
        'forced_data': {'kind': 'smart'},
    },
    'workflow_job_template': {
        'model': models.WorkflowJobTemplate,
        'serializer': WorkflowJobTemplateSerializer,
        'audit_relation': 'workflow_job_template',
    },
}

_AI_CREDENTIAL_REFERENCE_TARGET_ALIASES = {
    'inventory_source': 'inventory_source',
    'inventory_sources': 'inventory_source',
    'job_template': 'job_template',
    'job_templates': 'job_template',
    'schedule': 'schedule',
    'schedules': 'schedule',
    'workflow_job_template_node': 'workflow_job_template_node',
    'workflow_job_template_nodes': 'workflow_job_template_node',
    'workflow_node': 'workflow_job_template_node',
    'workflow_nodes': 'workflow_job_template_node',
    'workflow_template_node': 'workflow_job_template_node',
    'workflow_template_nodes': 'workflow_job_template_node',
}

_AI_CREDENTIAL_REFERENCE_TARGETS = {
    'inventory_source': {
        'model': models.InventorySource,
        'serializer': InventorySourceSerializer,
        'audit_relation': 'inventory_source',
    },
    'job_template': {
        'model': models.JobTemplate,
        'serializer': JobTemplateSerializer,
        'audit_relation': 'job_template',
    },
    'schedule': {
        'model': models.Schedule,
        'serializer': ScheduleSerializer,
        'audit_relation': 'schedule',
    },
    'workflow_job_template_node': {
        'model': models.WorkflowJobTemplateNode,
        'serializer': WorkflowJobTemplateNodeDetailSerializer,
        'audit_relation': 'workflow_job_template_node',
    },
}

_AI_ROLE_ASSIGNMENT_TARGET_ALIASES = {
    'catalog': 'catalog_item',
    'catalog_item': 'catalog_item',
    'catalog_items': 'catalog_item',
    'credential': 'credential',
    'credentials': 'credential',
    'inventory': 'inventory',
    'inventories': 'inventory',
    'job_template': 'job_template',
    'job_templates': 'job_template',
    'organization': 'organization',
    'organizations': 'organization',
    'project': 'project',
    'projects': 'project',
    'team': 'team',
    'teams': 'team',
    'terraform_job_template': 'terraform_job_template',
    'terraform_job_templates': 'terraform_job_template',
    'terraform_template': 'terraform_job_template',
    'terraform_templates': 'terraform_job_template',
    'workflow': 'workflow_job_template',
    'workflow_job_template': 'workflow_job_template',
    'workflow_job_templates': 'workflow_job_template',
}

_AI_ROLE_ASSIGNMENT_TARGETS = {
    'catalog_item': {'model': models.CatalogItem, 'audit_relation': 'catalog_item'},
    'credential': {'model': models.Credential, 'audit_relation': 'credential'},
    'inventory': {'model': models.Inventory, 'audit_relation': 'inventory'},
    'job_template': {'model': models.JobTemplate, 'audit_relation': 'job_template'},
    'organization': {'model': models.Organization, 'audit_relation': 'organization'},
    'project': {'model': models.Project, 'audit_relation': 'project'},
    'team': {'model': models.Team, 'audit_relation': 'team'},
    'terraform_job_template': {'model': models.TerraformJobTemplate, 'audit_relation': 'terraform_job_template'},
    'workflow_job_template': {'model': models.WorkflowJobTemplate, 'audit_relation': 'workflow_job_template'},
}

_AI_SURVEY_SPEC_TARGET_ALIASES = {
    'job_template': 'job_template',
    'job_templates': 'job_template',
    'terraform_job_template': 'terraform_job_template',
    'terraform_job_templates': 'terraform_job_template',
    'terraform_template': 'terraform_job_template',
    'terraform_templates': 'terraform_job_template',
    'workflow': 'workflow_job_template',
    'workflow_job_template': 'workflow_job_template',
    'workflow_job_templates': 'workflow_job_template',
}

_AI_SURVEY_SPEC_TARGETS = {
    'job_template': {
        'model': models.JobTemplate,
        'serializer': JobTemplateSerializer,
        'audit_relation': 'job_template',
    },
    'terraform_job_template': {
        'model': models.TerraformJobTemplate,
        'serializer': TerraformJobTemplateSerializer,
        'audit_relation': 'terraform_job_template',
    },
    'workflow_job_template': {
        'model': models.WorkflowJobTemplate,
        'serializer': WorkflowJobTemplateSerializer,
        'audit_relation': 'workflow_job_template',
    },
}

_AI_SURVEY_TYPE_ALIASES = {
    'choice': 'multiplechoice',
    'choices': 'multiplechoice',
    'int': 'integer',
    'multi_choice': 'multiselect',
    'multi_select': 'multiselect',
    'multi_select_choice': 'multiselect',
    'multiple_choice': 'multiplechoice',
    'multiple_select': 'multiselect',
    'number': 'float',
    'select': 'multiplechoice',
    'single_choice': 'multiplechoice',
    'single_select': 'multiplechoice',
    'str': 'text',
    'string': 'text',
}

_AI_ROLE_FIELD_ALIASES = {
    'admin': 'admin_role',
    'administrator': 'admin_role',
    'approve': 'approval_role',
    'approval': 'approval_role',
    'auditor': 'auditor_role',
    'execute': 'execute_role',
    'execution': 'execute_role',
    'inventory_admin': 'inventory_admin_role',
    'job_template_admin': 'job_template_admin_role',
    'member': 'member_role',
    'project_admin': 'project_admin_role',
    'read': 'read_role',
    'update': 'update_role',
    'use': 'use_role',
    'workflow_admin': 'workflow_admin_role',
}

_SENSITIVE_KEY_RE = re.compile(r'(password|secret|token|private[_-]?key|api[_-]?key|credential)', re.IGNORECASE)


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


class AIResourceActionApplyError(Exception):
    def __init__(self, operations):
        self.operations = operations
        super().__init__('AI resource action apply failed validation.')


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


def _related_context(value):
    if value is None:
        return None
    if hasattr(value, 'pk') and hasattr(value, '_meta'):
        summary = {'id': value.pk}
        label = getattr(value, 'name', None) or getattr(value, 'username', None)
        if label:
            summary['name'] = label
        return summary
    return value


def _read_attr_path(obj, attr_path: str):
    value = obj
    for attr in attr_path.split('.'):
        if value is None:
            return None
        value = getattr(value, attr, None)
    return value


def _visible_hosts_queryset(user):
    return get_user_queryset(user, models.Host).exclude(inventory__kind='constructed').select_related('inventory').distinct()


def _visible_resource_specs():
    return [
        {
            'key': 'hosts',
            'singular': 'host',
            'plural': 'hosts',
            'patterns': (r'\bhosts?\b',),
            'queryset': _visible_hosts_queryset,
            'order_by': ('inventory__name', 'name', 'id'),
            'fields': (('id', 'id'), ('name', 'name'), ('inventory', 'inventory'), ('enabled', 'enabled')),
        },
        {
            'key': 'groups',
            'singular': 'group',
            'plural': 'groups',
            'patterns': (r'\bgroups?\b',),
            'model': models.Group,
            'select_related': ('inventory',),
            'order_by': ('inventory__name', 'name', 'id'),
            'fields': (('id', 'id'), ('name', 'name'), ('inventory', 'inventory')),
        },
        {
            'key': 'inventories',
            'singular': 'inventory',
            'plural': 'inventories',
            'patterns': (r'\binventories\b', r'\binventory\b(?!\s+sources?\b)'),
            'model': models.Inventory,
            'select_related': ('organization',),
            'order_by': ('organization__name', 'name', 'id'),
            'fields': (('id', 'id'), ('name', 'name'), ('kind', 'kind'), ('organization', 'organization')),
        },
        {
            'key': 'inventory_sources',
            'singular': 'inventory source',
            'plural': 'inventory sources',
            'patterns': (r'\binventory sources?\b',),
            'model': models.InventorySource,
            'select_related': ('inventory', 'source_project'),
            'order_by': ('inventory__name', 'name', 'id'),
            'fields': (('id', 'id'), ('name', 'name'), ('source', 'source'), ('inventory', 'inventory'), ('source_project', 'source_project')),
        },
        {
            'key': 'projects',
            'singular': 'project',
            'plural': 'projects',
            'patterns': (r'\bprojects?\b',),
            'model': models.Project,
            'select_related': ('organization',),
            'order_by': ('organization__name', 'name', 'id'),
            'fields': (('id', 'id'), ('name', 'name'), ('scm_type', 'scm_type'), ('organization', 'organization')),
        },
        {
            'key': 'job_templates',
            'singular': 'job template',
            'plural': 'job templates',
            'patterns': (r'(?<!workflow )(?<!terraform )\bjob templates?\b', r'(?<!workflow )(?<!terraform )\btemplates?\b'),
            'model': models.JobTemplate,
            'select_related': ('project', 'inventory', 'organization'),
            'order_by': ('organization__name', 'name', 'id'),
            'fields': (('id', 'id'), ('name', 'name'), ('project', 'project'), ('inventory', 'inventory'), ('organization', 'organization')),
        },
        {
            'key': 'workflow_job_templates',
            'singular': 'workflow job template',
            'plural': 'workflow job templates',
            'patterns': (r'\bworkflows?\b', r'\bworkflow job templates?\b'),
            'model': models.WorkflowJobTemplate,
            'select_related': ('organization',),
            'order_by': ('organization__name', 'name', 'id'),
            'fields': (('id', 'id'), ('name', 'name'), ('organization', 'organization')),
        },
        {
            'key': 'terraform_job_templates',
            'singular': 'Terraform job template',
            'plural': 'Terraform job templates',
            'patterns': (r'\bterraform (?:job )?templates?\b',),
            'model': models.TerraformJobTemplate,
            'select_related': ('organization', 'project', 'target_inventory'),
            'order_by': ('organization__name', 'name', 'id'),
            'fields': (
                ('id', 'id'),
                ('name', 'name'),
                ('terraform_dir', 'terraform_dir'),
                ('organization', 'organization'),
                ('project', 'project'),
                ('target_inventory', 'target_inventory'),
            ),
        },
        {
            'key': 'credentials',
            'singular': 'credential',
            'plural': 'credentials',
            'patterns': (r'\bcredentials?\b(?!\s+types?\b)',),
            'model': models.Credential,
            'select_related': ('credential_type', 'organization'),
            'order_by': ('organization__name', 'name', 'id'),
            'fields': (('id', 'id'), ('name', 'name'), ('credential_type', 'credential_type'), ('organization', 'organization')),
        },
        {
            'key': 'credential_types',
            'singular': 'credential type',
            'plural': 'credential types',
            'patterns': (r'\bcredential types?\b',),
            'model': models.CredentialType,
            'order_by': ('name', 'id'),
            'fields': (('id', 'id'), ('name', 'name'), ('kind', 'kind'), ('managed', 'managed')),
        },
        {
            'key': 'organizations',
            'singular': 'organization',
            'plural': 'organizations',
            'patterns': (r'\borganizations?\b', r'\borgs?\b'),
            'model': models.Organization,
            'order_by': ('name', 'id'),
            'fields': (('id', 'id'), ('name', 'name')),
        },
        {
            'key': 'teams',
            'singular': 'team',
            'plural': 'teams',
            'patterns': (r'\bteams?\b',),
            'model': models.Team,
            'select_related': ('organization',),
            'order_by': ('organization__name', 'name', 'id'),
            'fields': (('id', 'id'), ('name', 'name'), ('organization', 'organization')),
        },
        {
            'key': 'users',
            'singular': 'user',
            'plural': 'users',
            'patterns': (r'\busers?\b',),
            'model': models.User,
            'order_by': ('username', 'id'),
            'fields': (('id', 'id'), ('username', 'username'), ('first_name', 'first_name'), ('last_name', 'last_name')),
        },
        {
            'key': 'schedules',
            'singular': 'schedule',
            'plural': 'schedules',
            'patterns': (r'\bschedules?\b',),
            'model': models.Schedule,
            'select_related': ('unified_job_template',),
            'order_by': ('name', 'id'),
            'fields': (('id', 'id'), ('name', 'name'), ('enabled', 'enabled'), ('unified_job_template', 'unified_job_template')),
        },
        {
            'key': 'execution_environments',
            'singular': 'execution environment',
            'plural': 'execution environments',
            'patterns': (r'\bexecution environments?\b',),
            'model': models.ExecutionEnvironment,
            'select_related': ('organization',),
            'order_by': ('organization__name', 'name', 'id'),
            'fields': (('id', 'id'), ('name', 'name'), ('image', 'image'), ('organization', 'organization')),
        },
        {
            'key': 'instance_groups',
            'singular': 'instance group',
            'plural': 'instance groups',
            'patterns': (r'\binstance groups?\b',),
            'model': models.InstanceGroup,
            'order_by': ('name', 'id'),
            'fields': (('id', 'id'), ('name', 'name'), ('is_container_group', 'is_container_group')),
        },
        {
            'key': 'instances',
            'singular': 'instance',
            'plural': 'instances',
            'patterns': (r'\binstances?\b', r'\bnodes?\b'),
            'model': models.Instance,
            'order_by': ('hostname', 'id'),
            'fields': (('id', 'id'), ('hostname', 'hostname'), ('node_type', 'node_type'), ('enabled', 'enabled')),
        },
        {
            'key': 'jobs',
            'singular': 'job',
            'plural': 'jobs',
            'patterns': (r'\bjobs?\b',),
            'model': models.Job,
            'select_related': ('job_template', 'inventory', 'project'),
            'order_by': ('-created', '-id'),
            'fields': (
                ('id', 'id'),
                ('name', 'name'),
                ('status', 'status'),
                ('job_template', 'job_template'),
                ('inventory', 'inventory'),
                ('project', 'project'),
            ),
        },
        {
            'key': 'catalog_items',
            'singular': 'catalog item',
            'plural': 'catalog items',
            'patterns': (r'\bcatalog items?\b', r'\bmarketplace items?\b'),
            'model': models.CatalogItem,
            'select_related': ('organization',),
            'order_by': ('organization__name', 'name', 'id'),
            'fields': (('id', 'id'), ('name', 'name'), ('organization', 'organization')),
        },
        {
            'key': 'catalog_deployments',
            'singular': 'catalog deployment',
            'plural': 'catalog deployments',
            'patterns': (r'\bcatalog deployments?\b', r'\bdeployments?\b'),
            'model': models.CatalogDeployment,
            'select_related': ('catalog_item', 'catalog_item__organization', 'owner'),
            'order_by': ('-created', '-id'),
            'fields': (
                ('id', 'id'),
                ('name', 'name'),
                ('status', 'status'),
                ('catalog_item', 'catalog_item'),
                ('organization', 'catalog_item.organization'),
                ('owner', 'owner'),
            ),
        },
        {
            'key': 'cloud_provider_connections',
            'singular': 'cloud provider connection',
            'plural': 'cloud provider connections',
            'patterns': (r'\bcloud (?:provider )?connections?\b',),
            'model': models.CloudProviderConnection,
            'select_related': ('organization',),
            'order_by': ('organization__name', 'provider_id', 'name', 'id'),
            'fields': (('id', 'id'), ('name', 'name'), ('provider', 'provider_id'), ('organization', 'organization')),
        },
    ]


def _visible_resource_spec_by_key(key: str):
    for spec in _visible_resource_specs():
        if spec['key'] == key:
            return spec
    return None


def _visible_resource_queryset(user, spec):
    queryset_factory = spec.get('queryset')
    if queryset_factory:
        queryset = queryset_factory(user)
    else:
        queryset = get_user_queryset(user, spec['model']).distinct()
        select_related = spec.get('select_related') or ()
        if select_related:
            queryset = queryset.select_related(*select_related)
    order_by = spec.get('order_by') or ('id',)
    return queryset.order_by(*order_by)


def _resource_context_row(obj, spec) -> dict:
    row = {}
    for output_key, attr_path in spec.get('fields') or ():
        row[output_key] = _related_context(_read_attr_path(obj, attr_path))
    return row


def _visible_resource_rows(user, spec, limit=_AI_CONTEXT_LIST_LIMIT) -> list[dict]:
    return [_resource_context_row(obj, spec) for obj in _visible_resource_queryset(user, spec)[:limit]]


def _visible_host_count(user) -> int:
    host_spec = _visible_resource_spec_by_key('hosts')
    return _visible_resource_queryset(user, host_spec).count()


def _visible_awx_counts(user) -> dict:
    counts = {}
    for spec in _visible_resource_specs():
        counts[spec['key']] = _visible_resource_queryset(user, spec).count()
    return counts


def _visible_awx_context_snapshot(user, limit=_AI_CONTEXT_LIST_LIMIT) -> dict:
    resources = {}
    for spec in _visible_resource_specs():
        queryset = _visible_resource_queryset(user, spec)
        count = queryset.count()
        items = [_resource_context_row(obj, spec) for obj in queryset[:limit]]
        resources[spec['key']] = {
            'label': spec['plural'],
            'count': count,
            'shown': len(items),
            'truncated': count > len(items),
            'items': items,
        }
    return {
        'notes': [
            'All resources are filtered by the requesting user RBAC permissions.',
            'Credential secrets, passwords, private keys, tokens, and variable values are intentionally excluded.',
            'Host resources exclude constructed-inventory synthetic hosts so host facts match the dashboard host count.',
        ],
        'resources': resources,
    }


def _latest_user_message(messages: list) -> str:
    for message in reversed(messages):
        if message.get('role') == 'user':
            return message.get('content', '')
    return ''


def _is_count_question(message: str, resource_pattern: str) -> bool:
    normalized = re.sub(r'\s+', ' ', message.lower()).strip()
    if not re.search(resource_pattern, normalized):
        return False
    return bool(re.search(r'\bhow many\b', normalized) or re.search(r'\b(count|total|number of)\b', normalized) or re.search(r'\bdo we have\b', normalized))


def _is_list_question(message: str, resource_pattern: str) -> bool:
    normalized = re.sub(r'\s+', ' ', message.lower()).strip()
    if not re.search(resource_pattern, normalized):
        return False
    if re.search(r'\bhow to\b|\b(create|add|configure|set up|setup)\b', normalized):
        return False
    return bool(
        re.search(r'\b(list|show|display)\b', normalized)
        or re.search(r'\bwhat (?:are|is)\b', normalized)
        or re.search(r'\bwhich\b', normalized)
        or re.search(r'\bnames? of\b', normalized)
        or re.search(r'\ball\b', normalized)
    )


def _resource_spec_matches_message(message: str, spec: dict) -> bool:
    normalized = re.sub(r'\s+', ' ', message.lower()).strip()
    return any(re.search(pattern, normalized) for pattern in spec.get('patterns') or ())


def _format_context_value(value):
    if value is None or value == '':
        return None
    if isinstance(value, dict):
        return value.get('name') or value.get('username') or value.get('id')
    if isinstance(value, bool):
        return 'yes' if value else 'no'
    return value


def _format_resource_list_item(row: dict) -> str:
    label = row.get('name') or row.get('username') or row.get('hostname') or row.get('id')
    detail_parts = []
    if row.get('id') is not None:
        detail_parts.append(f"id: {row['id']}")
    for key, value in row.items():
        if key in {'id', 'name', 'username', 'hostname'}:
            continue
        formatted_value = _format_context_value(value)
        if formatted_value is not None:
            detail_parts.append(f"{key.replace('_', ' ')}: {formatted_value}")
    if detail_parts:
        return f"- {label} ({', '.join(str(part) for part in detail_parts)})"
    return f"- {label}"


def _answer_resource_count(user, spec: dict) -> str:
    count = _visible_resource_queryset(user, spec).count()
    noun = spec['singular'] if count == 1 else spec['plural']
    return f'There are {count} {noun} visible to you in AWX.'


def _answer_resource_list(user, spec: dict) -> str:
    queryset = _visible_resource_queryset(user, spec)
    count = queryset.count()
    if count == 0:
        return f'There are no {spec["plural"]} visible to you in AWX.'

    rows = [_resource_context_row(obj, spec) for obj in queryset[:_AI_DIRECT_LIST_LIMIT]]
    noun = spec['singular'] if count == 1 else spec['plural']
    lines = [f'There are {count} {noun} visible to you in AWX:']
    lines.extend(_format_resource_list_item(row) for row in rows)
    if count > len(rows):
        lines.append(f'- Showing the first {len(rows)} of {count}. Narrow the question to list a specific inventory, organization, or resource type.')
    return '\n'.join(lines)


def _try_answer_awx_fact_question(user, messages: list) -> str | None:
    latest_message = _latest_user_message(messages)
    for spec in _visible_resource_specs():
        if not _resource_spec_matches_message(latest_message, spec):
            continue
        resource_pattern = '|'.join(f'(?:{pattern})' for pattern in spec.get('patterns') or ())
        if _is_count_question(latest_message, resource_pattern):
            return _answer_resource_count(user, spec)
        if _is_list_question(latest_message, resource_pattern):
            return _answer_resource_list(user, spec)
    return None


def _system_prompt_with_awx_context(system_prompt: str, user) -> str:
    try:
        snapshot = _visible_awx_context_snapshot(user)
    except Exception as exc:
        logger.warning('Could not build AI assistant AWX context: %s', exc)
        return system_prompt

    context = (
        '\n\nLive AWX context for the requesting user:\n'
        f'{json.dumps(_json_safe(snapshot), indent=2)}\n'
        'Use this live context when answering direct questions about this AWX instance. '
        'Do not say you cannot see the AWX instance when the answer is present in this context. '
        'If a resource list is truncated, say so and ask the user to narrow by inventory, organization, or resource type.'
    )
    return f'{system_prompt}{context}'


def _json_safe(value):
    if hasattr(value, 'pk') and hasattr(value, '_meta'):
        return value.pk
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(v) for v in value]
    try:
        json.dumps(value)
    except TypeError:
        return str(value)
    return value


def _redact_sensitive(value):
    if isinstance(value, dict):
        redacted = {}
        is_password_survey_question = str(value.get('type', '')).lower() == 'password'
        for key, child in value.items():
            if is_password_survey_question and key == 'default' and child not in ('', None):
                redacted[key] = '$encrypted$'
            elif _SENSITIVE_KEY_RE.search(str(key)):
                redacted[key] = '$encrypted$'
            else:
                redacted[key] = _redact_sensitive(child)
        return redacted
    if isinstance(value, list):
        return [_redact_sensitive(child) for child in value]
    return value


def _normalize_resource_type(resource_type: str | None) -> str | None:
    if not isinstance(resource_type, str):
        return None
    normalized = resource_type.strip().lower().replace('-', '_').replace(' ', '_')
    return _AI_RESOURCE_TYPE_ALIASES.get(normalized)


def _normalize_credential_reference_target(target_type: str | None) -> str | None:
    if not isinstance(target_type, str):
        return None
    normalized = target_type.strip().lower().replace('-', '_').replace(' ', '_')
    return _AI_CREDENTIAL_REFERENCE_TARGET_ALIASES.get(normalized)


def _normalize_role_assignment_target(target_type: str | None) -> str | None:
    if not isinstance(target_type, str):
        return None
    normalized = target_type.strip().lower().replace('-', '_').replace(' ', '_')
    return _AI_ROLE_ASSIGNMENT_TARGET_ALIASES.get(normalized)


def _normalize_survey_spec_target(target_type: str | None) -> str | None:
    if not isinstance(target_type, str):
        return None
    normalized = target_type.strip().lower().replace('-', '_').replace(' ', '_')
    return _AI_SURVEY_SPEC_TARGET_ALIASES.get(normalized)


def _normalize_role_field(role_field: str | None) -> str | None:
    if not isinstance(role_field, str):
        return None
    normalized = role_field.strip().lower().replace('-', '_').replace(' ', '_')
    if not normalized:
        return None
    normalized = _AI_ROLE_FIELD_ALIASES.get(normalized, normalized)
    if not normalized.endswith('_role'):
        normalized = f'{normalized}_role'
    return normalized


def _normalize_ai_plan(raw_plan) -> dict:
    if isinstance(raw_plan, list):
        plan = {'operations': raw_plan}
    elif isinstance(raw_plan, dict):
        plan = dict(raw_plan)
    else:
        raise ValueError(_('AI resource plan must be a JSON object or an array of operations.'))

    operations = plan.get('operations', plan.get('actions'))
    if not isinstance(operations, list) or not operations:
        raise ValueError(_('AI resource plan must include a non-empty operations array.'))
    if len(operations) > 20:
        raise ValueError(_('AI resource plan can include at most 20 operations.'))

    normalized_operations = []
    for index, operation in enumerate(operations, start=1):
        if not isinstance(operation, dict):
            raise ValueError(_('Each AI resource plan operation must be an object.'))
        normalized = dict(operation)
        normalized['id'] = str(normalized.get('id') or f'op-{index}')
        operation_name = str(normalized.get('operation') or normalized.get('action') or 'create').strip().lower()
        normalized['operation'] = _AI_OPERATION_ALIASES.get(operation_name, operation_name)
        normalized['resource_type'] = _normalize_resource_type(normalized.get('resource_type') or normalized.get('resource') or normalized.get('type'))
        normalized['data'] = normalized.get('data') if isinstance(normalized.get('data'), dict) else {}
        normalized_operations.append(normalized)

    plan['operations'] = normalized_operations
    plan.pop('actions', None)
    return plan


def _extract_json_plan(content: str) -> dict:
    if not isinstance(content, str) or not content.strip():
        raise ValueError(_('The AI provider did not return a resource plan.'))

    text = content.strip()
    code_fence = re.search(r'```(?:json)?\s*(.*?)```', text, re.DOTALL | re.IGNORECASE)
    if code_fence:
        text = code_fence.group(1).strip()

    try:
        return _normalize_ai_plan(json.loads(text))
    except (json.JSONDecodeError, ValueError):
        start_positions = [position for position in (text.find('{'), text.find('[')) if position >= 0]
        if not start_positions:
            raise ValueError(_('The AI provider response did not contain JSON.'))
        start = min(start_positions)
        end = max(text.rfind('}'), text.rfind(']'))
        if end <= start:
            raise ValueError(_('The AI provider response did not contain a complete JSON plan.'))
        return _normalize_ai_plan(json.loads(text[start : end + 1]))


def _limited_queryset_values(user, model, fields, limit=15):
    rows = []
    for obj in get_user_queryset(user, model).order_by('id')[:limit]:
        row = {}
        for field in fields:
            row[field] = getattr(obj, field, None)
        rows.append(row)
    return rows


def _ai_authoring_context(user) -> dict:
    return {
        'counts': _visible_awx_counts(user),
        'hosts': _visible_resource_rows(user, _visible_resource_spec_by_key('hosts'), limit=20),
        'groups': _visible_resource_rows(user, _visible_resource_spec_by_key('groups'), limit=20),
        'credentials': _limited_queryset_values(user, models.Credential, ('id', 'name', 'credential_type_id', 'organization_id'), limit=20),
        'organizations': _limited_queryset_values(user, models.Organization, ('id', 'name'), limit=20),
        'users': _limited_queryset_values(user, models.User, ('id', 'username', 'first_name', 'last_name'), limit=20),
        'teams': _limited_queryset_values(user, models.Team, ('id', 'name', 'organization_id'), limit=20),
        'inventories': _limited_queryset_values(user, models.Inventory, ('id', 'name', 'kind', 'organization_id'), limit=20),
        'inventory_sources': _limited_queryset_values(user, models.InventorySource, ('id', 'name', 'inventory_id', 'source', 'source_project_id'), limit=20),
        'projects': _limited_queryset_values(user, models.Project, ('id', 'name', 'scm_type', 'local_path', 'organization_id'), limit=20),
        'job_templates': _limited_queryset_values(user, models.JobTemplate, ('id', 'name', 'project_id', 'inventory_id', 'organization_id'), limit=20),
        'terraform_job_templates': _limited_queryset_values(user, models.TerraformJobTemplate, ('id', 'name', 'project_id', 'target_inventory_id'), limit=20),
        'workflow_job_templates': _limited_queryset_values(user, models.WorkflowJobTemplate, ('id', 'name', 'organization_id'), limit=20),
        'workflow_job_template_nodes': _limited_queryset_values(
            user,
            models.WorkflowJobTemplateNode,
            ('id', 'workflow_job_template_id', 'unified_job_template_id', 'identifier'),
            limit=20,
        ),
        'schedules': _limited_queryset_values(user, models.Schedule, ('id', 'name', 'enabled', 'unified_job_template_id'), limit=20),
        'catalog_items': _limited_queryset_values(user, models.CatalogItem, ('id', 'name', 'organization_id'), limit=20),
    }


def _ai_resource_plan_system_prompt(user, context: dict) -> str:
    authoring_context = _ai_authoring_context(user)
    return (
        'You turn natural-language AWX authoring requests into a typed JSON resource plan. '
        'Return only JSON. Do not include markdown fences or prose.\n\n'
        'Supported resource_type values: credential_reference, inventory, smart_inventory, constructed_inventory, project, project_file, '
        'inventory_source, job_template, workflow_job_template, schedule, catalog_item, role_assignment, survey_spec.\n'
        'Supported operation values: create, update, attach, detach. '
        'Use attach/detach only for credential_reference and role_assignment operations.\n'
        'For smart_inventory, data must include organization and a valid AWX host_filter expression, for example '
        '"name__icontains=web" or "groups__name=webservers". Smart inventory plans are previewed against visible hosts and groups before save.\n'
        'For constructed_inventory, data must include organization and may include input_inventories as an array of existing inventory IDs plus '
        'source_vars as a YAML or JSON object for the constructed inventory source. Constructed inventory plans are validated and previewed '
        'against visible input inventories, source hosts, and source groups before save.\n'
        'For credential_reference, data must include target_resource_type ("job_template", "inventory_source", "schedule", or '
        '"workflow_job_template_node"), target_id, and credential. These operations only link or unlink existing credentials and must never '
        'include credential secrets. Schedule and workflow-node credential references are saved launch prompts and require the related template '
        'to ask for credentials on launch.\n'
        'For role_assignment, data must include target_resource_type, target_id, role_field or role, and exactly one user/user_id or team/team_id. '
        'Use existing users and teams from the supplied context. Common role values include admin, read, use, execute, update, member, and auditor.\n'
        'For survey_spec, data must include target_resource_type ("job_template", "workflow_job_template", or "terraform_job_template"), target_id, '
        'and either survey_spec or questions. Use update/create to replace the survey, or set merge=true to add/update questions by variable. '
        'Survey question types must be text, textarea, password, multiplechoice, multiselect, integer, or float. '
        'Never put secrets in survey defaults.\n'
        'To create a new manual project workspace, use resource_type "project" with scm_type "", create_local_path true, organization, '
        'name, and optionally local_path. Later operations in the same plan may reference it with project_ref set to the project operation id.\n'
        'For project_file, data must include an existing manual project ID or project_ref, relative path, and UTF-8 text content. '
        'Use it to author playbooks, roles, defaults, vars, handlers, templates, meta, README, and ansible.cfg files inside a project before '
        'creating or updating job templates that reference those playbooks. Do not target SCM-backed projects or hidden/source-control paths.\n'
        'Use existing numeric IDs from the supplied AWX context for related objects. '
        'Do not invent organization, project, inventory, workflow, user, team, or catalog item IDs. '
        'Do not include secrets, API keys, passwords, private keys, or credential input values.\n\n'
        'Schema:\n'
        '{"name": "short plan name", "description": "short summary", "operations": ['
        '{"id": "stable id", "operation": "create|update|attach|detach", "resource_type": "credential_reference|role_assignment|survey_spec|project_file|inventory|smart_inventory|constructed_inventory|project|inventory_source|job_template|workflow_job_template|schedule|catalog_item", '
        '"object_id": 123, "data": {"name": "...", "project_ref": "prior-project-op-id"}}]}\n\n'
        f'Current AWX context visible to the requester:\n{json.dumps(_json_safe(authoring_context), indent=2)}\n\n'
        f'Route/resource context supplied by the UI:\n{json.dumps(_json_safe(context or {}), indent=2)}'
    )


def _ai_provider_plan_from_prompt(request, prompt: str, context: dict) -> tuple[dict, str, str]:
    if not getattr(settings, 'AI_ENABLED', False):
        raise AIProviderError(
            _('The AI assistant is not enabled. Enable it in Settings → AI Assistant.'),
            status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    rate_limit = getattr(settings, 'AI_RATE_LIMIT_PER_MINUTE', 20)
    if not _check_rate_limit(request.user.pk, rate_limit):
        raise AIProviderError(_('Rate limit exceeded. Please wait before sending another message.'), status.HTTP_429_TOO_MANY_REQUESTS)

    provider = getattr(settings, 'AI_PROVIDER', 'openai')
    api_key = getattr(settings, 'AI_API_KEY', '')
    if provider != 'openai_codex' and not api_key:
        raise AIProviderError(_('AI_API_KEY is not configured. Set it in Settings → AI Assistant.'), status.HTTP_503_SERVICE_UNAVAILABLE)

    defaults = _PROVIDER_DEFAULTS.get(provider, _PROVIDER_DEFAULTS['openai'])
    model = _openai_codex_effective_default_model() if provider == 'openai_codex' else getattr(settings, 'AI_MODEL_NAME', '') or defaults['model']
    content = _call_ai_provider(
        provider,
        model,
        [{'role': 'user', 'content': prompt}],
        min(getattr(settings, 'AI_MAX_TOKENS', 2048), 4096),
        _ai_resource_plan_system_prompt(request.user, context),
        api_key,
        getattr(settings, 'AI_API_URL', ''),
    )
    return _extract_json_plan(content), provider, model


def _serializer_context(request):
    return {'request': request, 'view': SimpleNamespace(kwargs={}, request=request)}


def _operation_payload(operation: dict, resource_config: dict) -> dict:
    data = {}
    data.update(resource_config.get('default_data') or {})
    data.update(operation.get('data') or {})
    data.update(resource_config.get('forced_data') or {})
    return data


def _coerce_positive_int_list(value) -> tuple[list[int] | None, list]:
    if value is None:
        return None, []
    if isinstance(value, (str, int)):
        raw_values = [value]
    elif isinstance(value, (list, tuple, set)):
        raw_values = list(value)
    else:
        return [], [value]

    ids = []
    invalid = []
    seen = set()
    for raw_value in raw_values:
        value_for_parse = raw_value.get('id', raw_value.get('pk')) if isinstance(raw_value, dict) else raw_value
        parsed = _positive_int(value_for_parse)
        if not parsed:
            invalid.append(raw_value)
            continue
        if parsed in seen:
            continue
        ids.append(parsed)
        seen.add(parsed)
    return ids, invalid


def _pop_constructed_input_inventory_ids(data: dict) -> tuple[list[int] | None, list]:
    for field in _CONSTRUCTED_INPUT_INVENTORY_FIELDS:
        if field in data:
            return _coerce_positive_int_list(data.pop(field))
    return None, []


def _operation_organization_id(data: dict, validated_data: dict, instance=None) -> int | None:
    organization = validated_data.get('organization') or data.get('organization')
    if organization is None and instance is not None:
        return instance.organization_id
    if hasattr(organization, 'pk'):
        return organization.pk
    return _positive_int(organization)


def _host_preview_row(host) -> dict:
    return {'id': host.pk, 'name': host.name, 'inventory': _related_context(host.inventory), 'enabled': host.enabled}


def _group_preview_row(group) -> dict:
    return {'id': group.pk, 'name': group.name, 'inventory': _related_context(group.inventory)}


def _inventory_preview_row(inventory) -> dict:
    return {'id': inventory.pk, 'name': inventory.name, 'kind': inventory.kind, 'organization': _related_context(inventory.organization)}


def _source_vars_preview(source_vars) -> tuple[dict, dict | None]:
    try:
        parsed = parse_yaml_or_json(source_vars or '', silent_failure=False)
    except Exception as exc:
        return {}, {'source_vars': [str(exc)]}
    return parsed, None


def _validate_constructed_input_inventories(request, input_inventory_ids: list[int] | None, organization_id: int | None, instance=None) -> tuple[list, dict]:
    if input_inventory_ids is None:
        if instance is None:
            return [], {}
        input_inventory_ids = list(instance.input_inventories.values_list('pk', flat=True))

    if not input_inventory_ids:
        return [], {}

    visible = get_user_queryset(request.user, models.Inventory).filter(pk__in=input_inventory_ids).select_related('organization')
    inventory_by_id = {inventory.pk: inventory for inventory in visible}
    errors = {}
    missing_ids = [inventory_id for inventory_id in input_inventory_ids if inventory_id not in inventory_by_id]
    if missing_ids:
        errors['input_inventories'] = [_('Input inventories were not found or are not accessible: {}.').format(', '.join(str(value) for value in missing_ids))]

    constructed_ids = [inventory.pk for inventory in inventory_by_id.values() if inventory.kind == 'constructed']
    if constructed_ids:
        errors.setdefault('input_inventories', []).append(
            _('Constructed inventories cannot be used as input inventories: {}.').format(', '.join(str(value) for value in constructed_ids))
        )

    if organization_id:
        cross_org_ids = [inventory.pk for inventory in inventory_by_id.values() if inventory.organization_id and inventory.organization_id != organization_id]
        if cross_org_ids:
            errors.setdefault('input_inventories', []).append(
                _('Input inventories must belong to the constructed inventory organization: {}.').format(', '.join(str(value) for value in cross_org_ids))
            )

    ordered = [inventory_by_id[inventory_id] for inventory_id in input_inventory_ids if inventory_id in inventory_by_id]
    return ordered, errors


def _smart_inventory_preview(request, data: dict, validated_data: dict, instance=None) -> dict | None:
    host_filter = validated_data.get('host_filter') or data.get('host_filter') or (instance.host_filter if instance is not None else None)
    if not host_filter:
        return None

    organization_id = _operation_organization_id(data, validated_data, instance)
    filter_qs = SmartFilter.query_from_string(host_filter)
    host_qs = _visible_hosts_queryset(request.user).filter(pk__in=filter_qs.values('pk'))
    if organization_id:
        host_qs = host_qs.filter(inventory__organization_id=organization_id)
    host_qs = host_qs.select_related('inventory').order_by('inventory__name', 'name', 'pk').distinct()
    host_count = host_qs.count()
    hosts = [_host_preview_row(host) for host in host_qs[:_AI_RESOURCE_PREVIEW_LIMIT]]

    group_qs = get_user_queryset(request.user, models.Group).filter(hosts__in=host_qs).exclude(inventory__kind='constructed')
    if organization_id:
        group_qs = group_qs.filter(inventory__organization_id=organization_id)
    group_qs = group_qs.select_related('inventory').order_by('inventory__name', 'name', 'pk').distinct()
    group_count = group_qs.count()
    groups = [_group_preview_row(group) for group in group_qs[:_AI_RESOURCE_PREVIEW_LIMIT]]

    return {
        'type': 'smart_inventory',
        'host_filter': host_filter,
        'organization': organization_id,
        'matched_hosts_count': host_count,
        'matched_hosts': hosts,
        'matched_groups_count': group_count,
        'matched_groups': groups,
        'truncated': host_count > len(hosts) or group_count > len(groups),
    }


def _constructed_inventory_preview(request, data: dict, validated_data: dict, input_inventories: list, source_vars, instance=None) -> dict:
    parsed_source_vars = _source_vars_preview(source_vars)[0]
    input_inventory_ids = [inventory.pk for inventory in input_inventories]
    organization_id = _operation_organization_id(data, validated_data, instance)

    host_qs = _visible_hosts_queryset(request.user).filter(inventory_id__in=input_inventory_ids)
    group_qs = get_user_queryset(request.user, models.Group).filter(inventory_id__in=input_inventory_ids).exclude(inventory__kind='constructed')
    if organization_id:
        host_qs = host_qs.filter(inventory__organization_id=organization_id)
        group_qs = group_qs.filter(inventory__organization_id=organization_id)

    host_qs = host_qs.select_related('inventory').order_by('inventory__name', 'name', 'pk').distinct()
    group_qs = group_qs.select_related('inventory').order_by('inventory__name', 'name', 'pk').distinct()
    host_count = host_qs.count()
    group_count = group_qs.count()
    hosts = [_host_preview_row(host) for host in host_qs[:_AI_RESOURCE_PREVIEW_LIMIT]]
    groups = [_group_preview_row(group) for group in group_qs[:_AI_RESOURCE_PREVIEW_LIMIT]]

    return {
        'type': 'constructed_inventory',
        'organization': organization_id,
        'input_inventories_count': len(input_inventories),
        'input_inventories': [_inventory_preview_row(inventory) for inventory in input_inventories],
        'source_hosts_count': host_count,
        'source_hosts': hosts,
        'source_groups_count': group_count,
        'source_groups': groups,
        'source_vars_keys': [str(key) for key in parsed_source_vars.keys()],
        'source_vars': _redact_sensitive(_json_safe(parsed_source_vars)),
        'truncated': host_count > len(hosts) or group_count > len(groups),
    }


def _is_ai_project_workspace_requested(data: dict) -> bool:
    return any(_coerce_ai_bool(data.get(flag), default=False) for flag in _AI_PROJECT_WORKSPACE_FLAGS)


def _pop_ai_project_workspace_fields(data: dict):
    for key in (*_AI_PROJECT_WORKSPACE_FLAGS, 'project_ref', 'project_operation_id'):
        data.pop(key, None)


def _normalize_ai_project_local_path(data: dict) -> tuple[str | None, str | None]:
    raw_local_path = data.get('local_path') or data.get('workspace') or data.get('workspace_name')
    if raw_local_path in (None, ''):
        base = slugify(str(data.get('name') or 'project')).strip('-') or 'project'
        raw_local_path = f'ai-{base}'
    if not isinstance(raw_local_path, str):
        return None, _('Project local_path must be a string.')

    local_path = raw_local_path.strip()
    local_path = local_path.replace('\\', '/')
    path = PurePosixPath(local_path)
    if path.is_absolute() or len(path.parts) != 1:
        return None, _('Project local_path must be a single relative directory name.')
    local_path = path.name
    if not local_path or local_path.startswith(('.', '_')):
        return None, _('Project local_path cannot be empty, hidden, or AWX-reserved.')
    if len(local_path) > _AI_PROJECT_LOCAL_PATH_MAX_LENGTH:
        return None, _('Project local_path exceeds the AI workspace length limit.')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*', local_path):
        return None, _('Project local_path can only contain letters, numbers, dots, underscores, or hyphens.')
    return local_path, None


def _unique_ai_project_local_path(local_path: str) -> str:
    root = Path(settings.PROJECTS_ROOT).resolve(strict=False)
    candidate = local_path
    for index in range(2, 101):
        if not models.Project.objects.filter(local_path=candidate).exists() and not (root / candidate).exists():
            return candidate
        suffix = f'-{index}'
        candidate = f'{local_path[: _AI_PROJECT_LOCAL_PATH_MAX_LENGTH - len(suffix)]}{suffix}'
    return local_path


def _resolve_ai_project_workspace_path(local_path: str) -> tuple[Path | None, Path | None, str | None]:
    root_path = Path(settings.PROJECTS_ROOT).resolve(strict=False)
    workspace_path = (root_path / local_path).resolve(strict=False)
    try:
        workspace_path.relative_to(root_path)
    except ValueError:
        return None, None, _('Project local_path escapes PROJECTS_ROOT.')
    return root_path, workspace_path, None


def _prepare_ai_project_workspace(serializer_data: dict, result: dict, context: dict | None) -> bool:
    should_create_workspace = _is_ai_project_workspace_requested(serializer_data)
    if not should_create_workspace:
        _pop_ai_project_workspace_fields(serializer_data)
        return True

    serializer_data['scm_type'] = ''
    local_path, local_path_error = _normalize_ai_project_local_path(serializer_data)
    if local_path_error:
        result['errors'] = {'local_path': [local_path_error]}
        return False
    if not serializer_data.get('local_path'):
        local_path = _unique_ai_project_local_path(local_path)
    elif models.Project.objects.filter(local_path=local_path).exists():
        result['errors'] = {'local_path': [_('This path is already being used by another manual project.')]}
        return False

    root_path, workspace_path, workspace_error = _resolve_ai_project_workspace_path(local_path)
    if workspace_error:
        result['errors'] = {'local_path': [workspace_error]}
        return False
    if workspace_path.exists():
        result['errors'] = {'local_path': [_('AI project workspace path already exists.')]}
        return False

    serializer_data['local_path'] = local_path
    _pop_ai_project_workspace_fields(serializer_data)

    if context is not None:
        try:
            root_path.mkdir(parents=True, exist_ok=True)
            workspace_path.mkdir()
        except OSError as exc:
            result['errors'] = {'local_path': [_('Could not create AI project workspace: {}').format(exc)]}
            return False
        context.setdefault('workspace_rollbacks', []).append({'path': workspace_path})
        result.setdefault('preview', {})['created_workspace'] = local_path
    return True


def _rollback_ai_project_workspaces(context: dict | None):
    if not context:
        return
    for rollback in reversed(context.get('workspace_rollbacks') or []):
        workspace_path = rollback.get('path')
        if not workspace_path:
            continue
        try:
            if workspace_path.exists():
                shutil.rmtree(workspace_path)
        except OSError:
            logger.warning('Could not roll back AI-created project workspace %s', workspace_path, exc_info=True)


def _extract_ai_reference(value, allow_plain=False) -> str | None:
    if isinstance(value, dict):
        value = value.get('ref') or value.get('$ref') or value.get('operation_id')
        allow_plain = True
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.startswith('$'):
            stripped = stripped[1:]
            return stripped or None
        if allow_plain:
            return stripped or None
    return None


def _resolve_ai_operation_references(operation: dict, references: dict) -> tuple[dict, dict]:
    resolved = dict(operation)
    data = dict(resolved.get('data') or {})
    errors = {}

    project_ref = (
        data.pop('project_ref', None)
        or data.pop('project_operation_id', None)
        or resolved.pop('project_ref', None)
        or _extract_ai_reference(data.get('project'))
    )
    project_ref = _extract_ai_reference(project_ref, allow_plain=True)
    if project_ref:
        referenced_operation = references.get(project_ref)
        if not referenced_operation:
            errors['project_ref'] = [_('Referenced project operation was not found or has not been applied yet.')]
        elif referenced_operation.get('resource_type') != 'project':
            errors['project_ref'] = [_('project_ref must reference a project operation.')]
        else:
            data['project'] = referenced_operation.get('object_id')
            resolved['_resolved_refs'] = {'project': project_ref}

    resolved['data'] = data
    return resolved, errors


def _reference_error_ai_operation(operation: dict, errors: dict) -> dict:
    return {
        'id': operation.get('id'),
        'operation': operation.get('operation'),
        'resource_type': operation.get('resource_type'),
        'valid': False,
        'errors': errors,
        'warnings': [],
        'data': _redact_sensitive(_json_safe(operation.get('data') or {})),
    }


def _record_ai_operation_reference(references: dict, source_operation: dict, saved_operation: dict):
    reference_id = source_operation.get('id')
    if reference_id and saved_operation.get('valid') and saved_operation.get('object_id'):
        references[str(reference_id)] = saved_operation


def _scrub_ai_rolled_back_apply_operations(operations: list):
    for operation in operations:
        if operation.get('operation') == 'create':
            operation.pop('object', None)
            operation.pop('object_id', None)
        if operation.get('resource_type') == 'project_file':
            operation.pop('project_id', None)
            operation.pop('target', None)


def _project_file_payload(operation: dict) -> dict:
    data = operation.get('data') or {}
    return {
        'project_id': _positive_int(
            data.get('project') or data.get('project_id') or data.get('target_id') or operation.get('object_id') or operation.get('target_id')
        ),
        'path': data.get('path') or data.get('file') or data.get('file_path') or data.get('relative_path'),
        'content': data.get('content'),
        'overwrite': data.get('overwrite'),
    }


def _coerce_ai_bool(value, default=False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {'true', '1', 'yes', 'y', 'on'}:
            return True
        if normalized in {'false', '0', 'no', 'n', 'off', ''}:
            return False
    return bool(value)


def _normalize_ai_project_file_path(raw_path) -> tuple[str | None, str | None]:
    if not isinstance(raw_path, str) or not raw_path.strip():
        return None, _('Project file path is required.')
    normalized = raw_path.strip().replace('\\', '/')
    relative_path = PurePosixPath(normalized)
    if relative_path.is_absolute():
        return None, _('Project file path must be relative.')
    if not relative_path.name:
        return None, _('Project file path must include a file name.')

    parts = relative_path.parts
    if any(part in {'', '.', '..'} for part in parts):
        return None, _('Project file path cannot contain empty, current, or parent directory segments.')
    if any(part in _AI_PROJECT_FILE_BLOCKED_PARTS or part.startswith('.') for part in parts):
        return None, _('Project file path cannot write hidden or source-control paths.')
    if relative_path.suffix.lower() not in _AI_PROJECT_FILE_ALLOWED_SUFFIXES:
        return None, _('Project file extension is not allowed for AI authoring.')
    return relative_path.as_posix(), None


def _resolve_ai_project_file_path(project, relative_path: str) -> tuple[Path | None, Path | None, str | None]:
    project_path = project.get_project_path(check_if_exists=False)
    if not project_path:
        return None, None, _('Project does not have a local path.')

    base_path = Path(project_path).resolve(strict=False)
    target_path = (base_path / relative_path).resolve(strict=False)
    try:
        target_path.relative_to(base_path)
    except ValueError:
        return None, None, _('Project file path escapes the project directory.')
    return base_path, target_path, None


def _validate_ai_project_file_operation(request, operation: dict) -> dict:
    action = operation.get('operation')
    payload = _project_file_payload(operation)
    overwrite = _coerce_ai_bool(payload['overwrite'], default=(action == 'update'))
    result = {
        'id': operation.get('id'),
        'operation': action,
        'resource_type': 'project_file',
        'valid': False,
        'errors': {},
        'warnings': [],
        'data': {
            'project': payload['project_id'],
            'path': payload['path'],
            'overwrite': overwrite,
        },
    }

    if action not in {'create', 'update'}:
        result['errors'] = {'operation': [_('Unsupported AI project file operation.')]}
        return result
    if not payload['project_id']:
        result['errors'] = {'project': [_('Project is required for project_file operations.')]}
        return result

    try:
        project = models.Project.objects.get(pk=payload['project_id'])
    except models.Project.DoesNotExist:
        result['errors'] = {'project': [_('Project not found.')]}
        return result
    if not request.user.can_access(models.Project, 'read', project):
        result['errors'] = {'project': [_('Project not found or not accessible.')]}
        return result
    if not request.user.can_access(models.Project, 'change', project):
        result['errors'] = {'permission': [_('You do not have permission to write project files.')]}
        return result
    if project.scm_type:
        result['errors'] = {'project': [_('AI project file authoring only supports manual projects.')]}
        return result

    relative_path, path_error = _normalize_ai_project_file_path(payload['path'])
    if path_error:
        result['errors'] = {'path': [path_error]}
        return result

    content = payload['content']
    if not isinstance(content, str):
        result['errors'] = {'content': [_('Project file content must be a string.')]}
        return result
    if '\x00' in content:
        result['errors'] = {'content': [_('Project file content cannot include null bytes.')]}
        return result
    content_bytes = len(content.encode('utf-8'))
    if content_bytes > _AI_PROJECT_FILE_MAX_BYTES:
        result['errors'] = {'content': [_('Project file content exceeds the 256 KiB AI authoring limit.')]}
        return result

    base_path, target_path, target_error = _resolve_ai_project_file_path(project, relative_path)
    if target_error:
        result['errors'] = {'path': [target_error]}
        return result
    if target_path.exists() and target_path.is_dir():
        result['errors'] = {'path': [_('Project file path points to a directory.')]}
        return result
    if target_path.exists() and action == 'create' and not overwrite:
        result['errors'] = {'path': [_('Project file already exists; use update or set overwrite=true.')]}
        return result

    opa_input = {
        'triggered_by': 'ai_resource_action',
        'user': {'id': request.user.id, 'username': request.user.username, 'is_superuser': request.user.is_superuser},
        'operation': action,
        'resource_type': 'project_file',
        'object_id': project.pk,
        'data': {'project': project.pk, 'path': relative_path, 'content_bytes': content_bytes, 'overwrite': overwrite},
    }
    if not check_opa_policy('awx/ai_action/allow', opa_input):
        result['errors'] = {'opa': [_('This AI operation was denied by an OPA policy guardrail.')]}
        return result

    result.update(
        {
            'valid': True,
            'object_id': project.pk,
            'project_id': project.pk,
            'path': relative_path,
            'content_bytes': content_bytes,
            'validated_data': {'project': project.pk, 'path': relative_path, 'content_bytes': content_bytes, 'overwrite': overwrite},
            'target': _target_summary('project', project),
            'preview': {
                'type': 'project_file',
                'project': project.pk,
                'path': relative_path,
                'content_bytes': content_bytes,
                'will_create': not target_path.exists(),
                'will_overwrite': target_path.exists(),
            },
            '_project_file': True,
            '_project': project,
            '_base_path': base_path,
            '_target_path': target_path,
            '_content': content,
        }
    )
    result['data'] = {'project': project.pk, 'path': relative_path, 'content_bytes': content_bytes, 'overwrite': overwrite}
    return result


def _operation_object_id(operation: dict) -> int | None:
    raw_id = operation.get('object_id', operation.get('id') if operation.get('operation') == 'update' else None)
    if raw_id is None:
        raw_id = operation.get('pk')
    try:
        return int(raw_id)
    except (TypeError, ValueError):
        return None


def _positive_int(value) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _credential_reference_payload(operation: dict) -> dict:
    data = operation.get('data') or {}
    return {
        'target_resource_type': _normalize_credential_reference_target(
            data.get('target_resource_type') or data.get('target_type') or data.get('parent_resource_type') or operation.get('target_resource_type')
        ),
        'target_id': _positive_int(data.get('target_id') or data.get('object_id') or operation.get('target_id') or operation.get('object_id')),
        'credential_id': _positive_int(data.get('credential') or data.get('credential_id') or operation.get('credential_id')),
    }


def _role_assignment_payload(operation: dict) -> dict:
    data = operation.get('data') or {}
    raw_role = data.get('role')
    raw_actor_type = data.get('actor_type') or operation.get('actor_type')
    actor_type = str(raw_actor_type).strip().lower().replace('-', '_') if isinstance(raw_actor_type, str) else ''
    actor_id = _positive_int(data.get('actor_id') or operation.get('actor_id'))
    user_id = _positive_int(data.get('user') or data.get('user_id') or operation.get('user_id'))
    team_id = _positive_int(data.get('team') or data.get('team_id') or operation.get('team_id'))

    if actor_type == 'user' and actor_id and not user_id:
        user_id = actor_id
    if actor_type == 'team' and actor_id and not team_id:
        team_id = actor_id

    role_id = _positive_int(data.get('role_id') or operation.get('role_id') or raw_role)
    return {
        'target_resource_type': _normalize_role_assignment_target(
            data.get('target_resource_type') or data.get('target_type') or data.get('parent_resource_type') or operation.get('target_resource_type')
        ),
        'target_id': _positive_int(data.get('target_id') or data.get('object_id') or operation.get('target_id') or operation.get('object_id')),
        'role_id': role_id,
        'role_field': _normalize_role_field(data.get('role_field') or data.get('role_name') or operation.get('role_field') or (None if role_id else raw_role)),
        'user_id': user_id,
        'team_id': team_id,
    }


def _coerce_ai_bool(value, default=False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {'1', 'true', 'yes', 'on'}:
            return True
        if normalized in {'0', 'false', 'no', 'off'}:
            return False
    return bool(value)


def _normalize_survey_question_type(value) -> str:
    if value is None:
        return 'text'
    normalized = str(value).strip().lower().replace('-', '_').replace(' ', '_')
    return _AI_SURVEY_TYPE_ALIASES.get(normalized, normalized)


def _coerce_survey_int(value):
    if value in ('', None):
        return value
    if isinstance(value, bool):
        return value
    try:
        return int(value)
    except (TypeError, ValueError):
        return value


def _normalize_survey_choices(value):
    if isinstance(value, (list, tuple, set)):
        return '\n'.join(str(choice).strip() for choice in value if str(choice).strip())
    return value


def _normalize_ai_survey_question(question, index: int) -> tuple[dict | None, dict | None]:
    if not isinstance(question, dict):
        return None, {'survey_spec': [_('Survey question {} must be an object.').format(index)]}

    normalized = dict(question)
    variable = normalized.get('variable') or normalized.get('name') or normalized.get('key')
    if not isinstance(variable, str) or not variable.strip():
        return None, {'variable': [_('Survey question {} must include variable.').format(index)]}

    question_type = _normalize_survey_question_type(normalized.get('type') or normalized.get('question_type'))
    normalized['index'] = _coerce_survey_int(normalized.get('index', index))
    normalized['variable'] = variable.strip()
    normalized['question_name'] = str(normalized.get('question_name') or normalized.get('label') or normalized.get('title') or variable).strip()
    normalized['question_description'] = str(normalized.get('question_description') or normalized.get('description') or '').strip()
    normalized['required'] = _coerce_ai_bool(normalized.get('required'), default=False)
    normalized['type'] = question_type
    normalized['choices'] = _normalize_survey_choices(normalized.get('choices', ''))
    if 'min' in normalized:
        normalized['min'] = _coerce_survey_int(normalized['min'])
    if 'max' in normalized:
        normalized['max'] = _coerce_survey_int(normalized['max'])
    return normalized, None


def _normalize_ai_survey_spec_input(data: dict) -> tuple[dict | None, dict | None]:
    raw_spec = data.get('survey_spec') or data.get('survey') or {}
    if raw_spec and not isinstance(raw_spec, dict):
        return None, {'survey_spec': [_('survey_spec must be an object.')]}

    questions = data.get('questions')
    if questions is None and data.get('question') is not None:
        questions = [data.get('question')]
    if questions is None and isinstance(raw_spec, dict):
        questions = raw_spec.get('questions', raw_spec.get('spec', []))
    if not isinstance(questions, list):
        return None, {'spec': [_('Survey spec questions must be a list.')]}

    normalized_questions = []
    for index, question in enumerate(questions):
        normalized_question, error = _normalize_ai_survey_question(question, index)
        if error:
            return None, error
        normalized_questions.append(normalized_question)

    return (
        {
            'name': str(data.get('name') or raw_spec.get('name') or 'AI generated survey').strip(),
            'description': str(data.get('description') or raw_spec.get('description') or '').strip(),
            'spec': normalized_questions,
        },
        None,
    )


def _survey_spec_payload(operation: dict) -> dict:
    data = operation.get('data') or {}
    mode = data.get('mode') or data.get('strategy') or operation.get('mode') or ''
    return {
        'target_resource_type': _normalize_survey_spec_target(
            data.get('target_resource_type') or data.get('target_type') or data.get('parent_resource_type') or operation.get('target_resource_type')
        ),
        'target_id': _positive_int(data.get('target_id') or data.get('object_id') or operation.get('target_id') or operation.get('object_id')),
        'merge': _coerce_ai_bool(data.get('merge'), default=False) or str(mode).strip().lower() in {'add', 'append', 'merge', 'patch'},
        'survey_enabled': _coerce_ai_bool(data.get('survey_enabled', data.get('enabled')), default=True),
    }


def _merge_survey_specs(existing_spec: dict, incoming_spec: dict) -> dict:
    if not isinstance(existing_spec, dict) or not isinstance(existing_spec.get('spec'), list) or not existing_spec.get('spec'):
        return incoming_spec

    merged_questions = []
    position_by_variable = {}
    for question in existing_spec.get('spec', []):
        if not isinstance(question, dict):
            continue
        merged_questions.append(dict(question))
        variable = question.get('variable')
        if variable:
            position_by_variable[variable] = len(merged_questions) - 1

    for question in incoming_spec.get('spec', []):
        variable = question.get('variable')
        if variable in position_by_variable:
            merged_questions[position_by_variable[variable]] = question
        else:
            position_by_variable[variable] = len(merged_questions)
            merged_questions.append(question)

    for index, question in enumerate(merged_questions):
        question['index'] = index

    return {
        'name': incoming_spec.get('name') or existing_spec.get('name') or 'AI generated survey',
        'description': incoming_spec.get('description') if incoming_spec.get('description') != '' else existing_spec.get('description', ''),
        'spec': merged_questions,
    }


def _validate_ai_survey_spec_schema(new_spec: dict, old_spec: dict) -> dict | None:
    schema_errors = {}
    for field, expect_type, type_label in [('name', str, 'string'), ('description', str, 'string'), ('spec', list, 'list of items')]:
        if field not in new_spec:
            schema_errors[field] = [_("Field '{}' is missing from survey spec.").format(field)]
        elif not isinstance(new_spec[field], expect_type):
            schema_errors[field] = [_("Expected {} for field '{}', received {} type.").format(type_label, field, type(new_spec[field]).__name__)]
    if isinstance(new_spec.get('spec'), list) and len(new_spec['spec']) < 1:
        schema_errors['spec'] = [_("'spec' doesn't contain any items.")]
    if schema_errors:
        return schema_errors

    variable_set = set()
    old_spec_dict = models.JobTemplate.pivot_spec(old_spec or {})
    for index, survey_item in enumerate(new_spec['spec']):
        if not isinstance(survey_item, dict):
            return {'survey_spec': [_('Survey question {} is not a json object.').format(index)]}
        for field_name in ['type', 'question_name', 'variable', 'required']:
            if field_name not in survey_item:
                return {field_name: [_("'{}' missing from survey question {}").format(field_name, index)]}
            allow_types = bool if field_name == 'required' else str
            type_label = 'boolean' if field_name == 'required' else 'string'
            if not isinstance(survey_item[field_name], allow_types):
                return {field_name: [_("'{}' in survey question {} expected to be {}.").format(field_name, index, type_label)]}
        if survey_item['variable'] in variable_set:
            return {'variable': [_("'variable' '{}' duplicated in survey question {}.").format(survey_item['variable'], index)]}
        variable_set.add(survey_item['variable'])

        qtype = survey_item['type']
        if qtype not in SURVEY_TYPE_MAPPING:
            return {
                'type': [_("'{}' in survey question {} is not one of '{}' allowed question types.").format(qtype, index, ', '.join(SURVEY_TYPE_MAPPING.keys()))]
            }
        if 'default' in survey_item and isinstance(survey_item['default'], str) and survey_item['default'] != '':
            if qtype == 'integer':
                try:
                    survey_item['default'] = int(survey_item['default'])
                except ValueError:
                    pass
            elif qtype == 'float':
                try:
                    survey_item['default'] = float(survey_item['default'])
                except ValueError:
                    pass
        if 'default' in survey_item and survey_item['default'] != '' and not isinstance(survey_item['default'], SURVEY_TYPE_MAPPING[qtype]):
            type_label = qtype if qtype in ['integer', 'float'] else 'string'
            return {'default': [_('Default value in survey question {} expected to be {}.').format(index, type_label)]}
        for key in ['min', 'max']:
            if key in survey_item and survey_item[key] is not None and not isinstance(survey_item[key], int):
                return {key: [_('The {} limit in survey question {} expected to be integer.').format(key, index)]}
        if qtype in {'multiselect', 'multiplechoice'}:
            if 'choices' not in survey_item:
                return {'choices': [_('Survey question {} of type {} must specify choices.').format(index, qtype)]}
            survey_item['choices'] = _normalize_survey_choices(survey_item['choices'])
            if not survey_item['choices']:
                return {'choices': [_('Survey question {} of type {} must specify at least one choice.').format(index, qtype)]}
            if 'default' in survey_item:
                if isinstance(survey_item['default'], str):
                    survey_item['default'] = '\n'.join(choice for choice in survey_item['default'].splitlines() if choice.strip())
                    list_of_defaults = survey_item['default'].splitlines()
                else:
                    list_of_defaults = survey_item['default']
                if qtype == 'multiplechoice' and len(list_of_defaults) > 1:
                    return {'default': [_('Multiple Choice (Single Select) can only have one default value.')]}
                choices = survey_item['choices'].splitlines()
                if any(item not in choices for item in list_of_defaults):
                    return {'default': [_('Default choice must be answered from the choices listed.')]}

        if 'default' in survey_item and isinstance(survey_item['default'], str) and survey_item['default'].startswith('$encrypted$'):
            if qtype != 'password':
                return {'default': [_('$encrypted$ is reserved for password question defaults.')]}
            old_element = old_spec_dict.get(survey_item['variable'], {})
            old_default = old_element.get('default')
            if not (isinstance(old_default, str) and (old_default.startswith('$encrypted$') or old_default == '')):
                return {'default': [_('$encrypted$ may not be used for a new survey password default.')]}
            survey_item['default'] = old_default
        elif qtype == 'password' and 'default' in survey_item and survey_item['default']:
            survey_item['default'] = encrypt_value(survey_item['default'])
    return None


def _survey_spec_preview(target_type: str, target, survey_spec: dict, survey_enabled: bool) -> dict:
    return {
        'type': 'survey_spec',
        'target': _target_summary(target_type, target),
        'survey_enabled': survey_enabled,
        'question_count': len(survey_spec.get('spec') or []),
        'questions': [
            {
                'index': question.get('index'),
                'variable': question.get('variable'),
                'question_name': question.get('question_name'),
                'type': question.get('type'),
                'required': question.get('required'),
            }
            for question in survey_spec.get('spec') or []
        ],
    }


def _validation_exception_detail(exc) -> dict:
    if hasattr(exc, 'detail'):
        detail = _json_safe(exc.detail)
        return detail if isinstance(detail, dict) else {'detail': detail}
    if hasattr(exc, 'message_dict'):
        return _json_safe(exc.message_dict)
    if hasattr(exc, 'messages'):
        return {'detail': _json_safe(exc.messages)}
    return {'detail': [str(exc)]}


def _validate_credential_reference_relation(action: str, target_type: str, target, credential) -> dict | None:
    if action != 'attach':
        return None

    if target_type in {'schedule', 'workflow_job_template_node'}:
        if not target.unified_job_template:
            return {'msg': _('Cannot assign credential when related template is null.')}

        ask_mapping = target.unified_job_template.get_ask_mapping()
        if 'credentials' not in ask_mapping:
            return {'msg': _('Related template cannot accept credentials on launch.')}
        if credential.passwords_needed:
            return {'msg': _('Credential that requires user input on launch cannot be used in saved launch configuration.')}

        ask_field_name = ask_mapping['credentials']
        if not getattr(target.unified_job_template, ask_field_name):
            return {'msg': _('Related template is not configured to accept credentials on launch.')}
        if credential.unique_hash() in [cred.unique_hash() for cred in target.credentials.all()]:
            return {
                'msg': _('This launch configuration already provides a {credential_type} credential.').format(
                    credential_type=credential.unique_hash(display=True)
                )
            }
        if credential.pk in target.unified_job_template.credentials.values_list('pk', flat=True):
            return {'msg': _('Related template already uses {credential_type} credential.').format(credential_type=credential.name)}
        return None

    if target_type == 'job_template':
        if credential.unique_hash() in [cred.unique_hash() for cred in target.credentials.all()]:
            return {'error': _('Cannot assign multiple {credential_type} credentials.').format(credential_type=credential.unique_hash(display=True))}
        kind = credential.credential_type.kind
        if kind not in ('ssh', 'vault', 'cloud', 'net', 'kubernetes'):
            return {'error': _('Cannot assign a Credential of kind `{}`.').format(kind)}
        return None

    if target_type == 'inventory_source':
        if target.credentials.exists():
            return {'msg': _('Source already has credential assigned.')}
        error = models.InventorySource.cloud_credential_validation(target.source, credential)
        if error:
            return {'msg': error}
        return None

    return {'target_resource_type': [_('Unsupported credential reference target.')]}


def _role_summary(role) -> dict:
    summary = {
        'id': role.pk,
        'name': role.name,
        'description': role.description,
        'role_field': role.role_field,
    }
    content_object = role.content_object
    if content_object is not None:
        summary['resource_id'] = role.object_id
        summary['resource_name'] = getattr(content_object, 'name', getattr(content_object, 'username', ''))
        summary['resource_type'] = content_object._meta.model_name
    return summary


def _target_summary(resource_type: str, target) -> dict:
    return {
        'id': target.pk,
        'name': getattr(target, 'name', getattr(target, 'username', '')),
        'resource_type': resource_type,
    }


def _actor_summary(actor_type: str, actor) -> dict:
    if actor_type == 'user':
        return {
            'id': actor.pk,
            'type': 'user',
            'username': actor.username,
            'name': actor.get_full_name(),
        }
    return {
        'id': actor.pk,
        'type': 'team',
        'name': actor.name,
        'organization': actor.organization_id,
    }


def _validate_ai_credential_reference_operation(request, operation: dict) -> dict:
    action = operation.get('operation')
    payload = _credential_reference_payload(operation)
    result = {
        'id': operation.get('id'),
        'operation': action,
        'resource_type': operation.get('resource_type'),
        'valid': False,
        'errors': {},
        'warnings': [],
        'data': _redact_sensitive(_json_safe(operation.get('data') or {})),
        'target_resource_type': payload['target_resource_type'],
        'target_id': payload['target_id'],
        'credential_id': payload['credential_id'],
    }

    if action not in {'attach', 'detach'}:
        result['errors'] = {'operation': [_('Credential references only support attach and detach operations.')]}
        return result
    if not payload['target_resource_type']:
        result['errors'] = {'target_resource_type': [_('Unsupported or missing credential reference target resource type.')]}
        return result
    if not payload['target_id']:
        result['errors'] = {'target_id': [_('Credential reference operations must include target_id.')]}
        return result
    if not payload['credential_id']:
        result['errors'] = {'credential': [_('Credential reference operations must include credential.')]}
        return result

    target_config = _AI_CREDENTIAL_REFERENCE_TARGETS[payload['target_resource_type']]
    target_model = target_config['model']
    try:
        target = target_model.objects.get(pk=payload['target_id'])
    except target_model.DoesNotExist:
        result['errors'] = {'target_id': [_('Target object not found.')]}
        return result
    if not request.user.can_access(target_model, 'read', target):
        result['errors'] = {'target_id': [_('Target object not found or not accessible.')]}
        return result

    try:
        credential = models.Credential.objects.get(pk=payload['credential_id'])
    except models.Credential.DoesNotExist:
        result['errors'] = {'credential': [_('Credential not found.')]}
        return result

    access_action = 'attach' if action == 'attach' else 'unattach'
    permission_allowed = request.user.can_access(target_model, access_action, target, credential, 'credentials', operation.get('data') or {})
    if not permission_allowed:
        result['errors'] = {'permission': [_('You do not have permission to apply this credential reference operation.')]}
        return result

    relation_errors = _validate_credential_reference_relation(action, payload['target_resource_type'], target, credential)
    if relation_errors is not None:
        result['errors'] = _json_safe(relation_errors)
        return result

    opa_input = {
        'triggered_by': 'ai_resource_action',
        'user': {'id': request.user.id, 'username': request.user.username, 'is_superuser': request.user.is_superuser},
        'operation': action,
        'resource_type': 'credential_reference',
        'object_id': payload['target_id'],
        'target_resource_type': payload['target_resource_type'],
        'credential_id': payload['credential_id'],
    }
    if not check_opa_policy('awx/ai_action/allow', opa_input):
        result['errors'] = {'opa': [_('This AI operation was denied by an OPA policy guardrail.')]}
        return result

    result['valid'] = True
    result['validated_data'] = _json_safe(payload)
    result['_credential_reference'] = True
    result['_target'] = target
    result['_target_config'] = target_config
    result['_credential'] = credential
    return result


def _validate_ai_role_assignment_operation(request, operation: dict) -> dict:
    action = operation.get('operation')
    payload = _role_assignment_payload(operation)
    result = {
        'id': operation.get('id'),
        'operation': action,
        'resource_type': operation.get('resource_type'),
        'valid': False,
        'errors': {},
        'warnings': [],
        'data': _redact_sensitive(_json_safe(operation.get('data') or {})),
        'target_resource_type': payload['target_resource_type'],
        'target_id': payload['target_id'],
        'role_id': payload['role_id'],
        'role_field': payload['role_field'],
        'user_id': payload['user_id'],
        'team_id': payload['team_id'],
    }

    if action not in {'attach', 'detach'}:
        result['errors'] = {'operation': [_('Role assignments only support attach and detach operations.')]}
        return result
    if not payload['target_resource_type']:
        result['errors'] = {'target_resource_type': [_('Unsupported or missing role-assignment target resource type.')]}
        return result
    if not payload['target_id']:
        result['errors'] = {'target_id': [_('Role assignment operations must include target_id.')]}
        return result
    if not payload['role_id'] and not payload['role_field']:
        result['errors'] = {'role_field': [_('Role assignment operations must include role_field or role_id.')]}
        return result
    if bool(payload['user_id']) == bool(payload['team_id']):
        result['errors'] = {'actor': [_('Role assignment operations must include exactly one user or team.')]}
        return result

    target_config = _AI_ROLE_ASSIGNMENT_TARGETS[payload['target_resource_type']]
    target_model = target_config['model']
    try:
        target = target_model.objects.get(pk=payload['target_id'])
    except target_model.DoesNotExist:
        result['errors'] = {'target_id': [_('Target object not found.')]}
        return result
    if not request.user.can_access(target_model, 'read', target):
        result['errors'] = {'target_id': [_('Target object not found or not accessible.')]}
        return result

    role = None
    if payload['role_id']:
        try:
            role = models.Role.objects.get(pk=payload['role_id'])
        except models.Role.DoesNotExist:
            result['errors'] = {'role_id': [_('Role not found.')]}
            return result
        if role.content_object != target:
            result['errors'] = {'role_id': [_('Role does not belong to the requested target object.')]}
            return result
        if payload['role_field'] and role.role_field != payload['role_field']:
            result['errors'] = {'role_field': [_('role_field does not match the requested role_id.')]}
            return result
        payload['role_field'] = role.role_field
        result['role_field'] = role.role_field
    else:
        role = getattr(target, payload['role_field'], None)
        if not isinstance(role, models.Role):
            result['errors'] = {'role_field': [_('Target object does not support this role field.')]}
            return result

    actor_type = 'user' if payload['user_id'] else 'team'
    actor_model = models.User if actor_type == 'user' else models.Team
    actor_id = payload['user_id'] or payload['team_id']
    try:
        actor = actor_model.objects.get(pk=actor_id)
    except actor_model.DoesNotExist:
        result['errors'] = {actor_type: [_('Role assignment actor not found.')]}
        return result

    if actor_type == 'team' and role.is_singleton():
        result['errors'] = {'role': [_('You cannot grant system-level permissions to a team.')]}
        return result
    if actor_type == 'team' and isinstance(role.content_object, models.Organization) and role.role_field in {'member_role', 'admin_role'}:
        result['errors'] = {'role': [_('You cannot assign an Organization participation role as a child role for a Team.')]}
        return result

    if action == 'attach':
        content_object = role.content_object
        if hasattr(content_object, 'validate_role_assignment'):
            try:
                content_object.validate_role_assignment(actor, role_definition=None, requesting_user=request.user)
            except (DRFValidationError, DjangoValidationError) as exc:
                result['errors'] = _validation_exception_detail(exc)
                return result

    relationship = 'members' if actor_type == 'user' else 'member_role.parents'
    access_action = 'attach' if action == 'attach' else 'unattach'
    permission_allowed = request.user.can_access(
        models.Role,
        access_action,
        role,
        actor,
        relationship,
        operation.get('data') or {},
        skip_sub_obj_read_check=False,
    )
    if not permission_allowed:
        result['errors'] = {'permission': [_('You do not have permission to apply this role assignment operation.')]}
        return result

    opa_input = {
        'triggered_by': 'ai_resource_action',
        'user': {'id': request.user.id, 'username': request.user.username, 'is_superuser': request.user.is_superuser},
        'operation': action,
        'resource_type': 'role_assignment',
        'object_id': payload['target_id'],
        'target_resource_type': payload['target_resource_type'],
        'role_id': role.pk,
        'role_field': role.role_field,
        'actor_type': actor_type,
        'actor_id': actor.pk,
    }
    if not check_opa_policy('awx/ai_action/allow', opa_input):
        result['errors'] = {'opa': [_('This AI operation was denied by an OPA policy guardrail.')]}
        return result

    result['valid'] = True
    result['role_id'] = role.pk
    result['actor_type'] = actor_type
    result['actor_id'] = actor.pk
    result['target'] = _target_summary(payload['target_resource_type'], target)
    result['role'] = _role_summary(role)
    result['actor'] = _actor_summary(actor_type, actor)
    result['validated_data'] = _json_safe({**payload, 'role_id': role.pk, 'role_field': role.role_field, 'actor_type': actor_type, 'actor_id': actor.pk})
    result['_role_assignment'] = True
    result['_target'] = target
    result['_target_config'] = target_config
    result['_role'] = role
    result['_actor'] = actor
    result['_actor_type'] = actor_type
    return result


def _validate_ai_survey_spec_operation(request, operation: dict) -> dict:
    action = operation.get('operation')
    payload = _survey_spec_payload(operation)
    result = {
        'id': operation.get('id'),
        'operation': action,
        'resource_type': operation.get('resource_type'),
        'valid': False,
        'errors': {},
        'warnings': [],
        'data': _redact_sensitive(_json_safe(operation.get('data') or {})),
        'target_resource_type': payload['target_resource_type'],
        'target_id': payload['target_id'],
    }

    if action not in {'create', 'update'}:
        result['errors'] = {'operation': [_('Survey spec operations only support create and update operations.')]}
        return result
    if not payload['target_resource_type']:
        result['errors'] = {'target_resource_type': [_('Unsupported or missing survey target resource type.')]}
        return result
    if not payload['target_id']:
        result['errors'] = {'target_id': [_('Survey spec operations must include target_id.')]}
        return result

    target_config = _AI_SURVEY_SPEC_TARGETS[payload['target_resource_type']]
    target_model = target_config['model']
    try:
        target = target_model.objects.get(pk=payload['target_id'])
    except target_model.DoesNotExist:
        result['errors'] = {'target_id': [_('Target object not found.')]}
        return result
    if not request.user.can_access(target_model, 'read', target):
        result['errors'] = {'target_id': [_('Target object not found or not accessible.')]}
        return result

    incoming_spec, spec_error = _normalize_ai_survey_spec_input(operation.get('data') or {})
    if spec_error:
        result['errors'] = spec_error
        return result

    survey_spec = _merge_survey_specs(target.survey_spec or {}, incoming_spec) if payload['merge'] else incoming_spec
    schema_error = _validate_ai_survey_spec_schema(survey_spec, target.survey_spec or {})
    if schema_error:
        result['errors'] = schema_error
        return result

    if not request.user.can_access(target_model, 'change', target, None):
        result['errors'] = {'permission': [_('You do not have permission to apply this survey spec operation.')]}
        return result

    opa_input = {
        'triggered_by': 'ai_resource_action',
        'user': {'id': request.user.id, 'username': request.user.username, 'is_superuser': request.user.is_superuser},
        'operation': action,
        'resource_type': 'survey_spec',
        'object_id': target.pk,
        'target_resource_type': payload['target_resource_type'],
        'data': _redact_sensitive(_json_safe(operation.get('data') or {})),
    }
    if not check_opa_policy('awx/ai_action/allow', opa_input):
        result['errors'] = {'opa': [_('This AI operation was denied by an OPA policy guardrail.')]}
        return result

    result['valid'] = True
    result['object_id'] = target.pk
    result['survey_enabled'] = payload['survey_enabled']
    result['question_count'] = len(survey_spec.get('spec') or [])
    result['target'] = _target_summary(payload['target_resource_type'], target)
    result['validated_data'] = _redact_sensitive(
        _json_safe(
            {
                **payload,
                'survey_spec': survey_spec,
                'question_count': len(survey_spec.get('spec') or []),
            }
        )
    )
    result['preview'] = _survey_spec_preview(payload['target_resource_type'], target, survey_spec, payload['survey_enabled'])
    result['_survey_spec'] = True
    result['_target'] = target
    result['_target_config'] = target_config
    result['_survey_spec_to_save'] = survey_spec
    result['_survey_enabled_to_save'] = payload['survey_enabled']
    return result


def _validate_ai_operation(request, operation: dict, context: dict | None = None) -> dict:
    resource_type = operation.get('resource_type')
    action = operation.get('operation')
    result = {
        'id': operation.get('id'),
        'operation': action,
        'resource_type': resource_type,
        'valid': False,
        'errors': {},
        'warnings': [],
        'data': _redact_sensitive(_json_safe(operation.get('data') or {})),
    }

    if resource_type == 'credential_reference':
        return _validate_ai_credential_reference_operation(request, operation)
    if resource_type == 'role_assignment':
        return _validate_ai_role_assignment_operation(request, operation)
    if resource_type == 'survey_spec':
        return _validate_ai_survey_spec_operation(request, operation)
    if resource_type == 'project_file':
        return _validate_ai_project_file_operation(request, operation)

    if resource_type not in _AI_RESOURCE_TYPES:
        result['errors'] = {'resource_type': [_('Unsupported AI resource type.')]}
        return result
    if action not in {'create', 'update'}:
        result['errors'] = {'operation': [_('Unsupported AI resource operation.')]}
        return result

    resource_config = _AI_RESOURCE_TYPES[resource_type]
    model = resource_config['model']
    serializer_class = resource_config['serializer']
    data = _operation_payload(operation, resource_config)
    serializer_data = dict(data)
    constructed_input_inventory_ids = None
    constructed_input_inventories = None
    constructed_source_vars = None

    instance = None
    object_id = _operation_object_id(operation)
    if action == 'update':
        if object_id is None:
            result['errors'] = {'object_id': [_('Update operations must include object_id.')]}
            return result
        try:
            instance = model.objects.get(pk=object_id)
        except model.DoesNotExist:
            result['errors'] = {'object_id': [_('Object not found.')]}
            return result
        if not request.user.can_access(model, 'read', instance):
            result['errors'] = {'object_id': [_('Object not found or not accessible.')]}
            return result

    if resource_type == 'project' and action == 'create':
        if not _prepare_ai_project_workspace(serializer_data, result, context):
            result['data'] = _redact_sensitive(_json_safe(serializer_data))
            return result
    else:
        _pop_ai_project_workspace_fields(serializer_data)
    result['data'] = _redact_sensitive(_json_safe(serializer_data))

    if resource_type == 'constructed_inventory':
        constructed_input_inventory_ids, invalid_input_inventory_values = _pop_constructed_input_inventory_ids(serializer_data)
        if invalid_input_inventory_values:
            result['errors'] = {'input_inventories': [_('Input inventories must be a list of positive integer IDs.')]}
            return result

        constructed_source_vars = serializer_data.get('source_vars')
        if constructed_source_vars is None and instance is not None:
            inv_src = instance.inventory_sources.first()
            constructed_source_vars = inv_src.source_vars if inv_src is not None else ''
        source_vars_error = _source_vars_preview(constructed_source_vars)[1]
        if source_vars_error:
            result['errors'] = source_vars_error
            return result

    serializer = serializer_class(instance=instance, data=serializer_data, partial=(action == 'update'), context=_serializer_context(request))
    if not serializer.is_valid():
        result['errors'] = _json_safe(serializer.errors)
        return result

    if resource_type == 'constructed_inventory':
        organization_id = _operation_organization_id(serializer_data, serializer.validated_data, instance)
        constructed_input_inventories, input_inventory_errors = _validate_constructed_input_inventories(
            request, constructed_input_inventory_ids, organization_id, instance=instance
        )
        if input_inventory_errors:
            result['errors'] = input_inventory_errors
            return result

    permission_allowed = (
        request.user.can_access(model, 'add', serializer.validated_data)
        if action == 'create'
        else request.user.can_access(model, 'change', instance, serializer.validated_data)
    )
    if not permission_allowed:
        result['errors'] = {'permission': [_('You do not have permission to apply this operation.')]}
        return result

    opa_input = {
        'triggered_by': 'ai_resource_action',
        'user': {'id': request.user.id, 'username': request.user.username, 'is_superuser': request.user.is_superuser},
        'operation': action,
        'resource_type': resource_type,
        'object_id': object_id,
        'data': _redact_sensitive(_json_safe(serializer_data)),
    }
    if not check_opa_policy('awx/ai_action/allow', opa_input):
        result['errors'] = {'opa': [_('This AI operation was denied by an OPA policy guardrail.')]}
        return result

    result['valid'] = True
    result['_serializer'] = serializer
    result['_model'] = model
    result['_resource_config'] = resource_config
    result['validated_data'] = _redact_sensitive(_json_safe(serializer.validated_data))
    if resource_type == 'smart_inventory':
        result['preview'] = _smart_inventory_preview(request, serializer_data, serializer.validated_data, instance=instance)
    if resource_type == 'constructed_inventory':
        if constructed_input_inventory_ids is not None:
            result['_constructed_input_inventories'] = constructed_input_inventories
            result['input_inventory_ids'] = [inventory.pk for inventory in constructed_input_inventories]
            result['validated_data']['input_inventories'] = [inventory.pk for inventory in constructed_input_inventories]
        result['preview'] = _constructed_inventory_preview(
            request,
            serializer_data,
            serializer.validated_data,
            constructed_input_inventories or [],
            constructed_source_vars,
            instance=instance,
        )
    return result


def _serialize_ai_resource(request, serializer_class, obj) -> dict:
    return _json_safe(serializer_class(instance=obj, context=_serializer_context(request)).data)


def _credential_summary(credential) -> dict:
    return {
        'id': credential.pk,
        'name': credential.name,
        'credential_type': credential.credential_type_id,
        'kind': credential.credential_type.kind,
    }


def _save_ai_credential_reference_operation(request, validation: dict) -> dict:
    target = validation['_target']
    credential = validation['_credential']
    if validation.get('operation') == 'attach':
        target.credentials.add(credential)
    else:
        target.credentials.remove(credential)

    validation['object'] = _serialize_ai_resource(request, validation['_target_config']['serializer'], target)
    validation['object_id'] = target.pk
    validation['target_id'] = target.pk
    validation['credential_id'] = credential.pk
    validation['credential'] = _credential_summary(credential)
    validation.pop('_credential_reference', None)
    validation.pop('_target', None)
    validation.pop('_target_config', None)
    validation.pop('_credential', None)
    return validation


def _save_ai_role_assignment_operation(request, validation: dict) -> dict:
    target = validation['_target']
    role = validation['_role']
    actor = validation['_actor']
    actor_type = validation['_actor_type']

    if actor_type == 'user':
        if validation.get('operation') == 'attach':
            role.members.add(actor)
        else:
            role.members.remove(actor)
    elif validation.get('operation') == 'attach':
        actor.member_role.children.add(role)
    else:
        actor.member_role.children.remove(role)

    validation['object_id'] = target.pk
    validation['target_id'] = target.pk
    validation['target'] = _target_summary(validation['target_resource_type'], target)
    validation['role_id'] = role.pk
    validation['role_field'] = role.role_field
    validation['role'] = _role_summary(role)
    validation['actor_type'] = actor_type
    validation['actor_id'] = actor.pk
    validation['actor'] = _actor_summary(actor_type, actor)
    validation.pop('_role_assignment', None)
    validation.pop('_target', None)
    validation.pop('_target_config', None)
    validation.pop('_role', None)
    validation.pop('_actor', None)
    validation.pop('_actor_type', None)
    return validation


def _save_ai_survey_spec_operation(request, validation: dict) -> dict:
    target = validation['_target']
    target.survey_spec = validation['_survey_spec_to_save']
    target.survey_enabled = validation['_survey_enabled_to_save']
    target.save(update_fields=['survey_spec', 'survey_enabled'])

    validation['object'] = _serialize_ai_resource(request, validation['_target_config']['serializer'], target)
    validation['object_id'] = target.pk
    validation['target_id'] = target.pk
    validation['target'] = _target_summary(validation['target_resource_type'], target)
    validation.pop('_survey_spec', None)
    validation.pop('_target', None)
    validation.pop('_target_config', None)
    validation.pop('_survey_spec_to_save', None)
    validation.pop('_survey_enabled_to_save', None)
    return validation


def _apply_ai_project_file_operation(validation: dict):
    target_path = validation['_target_path']
    base_path = validation['_base_path']
    content = validation['_content']
    existed = target_path.exists()
    backup = target_path.read_bytes() if existed else None
    try:
        target_path.parent.mkdir(parents=True, exist_ok=True)
        target_path.write_text(content, encoding='utf-8')
    except OSError as exc:
        validation['valid'] = False
        validation['errors'] = {'path': [_('Could not write project file: {}').format(exc)]}
        return
    validation['_project_file_applied'] = True
    validation['_project_file_rollback'] = {
        'base_path': base_path,
        'target_path': target_path,
        'existed': existed,
        'backup': backup,
    }


def _rollback_ai_project_file_operation(validation: dict):
    rollback = validation.get('_project_file_rollback')
    if not rollback:
        return
    target_path = rollback['target_path']
    try:
        if rollback['existed']:
            target_path.write_bytes(rollback['backup'])
        elif target_path.exists():
            target_path.unlink()
            parent = target_path.parent
            base_path = rollback['base_path']
            while parent != base_path and parent.is_relative_to(base_path):
                try:
                    parent.rmdir()
                except OSError:
                    break
                parent = parent.parent
    except OSError:
        logger.warning('Could not roll back AI-authored project file %s', target_path, exc_info=True)


def _rollback_ai_project_file_operations(operations: list):
    for operation in reversed(operations):
        if operation.get('_project_file_applied'):
            _rollback_ai_project_file_operation(operation)


def _save_ai_project_file_operation(request, validation: dict) -> dict:
    if not validation.get('_project_file_applied'):
        _apply_ai_project_file_operation(validation)
    project = validation['_project']
    validation['object'] = {
        'project': project.pk,
        'project_name': project.name,
        'path': validation['path'],
        'content_bytes': validation['content_bytes'],
    }
    validation['object_id'] = project.pk
    validation['project_id'] = project.pk
    validation.pop('_project_file', None)
    validation.pop('_project', None)
    validation.pop('_base_path', None)
    validation.pop('_target_path', None)
    validation.pop('_content', None)
    return validation


def _save_ai_operation(request, validation: dict) -> dict:
    if validation.get('_credential_reference'):
        return _save_ai_credential_reference_operation(request, validation)
    if validation.get('_role_assignment'):
        return _save_ai_role_assignment_operation(request, validation)
    if validation.get('_survey_spec'):
        return _save_ai_survey_spec_operation(request, validation)
    if validation.get('_project_file'):
        return _save_ai_project_file_operation(request, validation)

    serializer = validation['_serializer']
    obj = serializer.save()
    constructed_input_inventories = validation.get('_constructed_input_inventories')
    if constructed_input_inventories is not None:
        obj.input_inventories.clear()
        if constructed_input_inventories:
            obj.input_inventories.add(*constructed_input_inventories)

    model = validation['_model']
    if validation.get('operation') == 'create' and model in permission_registry.all_registered_models and request.user:
        give_creator_permissions(request.user, obj)

    validation['object'] = _serialize_ai_resource(request, validation['_resource_config']['serializer'], obj)
    validation['object_id'] = obj.pk
    validation.pop('_serializer', None)
    validation.pop('_model', None)
    validation.pop('_resource_config', None)
    validation.pop('_constructed_input_inventories', None)
    return validation


def _audit_ai_resource_action(request, mode: str, plan: dict, operations: list, provider: str = '', model: str = ''):
    safe_operations = []
    is_error = False
    for operation in operations:
        is_error = is_error or not operation.get('valid')
        safe_operations.append(
            {
                'id': operation.get('id'),
                'operation': operation.get('operation'),
                'resource_type': operation.get('resource_type'),
                'valid': operation.get('valid'),
                'object_id': operation.get('object_id'),
                'target_resource_type': operation.get('target_resource_type'),
                'target_id': operation.get('target_id'),
                'project_id': operation.get('project_id'),
                'path': operation.get('path'),
                'content_bytes': operation.get('content_bytes'),
                'credential_id': operation.get('credential_id'),
                'role_id': operation.get('role_id'),
                'role_field': operation.get('role_field'),
                'actor_type': operation.get('actor_type'),
                'actor_id': operation.get('actor_id'),
                'user_id': operation.get('user_id'),
                'team_id': operation.get('team_id'),
                'question_count': operation.get('question_count'),
                'errors': _json_safe(operation.get('errors') or {}),
            }
        )

    changes = {
        'triggered_by': 'ai_assistant',
        'source': 'ai_resource_action',
        'mode': mode,
        'provider': provider,
        'model': model,
        'plan_name': plan.get('name', ''),
        'operation_count': len(operations),
        'is_error': is_error,
        'operations': safe_operations,
    }
    entry = models.ActivityStream.objects.create(
        operation='create',
        object1='ai_resource_action',
        object2=mode,
        changes=json.dumps(_redact_sensitive(_json_safe(changes))),
        actor=request.user,
    )
    entry.user.add(request.user)

    for operation in operations:
        resource_type = operation.get('resource_type')
        if resource_type == 'credential_reference':
            if not operation.get('valid'):
                continue
            target_config = _AI_CREDENTIAL_REFERENCE_TARGETS.get(operation.get('target_resource_type'))
            target_relation = target_config and target_config.get('audit_relation')
            target_id = operation.get('target_id') or operation.get('object_id')
            credential_id = operation.get('credential_id')
            if target_relation and target_id and hasattr(entry, target_relation):
                getattr(entry, target_relation).add(target_id)
            if credential_id:
                entry.credential.add(credential_id)
            continue
        if resource_type == 'role_assignment':
            if not operation.get('valid'):
                continue
            target_config = _AI_ROLE_ASSIGNMENT_TARGETS.get(operation.get('target_resource_type'))
            target_relation = target_config and target_config.get('audit_relation')
            target_id = operation.get('target_id') or operation.get('object_id')
            role_id = operation.get('role_id')
            user_id = operation.get('user_id') if operation.get('actor_type') != 'team' else None
            team_id = operation.get('team_id') if operation.get('actor_type') == 'team' else None
            actor_id = operation.get('actor_id')
            if operation.get('actor_type') == 'user' and not user_id:
                user_id = actor_id
            if operation.get('actor_type') == 'team' and not team_id:
                team_id = actor_id
            if target_relation and target_id and hasattr(entry, target_relation):
                getattr(entry, target_relation).add(target_id)
            if role_id:
                entry.role.add(role_id)
            if user_id:
                entry.user.add(user_id)
            if team_id:
                entry.team.add(team_id)
            continue
        if resource_type == 'survey_spec':
            if not operation.get('valid'):
                continue
            target_config = _AI_SURVEY_SPEC_TARGETS.get(operation.get('target_resource_type'))
            target_relation = target_config and target_config.get('audit_relation')
            target_id = operation.get('target_id') or operation.get('object_id')
            if target_relation and target_id and hasattr(entry, target_relation):
                getattr(entry, target_relation).add(target_id)
            continue
        if resource_type == 'project_file':
            if not operation.get('valid'):
                continue
            project_id = operation.get('project_id') or operation.get('object_id')
            if project_id:
                entry.project.add(project_id)
            continue

        object_id = operation.get('object_id')
        resource_config = _AI_RESOURCE_TYPES.get(resource_type)
        relation = resource_config and resource_config.get('audit_relation')
        if relation and object_id and hasattr(entry, relation):
            getattr(entry, relation).add(object_id)

    return entry


def _public_ai_operation_result(operation: dict) -> dict:
    return {key: value for key, value in operation.items() if not key.startswith('_')}


def _ai_plan_uses_operation_references(operations: list) -> bool:
    for operation in operations:
        data = operation.get('data') if isinstance(operation.get('data'), dict) else {}
        if data.get('project_ref') or data.get('project_operation_id') or operation.get('project_ref') or _extract_ai_reference(data.get('project')):
            return True
    return False


def _validate_ai_operations_for_preview(request, operations: list) -> list:
    context = {'mode': 'preview', 'workspace_rollbacks': []}
    try:
        return [_validate_ai_operation(request, operation, context=context) for operation in operations]
    finally:
        _rollback_ai_project_workspaces(context)


def _simulate_ai_operations_for_preview(request, operations: list) -> list:
    context = {'mode': 'preview', 'workspace_rollbacks': []}
    references = {}
    validated_operations = []
    try:
        with transaction.atomic():
            for source_operation in operations:
                resolved_operation, reference_errors = _resolve_ai_operation_references(source_operation, references)
                if reference_errors:
                    validated_operations.append(_reference_error_ai_operation(source_operation, reference_errors))
                    break

                validation = _validate_ai_operation(request, resolved_operation, context=context)
                validated_operations.append(validation)
                if not validation.get('valid'):
                    break
                if validation.get('_project_file'):
                    _apply_ai_project_file_operation(validation)
                    if not validation.get('valid'):
                        break
                saved_operation = _save_ai_operation(request, validation)
                validated_operations[-1] = saved_operation
                _record_ai_operation_reference(references, source_operation, saved_operation)

            transaction.set_rollback(True)
    finally:
        _rollback_ai_project_file_operations(validated_operations)
        _rollback_ai_project_workspaces(context)

    for operation in validated_operations:
        if operation.get('operation') == 'create':
            operation.pop('object', None)
            operation.pop('object_id', None)
        if operation.get('resource_type') == 'project_file':
            operation.pop('project_id', None)
            operation.pop('target', None)
    return validated_operations


def _apply_ai_operations_sequentially(request, operations: list) -> tuple[list, bool]:
    context = {'mode': 'apply', 'workspace_rollbacks': []}
    references = {}
    applied_operations = []
    try:
        with transaction.atomic():
            for source_operation in operations:
                resolved_operation, reference_errors = _resolve_ai_operation_references(source_operation, references)
                if reference_errors:
                    applied_operations.append(_reference_error_ai_operation(source_operation, reference_errors))
                    raise AIResourceActionApplyError(applied_operations)

                validation = _validate_ai_operation(request, resolved_operation, context=context)
                applied_operations.append(validation)
                if not validation.get('valid'):
                    raise AIResourceActionApplyError(applied_operations)
                if validation.get('_project_file'):
                    _apply_ai_project_file_operation(validation)
                    if not validation.get('valid'):
                        raise AIResourceActionApplyError(applied_operations)

                saved_operation = _save_ai_operation(request, validation)
                applied_operations[-1] = saved_operation
                _record_ai_operation_reference(references, source_operation, saved_operation)
    except AIResourceActionApplyError as exc:
        _rollback_ai_project_file_operations(exc.operations)
        _rollback_ai_project_workspaces(context)
        _scrub_ai_rolled_back_apply_operations(exc.operations)
        return exc.operations, False
    except Exception:
        _rollback_ai_project_file_operations(applied_operations)
        _rollback_ai_project_workspaces(context)
        raise

    return applied_operations, True


class AIResourceActionView(APIView):
    """
    POST /api/v2/ai/resource_actions/

    Turns a natural-language request or supplied JSON plan into validated AWX
    resource operations. Preview validates without saving. Apply requires
    explicit mode="apply" or apply=true and reuses existing serializers, RBAC,
    Activity Stream, and OPA guardrails.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, *args, **kwargs):
        if not isinstance(request.data, dict):
            return Response({'detail': _('Request body must be a JSON object.')}, status=status.HTTP_400_BAD_REQUEST)

        mode = str(request.data.get('mode') or ('apply' if request.data.get('apply') else 'preview')).strip().lower()
        if mode not in {'preview', 'apply'}:
            return Response({'detail': _('mode must be "preview" or "apply".')}, status=status.HTTP_400_BAD_REQUEST)

        context = request.data.get('context') if isinstance(request.data.get('context'), dict) else {}
        provider = ''
        model = ''
        generated = False

        try:
            if request.data.get('plan') is not None:
                plan = _normalize_ai_plan(request.data.get('plan'))
            else:
                prompt = request.data.get('prompt')
                if not isinstance(prompt, str) or not prompt.strip():
                    return Response({'detail': _('Provide either a plan object or a non-empty prompt.')}, status=status.HTTP_400_BAD_REQUEST)
                plan, provider, model = _ai_provider_plan_from_prompt(request, prompt.strip(), context)
                generated = True
        except AIProviderError as exc:
            return Response({'detail': exc.detail}, status=exc.status_code)
        except (ValueError, json.JSONDecodeError) as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        if mode == 'preview':
            if _ai_plan_uses_operation_references(plan['operations']):
                operations = _simulate_ai_operations_for_preview(request, plan['operations'])
            else:
                operations = _validate_ai_operations_for_preview(request, plan['operations'])
            can_apply = all(operation.get('valid') for operation in operations)
        else:
            operations, can_apply = _apply_ai_operations_sequentially(request, plan['operations'])

        if mode == 'apply' and not can_apply:
            audit_entry = _audit_ai_resource_action(request, mode, plan, operations, provider=provider, model=model)
            return Response(
                {
                    'mode': mode,
                    'generated': generated,
                    'plan': _redact_sensitive(_json_safe(plan)),
                    'operations': [_public_ai_operation_result(operation) for operation in operations],
                    'can_apply': False,
                    'audit': {'activity_stream_id': audit_entry.pk},
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        public_operations = [_public_ai_operation_result(operation) for operation in operations]
        audit_entry = _audit_ai_resource_action(request, mode, plan, public_operations, provider=provider, model=model)

        return Response(
            {
                'mode': mode,
                'generated': generated,
                'plan': _redact_sensitive(_json_safe(plan)),
                'operations': public_operations,
                'can_apply': can_apply,
                'audit': {'activity_stream_id': audit_entry.pk},
            },
            status=status.HTTP_200_OK if mode == 'preview' else status.HTTP_201_CREATED,
        )


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
        else:
            builtin_answer = _try_answer_awx_fact_question(request.user, messages)
            if builtin_answer is not None:
                return Response(
                    {
                        'message': {'role': 'assistant', 'content': builtin_answer},
                        'model': 'awx-live-context',
                        'provider': 'awx',
                    },
                    status=status.HTTP_200_OK,
                )
            system_prompt = _system_prompt_with_awx_context(system_prompt, request.user)
        if provider != 'openai_codex' and not api_key:
            return Response(
                {'detail': _('AI_API_KEY is not configured. Set it in Settings → AI Assistant.')},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        base_url = getattr(settings, 'AI_API_URL', '')
        max_tokens = getattr(settings, 'AI_MAX_TOKENS', 2048)
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
