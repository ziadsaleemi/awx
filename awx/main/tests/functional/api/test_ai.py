import base64
import json
from unittest import mock

import pytest
from django.test import override_settings

from awx.api.versioning import reverse
from awx.conf.models import Setting


class FakeJSONResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code
        self.ok = status_code < 400
        self.text = json.dumps(payload)
        self.headers = {'content-type': 'application/json'}

    def json(self):
        return self._payload


class FakeCodexStreamResponse:
    status_code = 200
    ok = True
    text = ''

    def iter_lines(self, decode_unicode=False):
        yield b'data: {"type":"response.output_text.delta","delta":"O"}'
        yield b'data: {"type":"response.output_text.delta","delta":"K"}'
        yield b'data: [DONE]'


def _jwt(payload):
    def encode(data):
        return base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip('=')

    return f'{encode({"alg": "none"})}.{encode(payload)}.'


@pytest.mark.django_db
@override_settings(AI_ENABLED=True, AI_PROVIDER='openai', AI_API_KEY='api-key', AI_MODEL_NAME='gpt-4o')
def test_ai_chat_openai_api_key_provider_still_uses_chat_completions(post, admin_user):
    with mock.patch('awx.api.views.ai.requests.post', return_value=FakeJSONResponse({'choices': [{'message': {'content': 'OK'}}]})) as requests_post:
        response = post(
            reverse('api:ai_chat'),
            data={'messages': [{'role': 'user', 'content': 'Say OK'}]},
            user=admin_user,
            expect=200,
        )

    assert response.data['message']['content'] == 'OK'
    assert response.data['provider'] == 'openai'
    assert requests_post.call_args.args[0] == 'https://api.openai.com/v1/chat/completions'
    assert requests_post.call_args.kwargs['headers']['Authorization'] == 'Bearer api-key'


@pytest.mark.django_db
@override_settings(
    AI_ENABLED=True,
    AI_PROVIDER='openai_codex',
    AI_API_KEY='',
    AI_MODEL_NAME='gpt-5.2',
    AI_OPENAI_CODEX_ACCESS_TOKEN=_jwt(
        {
            'scope': 'openid profile email offline_access model.request api.responses.write',
            'https://api.openai.com/auth': {'chatgpt_account_id': 'acct_123', 'chatgpt_plan_type': 'pro'},
        }
    ),
    AI_OPENAI_CODEX_REFRESH_TOKEN='',
    AI_OPENAI_CODEX_TOKEN_EXPIRES_AT='',
    AI_OPENAI_CODEX_CHATGPT_ACCOUNT_ID='',
    AI_OPENAI_CODEX_PLAN_TYPE='',
)
def test_ai_chat_openai_codex_provider_uses_device_token_without_api_key(post, get, admin_user):
    settings_response = get(reverse('api:ai_settings'), user=admin_user, expect=200)
    assert settings_response.data['configured'] is True
    assert settings_response.data['openai_codex_connected'] is True

    with mock.patch('awx.api.views.ai.requests.post', return_value=FakeCodexStreamResponse()) as requests_post:
        response = post(
            reverse('api:ai_chat'),
            data={'messages': [{'role': 'user', 'content': 'Say OK'}]},
            user=admin_user,
            expect=200,
        )

    assert response.data['message']['content'] == 'OK'
    assert response.data['provider'] == 'openai_codex'
    assert requests_post.call_args.args[0] == 'https://chatgpt.com/backend-api/codex/responses'
    assert requests_post.call_args.kwargs['headers']['chatgpt-account-id'] == 'acct_123'
    assert requests_post.call_args.kwargs['headers']['OpenAI-Beta'] == 'responses=experimental'


@pytest.mark.django_db
@override_settings(AI_OPENAI_CODEX_CLIENT_ID='client-id', AI_OPENAI_CODEX_SCOPE='openid api.responses.write')
def test_openai_codex_device_code_start_requires_system_admin(post, admin_user, rando):
    post(reverse('api:ai_openai_codex_device_code_start'), data={}, user=rando, expect=403)

    payload = {
        'device_auth_id': 'device-123',
        'user_code': 'ABCD-EFGH',
        'expires_in': 900,
        'interval': 5,
    }
    with mock.patch('awx.api.views.ai.requests.post', return_value=FakeJSONResponse(payload)) as requests_post:
        response = post(reverse('api:ai_openai_codex_device_code_start'), data={}, user=admin_user, expect=200)

    assert response.data['device_code'] == 'device-123'
    assert response.data['user_code'] == 'ABCD-EFGH'
    assert response.data['verification_uri'] == 'https://auth.openai.com/codex/device'
    assert requests_post.call_args.args[0] == 'https://auth.openai.com/api/accounts/deviceauth/usercode'


@pytest.mark.django_db
@override_settings(AI_OPENAI_CODEX_ACCESS_TOKEN='oauth-token', AI_OPENAI_CODEX_AVAILABLE_MODELS=[])
def test_openai_codex_model_refresh_falls_back_to_curated_catalog(get, post, admin_user):
    settings_response = get(reverse('api:ai_openai_codex_models'), user=admin_user, expect=200)
    assert settings_response.data['models'][0] == 'gpt-5.2'
    assert settings_response.data['source'] == 'curated'

    with mock.patch('awx.api.views.ai.requests.get', return_value=FakeJSONResponse({'error': 'Unauthorized'}, status_code=401)) as requests_get:
        response = post(reverse('api:ai_openai_codex_models_refresh'), data={}, user=admin_user, expect=200)

    assert response.data['source'] == 'curated'
    assert response.data['models'] == [
        'gpt-5.2',
        'gpt-5.2-codex',
        'gpt-5.3-codex',
        'gpt-5.1-codex-max',
        'gpt-5.1-codex',
        'gpt-5.1-codex-mini',
    ]
    assert requests_get.call_args.args[0] == 'https://api.openai.com/v1/models'


@pytest.mark.django_db
@override_settings(AI_OPENAI_CODEX_ACCESS_TOKEN='oauth-token', AI_OPENAI_CODEX_AVAILABLE_MODELS=[])
def test_openai_codex_model_refresh_saves_live_chat_models(post, admin_user):
    payload = {'data': [{'id': 'gpt-5.2'}, {'id': 'o3-mini'}, {'id': 'text-embedding-3-large'}, {'id': 'whisper-1'}]}
    with mock.patch('awx.api.views.ai.requests.get', return_value=FakeJSONResponse(payload)) as requests_get:
        response = post(reverse('api:ai_openai_codex_models_refresh'), data={}, user=admin_user, expect=200)

    assert response.data['source'] == 'live'
    assert response.data['models'] == ['gpt-5.2', 'o3-mini']
    assert requests_get.call_args.kwargs['headers']['Authorization'] == 'Bearer oauth-token'
    assert Setting.objects.get(key='AI_OPENAI_CODEX_AVAILABLE_MODELS').value == ['gpt-5.2', 'o3-mini']


@pytest.mark.django_db
@override_settings(AI_OPENAI_CODEX_AVAILABLE_MODELS=['gpt-5.2', 'gpt-5.3-codex'])
def test_openai_codex_default_model_requires_system_admin_and_saves_setting(post, admin_user, rando):
    post(reverse('api:ai_openai_codex_models_default'), data={'model': 'gpt-5.3-codex'}, user=rando, expect=403)

    response = post(reverse('api:ai_openai_codex_models_default'), data={'model': 'gpt-5.3-codex'}, user=admin_user, expect=200)

    assert response.data['default_model'] == 'gpt-5.3-codex'
    assert Setting.objects.get(key='AI_MODEL_NAME').value == 'gpt-5.3-codex'
