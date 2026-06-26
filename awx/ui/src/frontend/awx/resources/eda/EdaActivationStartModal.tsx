import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  Checkbox,
  Form,
  FormGroup,
  FormSelect,
  FormSelectOption,
  Modal,
  TextArea,
  TextInput,
} from '@patternfly/react-core';
import { usePageAlertToaster } from '../../../../framework';
import { AwxItemsResponse } from '../../common/AwxItemsResponse';
import { awxAPI } from '../../common/api/awx-utils';
import { useGet } from '../../../common/crud/useGet';
import { usePostRequest } from '../../../common/crud/usePostRequest';
import { EdaActivationActionResponse } from '../../interfaces/EdaActivation';

export interface EdaActivationStartRulebook {
  id?: number | string;
  name?: string;
  rulebook?: string;
  rulebook_name?: string;
}

interface EdaActivationStartResource {
  id: number | string;
  name?: string;
  rulebook?: string;
  rulebook_name?: string;
  image_url?: string;
  credential_type?: {
    id?: number;
    name?: string;
    namespace?: string;
    kind?: string;
  };
  credential_type_name?: string;
  kind?: string;
}

export function EdaActivationStartModal(props: {
  canCreateActivation: boolean;
  initialRulebook?: EdaActivationStartRulebook;
  onClose: () => void;
  onStarted: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const alertToaster = usePageAlertToaster();
  const postRequest = usePostRequest<Record<string, unknown>, EdaActivationActionResponse>();
  const initialRulebookId =
    props.initialRulebook?.id !== undefined && props.initialRulebook?.id !== null
      ? String(props.initialRulebook.id)
      : '';
  const initialRulebookName = resourceName(props.initialRulebook);
  const [rulebookName, setRulebookName] = useState(initialRulebookName);
  const [rulebookId, setRulebookId] = useState(initialRulebookId);
  const [activationName, setActivationName] = useState('');
  const [activationId, setActivationId] = useState('');
  const [eventSource, setEventSource] = useState('');
  const [decisionEnvironmentId, setDecisionEnvironmentId] = useState('');
  const [edaCredentialIds, setEdaCredentialIds] = useState<number[]>([]);
  const [enablePersistence, setEnablePersistence] = useState(false);
  const [ruleEngineCredentialId, setRuleEngineCredentialId] = useState('');
  const [logLevel, setLogLevel] = useState('');
  const [extraData, setExtraData] = useState('{}');
  const [poll, setPoll] = useState(true);
  const [includeEvents, setIncludeEvents] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: rulebooks, isLoading: rulebooksLoading } = useGet<
    AwxItemsResponse<EdaActivationStartResource>
  >(
    props.canCreateActivation ? awxAPI`/eda/rulebooks/` : undefined,
    { page_size: 200, order_by: 'name' },
    { revalidateOnFocus: false }
  );
  const { data: decisionEnvironments, isLoading: decisionEnvironmentsLoading } = useGet<
    AwxItemsResponse<EdaActivationStartResource>
  >(
    props.canCreateActivation ? awxAPI`/eda/decision-environments/` : undefined,
    { page_size: 200, order_by: 'name' },
    { revalidateOnFocus: false }
  );
  const { data: credentials, isLoading: credentialsLoading } = useGet<
    AwxItemsResponse<EdaActivationStartResource>
  >(
    props.canCreateActivation ? awxAPI`/eda/credentials/` : undefined,
    { page_size: 200, order_by: 'name' },
    { revalidateOnFocus: false }
  );

  const rulebookOptions = useMemo(() => {
    const options = [...(rulebooks?.results ?? [])];
    if (
      props.initialRulebook &&
      initialRulebookId &&
      !options.some((option) => String(option.id) === initialRulebookId)
    ) {
      options.unshift({
        id: initialRulebookId,
        name: initialRulebookName,
      });
    }
    return options;
  }, [initialRulebookId, initialRulebookName, props.initialRulebook, rulebooks?.results]);

  const credentialOptions = credentials?.results ?? [];
  const regularCredentials = credentialOptions.filter(
    (credential) => !isRuleEngineCredential(credential)
  );
  const ruleEngineCredentials = credentialOptions.filter(isRuleEngineCredential);

  const submit = async () => {
    let parsedExtraData: Record<string, unknown> = {};
    try {
      parsedExtraData = extraData.trim() ? (JSON.parse(extraData) as Record<string, unknown>) : {};
    } catch (err) {
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Extra data must be valid JSON'),
        children: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const payload: Record<string, unknown> = {
      rulebook_name: rulebookName.trim(),
      activation_id: activationId.trim(),
      event_source: eventSource.trim(),
      extra_data: parsedExtraData,
      poll,
      include_events: includeEvents,
    };
    if (activationName.trim()) payload.name = activationName.trim();
    if (rulebookId) payload.rulebook_id = Number(rulebookId);
    if (decisionEnvironmentId) payload.decision_environment_id = Number(decisionEnvironmentId);
    if (edaCredentialIds.length > 0) payload.eda_credentials = edaCredentialIds;
    if (logLevel) payload.log_level = logLevel;
    if (enablePersistence) {
      payload.enable_persistence = true;
      if (ruleEngineCredentialId) {
        payload.rule_engine_credential_id = Number(ruleEngineCredentialId);
      }
    }

    setIsSubmitting(true);
    try {
      await postRequest(awxAPI`/eda/activations/start/`, payload);
      alertToaster.addAlert({
        variant: 'success',
        title: t('EDA activation start requested'),
        timeout: 4000,
      });
      await props.onStarted();
    } catch (err) {
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Failed to start EDA activation'),
        children: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const createDisabledReason = !props.canCreateActivation
    ? t('You need EDA administrator permissions to create activations.')
    : undefined;
  const startDisabled =
    isSubmitting ||
    (!props.canCreateActivation && !activationId.trim()) ||
    (props.canCreateActivation && !rulebookName.trim() && !activationId.trim() && !rulebookId);

  return (
    <Modal
      title={t('Create/start EDA activation')}
      isOpen
      onClose={props.onClose}
      variant="medium"
      actions={[
        <Button
          key="start"
          variant="primary"
          isLoading={isSubmitting}
          isDisabled={startDisabled}
          onClick={() => void submit()}
        >
          {t('Start')}
        </Button>,
        <Button key="cancel" variant="link" onClick={props.onClose}>
          {t('Cancel')}
        </Button>,
      ]}
    >
      <Form>
        {!props.canCreateActivation && (
          <Alert
            isInline
            variant="info"
            title={t('Operators can start existing activations by ID only.')}
          />
        )}
        <FormGroup label={t('Rulebook')} fieldId="eda-rulebook-select">
          <FormSelect
            id="eda-rulebook-select"
            value={rulebookId}
            isDisabled={!props.canCreateActivation}
            onChange={(_, value) => {
              setRulebookId(value);
              const selected = rulebookOptions.find((option) => String(option.id) === value);
              if (selected) setRulebookName(resourceName(selected));
            }}
          >
            <FormSelectOption
              value=""
              label={rulebooksLoading ? t('Loading rulebooks...') : t('Select a rulebook')}
            />
            {rulebookOptions.map((rulebook) => (
              <FormSelectOption
                key={String(rulebook.id)}
                value={String(rulebook.id)}
                label={resourceLabel(rulebook)}
              />
            ))}
          </FormSelect>
        </FormGroup>
        <FormGroup label={t('Rulebook name')} fieldId="eda-rulebook-name">
          <TextInput
            id="eda-rulebook-name"
            value={rulebookName}
            isDisabled={!props.canCreateActivation}
            onChange={(_, value) => setRulebookName(value)}
          />
        </FormGroup>
        <FormGroup label={t('Activation name')} fieldId="eda-activation-name">
          <TextInput
            id="eda-activation-name"
            value={activationName}
            isDisabled={!props.canCreateActivation}
            onChange={(_, value) => setActivationName(value)}
          />
        </FormGroup>
        <FormGroup label={t('Activation ID')} fieldId="eda-activation-id">
          <TextInput
            id="eda-activation-id"
            value={activationId}
            onChange={(_, value) => setActivationId(value)}
          />
        </FormGroup>
        <FormGroup label={t('Decision environment')} fieldId="eda-decision-environment">
          <FormSelect
            id="eda-decision-environment"
            value={decisionEnvironmentId}
            isDisabled={!props.canCreateActivation}
            onChange={(_, value) => setDecisionEnvironmentId(value)}
          >
            <FormSelectOption
              value=""
              label={
                decisionEnvironmentsLoading
                  ? t('Loading decision environments...')
                  : t('Use controller default')
              }
            />
            {(decisionEnvironments?.results ?? []).map((environment) => (
              <FormSelectOption
                key={String(environment.id)}
                value={String(environment.id)}
                label={resourceLabel(environment, environment.image_url)}
              />
            ))}
          </FormSelect>
        </FormGroup>
        <FormGroup label={t('EDA credentials')} fieldId="eda-credentials">
          {credentialsLoading ? (
            <span>{t('Loading credentials...')}</span>
          ) : regularCredentials.length > 0 ? (
            regularCredentials.map((credential) => (
              <Checkbox
                key={String(credential.id)}
                id={`eda-credential-${String(credential.id)}`}
                label={resourceLabel(credential, credentialTypeName(credential))}
                isChecked={edaCredentialIds.includes(Number(credential.id))}
                isDisabled={!props.canCreateActivation}
                onChange={(_, checked) =>
                  setEdaCredentialIds((current) =>
                    checked
                      ? [...current, Number(credential.id)]
                      : current.filter((id) => id !== Number(credential.id))
                  )
                }
              />
            ))
          ) : (
            <span>{t('No non-rule-engine EDA credentials found.')}</span>
          )}
        </FormGroup>
        <FormGroup label={t('Log level')} fieldId="eda-log-level">
          <FormSelect
            id="eda-log-level"
            value={logLevel}
            isDisabled={!props.canCreateActivation}
            onChange={(_, value) => setLogLevel(value)}
          >
            <FormSelectOption value="" label={t('Use controller default')} />
            <FormSelectOption value="error" label={t('Error')} />
            <FormSelectOption value="info" label={t('Info')} />
            <FormSelectOption value="debug" label={t('Debug')} />
          </FormSelect>
        </FormGroup>
        <FormGroup label={t('Event source')} fieldId="eda-event-source">
          <TextInput
            id="eda-event-source"
            value={eventSource}
            onChange={(_, value) => setEventSource(value)}
          />
        </FormGroup>
        <FormGroup label={t('Extra data JSON')} fieldId="eda-extra-data">
          <TextArea
            id="eda-extra-data"
            value={extraData}
            onChange={(_, value) => setExtraData(value)}
            rows={5}
          />
        </FormGroup>
        <Checkbox
          id="eda-poll"
          label={t('Poll activation after start')}
          isChecked={poll}
          onChange={(_, checked) => setPoll(checked)}
        />
        <Checkbox
          id="eda-include-events"
          label={t('Load recent events after start')}
          isChecked={includeEvents}
          onChange={(_, checked) => setIncludeEvents(checked)}
        />
        <Checkbox
          id="eda-enable-persistence"
          label={t('Enable event persistence')}
          isChecked={enablePersistence}
          isDisabled={!props.canCreateActivation}
          onChange={(_, checked) => setEnablePersistence(checked)}
        />
        {enablePersistence && (
          <FormGroup label={t('Rule engine credential')} fieldId="eda-rule-engine-credential">
            <FormSelect
              id="eda-rule-engine-credential"
              value={ruleEngineCredentialId}
              isDisabled={!props.canCreateActivation}
              onChange={(_, value) => setRuleEngineCredentialId(value)}
            >
              <FormSelectOption value="" label={t('Use controller default')} />
              {ruleEngineCredentials.map((credential) => (
                <FormSelectOption
                  key={String(credential.id)}
                  value={String(credential.id)}
                  label={resourceLabel(credential, credentialTypeName(credential))}
                />
              ))}
            </FormSelect>
          </FormGroup>
        )}
        {createDisabledReason && <Alert isInline variant="warning" title={createDisabledReason} />}
      </Form>
    </Modal>
  );
}

function resourceName(record?: EdaActivationStartRulebook | EdaActivationStartResource) {
  if (!record) return '';
  return String(record.name ?? record.rulebook_name ?? record.rulebook ?? record.id ?? '').trim();
}

function resourceLabel(record: EdaActivationStartResource, secondary?: string) {
  const name = resourceName(record);
  return secondary ? `${name} (${secondary})` : name;
}

function credentialTypeName(credential: EdaActivationStartResource) {
  const credentialType = credential.credential_type;
  if (typeof credentialType === 'object' && credentialType?.name) return credentialType.name;
  return credential.credential_type_name || credential.kind || '';
}

function isRuleEngineCredential(credential: EdaActivationStartResource) {
  const credentialType = credential.credential_type;
  const name = credentialTypeName(credential).toLowerCase();
  const namespace =
    typeof credentialType === 'object' && credentialType?.namespace
      ? credentialType.namespace.toLowerCase()
      : '';
  return namespace === 'drools' || name.includes('rule engine');
}
