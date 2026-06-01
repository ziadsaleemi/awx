import {
  Alert,
  Button,
  ClipboardCopy,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  FormGroup,
  FormSelect,
  FormSelectOption,
  Spinner,
} from '@patternfly/react-core';
import { ExternalLinkAltIcon } from '@patternfly/react-icons';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageFormSection } from '../../../../framework/PageForm/Utils/PageFormSection';
import { postRequest, requestGet } from '../../../common/crud/Data';
import { awxAPI } from '../../common/api/awx-utils';

interface AISettingsResponse {
  provider: string;
  openai_codex_connected: boolean;
  openai_codex_account_id: string;
  openai_codex_plan_type: string;
  openai_codex_expires_at: string;
  openai_codex_available_models: string[];
  openai_codex_default_model: string;
}

interface DeviceCodeStartResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

interface DeviceCodePollResponse {
  status: 'approved' | 'pending' | 'expired';
  expires_at?: string;
  account_id?: string;
  plan_type?: string;
}

interface OpenAICodexModelsResponse {
  configured: boolean;
  models: string[];
  default_model: string;
  source: 'cached' | 'curated' | 'live';
  model_fetch_error: string;
}

function messageFromError(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  return fallback;
}

export function OpenAICodexDeviceLogin() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<AISettingsResponse | null>(null);
  const [modelCatalog, setModelCatalog] = useState<OpenAICodexModelsResponse | null>(null);
  const [selectedModel, setSelectedModel] = useState('');
  const [deviceAuth, setDeviceAuth] = useState<DeviceCodeStartResponse | null>(null);
  const [busy, setBusy] = useState<'load' | 'start' | 'poll' | 'models' | 'setModel' | null>(
    'load'
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    try {
      const data = await requestGet<AISettingsResponse>(awxAPI`/ai/settings/`);
      setSettings(data);
    } catch (err) {
      setError(messageFromError(err, t('Failed to load AI settings.')));
    }
  }, [t]);

  const loadModels = useCallback(async () => {
    try {
      const data = await requestGet<OpenAICodexModelsResponse>(awxAPI`/ai/openai_codex/models/`);
      setModelCatalog(data);
      setSelectedModel(data.default_model || data.models[0] || '');
    } catch (err) {
      setError(messageFromError(err, t('Failed to load OpenAI Codex models.')));
    }
  }, [t]);

  useEffect(() => {
    void Promise.all([loadSettings(), loadModels()]).finally(() => setBusy(null));
  }, [loadModels, loadSettings]);

  const refreshModels = useCallback(async () => {
    setBusy('models');
    setNotice(null);
    setError(null);
    try {
      const data = await postRequest<OpenAICodexModelsResponse, Record<string, never>>(
        awxAPI`/ai/openai_codex/models/refresh/`,
        {}
      );
      setModelCatalog(data);
      setSelectedModel(data.default_model || data.models[0] || '');
      setNotice(
        data.source === 'live'
          ? t('Available Codex models refreshed from OpenAI.')
          : t('Using the curated Codex model catalog.')
      );
    } catch (err) {
      setError(messageFromError(err, t('Failed to refresh OpenAI Codex models.')));
    } finally {
      setBusy(null);
    }
  }, [t]);

  const setDefaultModel = useCallback(async () => {
    if (!selectedModel) return;
    setBusy('setModel');
    setNotice(null);
    setError(null);
    try {
      const data = await postRequest<OpenAICodexModelsResponse, { model: string }>(
        awxAPI`/ai/openai_codex/models/default/`,
        { model: selectedModel }
      );
      setModelCatalog(data);
      setSelectedModel(data.default_model || selectedModel);
      setNotice(t('Default Codex model saved.'));
    } catch (err) {
      setError(messageFromError(err, t('Failed to save the default Codex model.')));
    } finally {
      setBusy(null);
    }
  }, [selectedModel, t]);

  const startDeviceLogin = useCallback(async () => {
    setBusy('start');
    setNotice(null);
    setError(null);
    try {
      const flow = await postRequest<DeviceCodeStartResponse, Record<string, never>>(
        awxAPI`/ai/openai_codex/device_code/start/`,
        {}
      );
      setDeviceAuth(flow);
      setNotice(t('Device login started. Approve the code in OpenAI, then check approval.'));
    } catch (err) {
      setError(messageFromError(err, t('Failed to start OpenAI Codex device login.')));
    } finally {
      setBusy(null);
    }
  }, [t]);

  const pollDeviceLogin = useCallback(async () => {
    if (!deviceAuth) return;
    setBusy('poll');
    setNotice(null);
    setError(null);
    try {
      const result = await postRequest<
        DeviceCodePollResponse,
        { device_code: string; user_code: string }
      >(awxAPI`/ai/openai_codex/device_code/poll/`, {
        device_code: deviceAuth.device_code,
        user_code: deviceAuth.user_code,
      });
      if (result.status === 'approved') {
        setNotice(t('OpenAI Codex device login is connected.'));
        setDeviceAuth(null);
        await loadSettings();
        await refreshModels();
      } else if (result.status === 'expired') {
        setNotice(t('Device code expired. Start a new device login.'));
        setDeviceAuth(null);
      } else {
        setNotice(t('OpenAI approval is still pending.'));
      }
    } catch (err) {
      setError(messageFromError(err, t('Failed to poll OpenAI Codex device login.')));
    } finally {
      setBusy(null);
    }
  }, [deviceAuth, loadSettings, refreshModels, t]);

  return (
    <PageFormSection title={t('OpenAI Codex Device Login')} singleColumn>
      <Alert
        isInline
        variant="info"
        title={t('Use OpenAI Codex device login without replacing OpenAI API-key support')}
      >
        {t(
          'This connects a ChatGPT/Codex account token. Standard OpenAI API-key support remains available by selecting OpenAI as the AI Provider.'
        )}
      </Alert>

      {error && <Alert isInline variant="danger" title={error} />}
      {notice && <Alert isInline variant="success" title={notice} />}

      {busy === 'load' ? (
        <Spinner size="sm" />
      ) : (
        <DescriptionList isCompact isHorizontal>
          <DescriptionListGroup>
            <DescriptionListTerm>{t('Connection')}</DescriptionListTerm>
            <DescriptionListDescription>
              {settings?.openai_codex_connected ? t('Connected') : t('Not connected')}
            </DescriptionListDescription>
          </DescriptionListGroup>
          {settings?.openai_codex_account_id ? (
            <DescriptionListGroup>
              <DescriptionListTerm>{t('Account')}</DescriptionListTerm>
              <DescriptionListDescription>
                {settings.openai_codex_account_id}
              </DescriptionListDescription>
            </DescriptionListGroup>
          ) : null}
          {settings?.openai_codex_plan_type ? (
            <DescriptionListGroup>
              <DescriptionListTerm>{t('Plan')}</DescriptionListTerm>
              <DescriptionListDescription>
                {settings.openai_codex_plan_type}
              </DescriptionListDescription>
            </DescriptionListGroup>
          ) : null}
          {settings?.provider === 'openai_codex' ? (
            <DescriptionListGroup>
              <DescriptionListTerm>{t('Active provider')}</DescriptionListTerm>
              <DescriptionListDescription>
                {t('OpenAI Codex device login')}
              </DescriptionListDescription>
            </DescriptionListGroup>
          ) : null}
          {modelCatalog ? (
            <>
              <DescriptionListGroup>
                <DescriptionListTerm>{t('Default model')}</DescriptionListTerm>
                <DescriptionListDescription>
                  {modelCatalog.default_model || t('Not set')}
                </DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>{t('Model catalog')}</DescriptionListTerm>
                <DescriptionListDescription>
                  {t('{{count}} models, {{source}} source', {
                    count: modelCatalog.models.length,
                    source: modelCatalog.source,
                  })}
                </DescriptionListDescription>
              </DescriptionListGroup>
            </>
          ) : null}
        </DescriptionList>
      )}

      <FormGroup label={t('Codex default model')} fieldId="openai-codex-default-model">
        <FormSelect
          id="openai-codex-default-model"
          value={selectedModel}
          onChange={(_event, value) => setSelectedModel(String(value))}
          isDisabled={busy !== null || !modelCatalog?.models.length}
        >
          {(modelCatalog?.models ?? []).map((model) => (
            <FormSelectOption key={model} value={model} label={model} />
          ))}
        </FormSelect>
      </FormGroup>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button
          variant="secondary"
          onClick={() => void refreshModels()}
          isLoading={busy === 'models'}
          isDisabled={busy !== null || !settings?.openai_codex_connected}
        >
          {t('Refresh Codex models')}
        </Button>
        <Button
          variant="primary"
          onClick={() => void setDefaultModel()}
          isLoading={busy === 'setModel'}
          isDisabled={busy !== null || !selectedModel}
        >
          {t('Set default model')}
        </Button>
      </div>

      {deviceAuth ? (
        <>
          <DescriptionList isCompact isHorizontal>
            <DescriptionListGroup>
              <DescriptionListTerm>{t('User code')}</DescriptionListTerm>
              <DescriptionListDescription>
                <ClipboardCopy isReadOnly hoverTip={t('Copy')} clickTip={t('Copied')}>
                  {deviceAuth.user_code}
                </ClipboardCopy>
              </DescriptionListDescription>
            </DescriptionListGroup>
            <DescriptionListGroup>
              <DescriptionListTerm>{t('Verification URL')}</DescriptionListTerm>
              <DescriptionListDescription>
                <a
                  href={deviceAuth.verification_uri_complete || deviceAuth.verification_uri}
                  target="_blank"
                  rel="noreferrer"
                >
                  {deviceAuth.verification_uri}
                  <ExternalLinkAltIcon style={{ marginLeft: 6 }} />
                </a>
              </DescriptionListDescription>
            </DescriptionListGroup>
          </DescriptionList>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              variant="primary"
              onClick={() => void pollDeviceLogin()}
              isLoading={busy === 'poll'}
              isDisabled={busy !== null}
            >
              {t('Check approval')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setDeviceAuth(null)}
              isDisabled={busy !== null}
            >
              {t('Cancel')}
            </Button>
          </div>
        </>
      ) : (
        <Button
          variant="secondary"
          onClick={() => void startDeviceLogin()}
          isLoading={busy === 'start'}
          isDisabled={busy !== null}
        >
          {t('Start OpenAI Codex device login')}
        </Button>
      )}
    </PageFormSection>
  );
}
