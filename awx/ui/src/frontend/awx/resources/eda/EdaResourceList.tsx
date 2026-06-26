import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  ButtonVariant,
  Checkbox,
  Form,
  FormGroup,
  FormSelect,
  FormSelectOption,
  Modal,
  Spinner,
  TextArea,
  TextInput,
} from '@patternfly/react-core';
import { PlusCircleIcon, TrashIcon } from '@patternfly/react-icons';
import {
  IPageAction,
  ITableColumn,
  PageActionSelection,
  PageActionType,
  PageHeader,
  PageLayout,
  PageTable,
  TextCell,
  usePageAlertToaster,
} from '../../../../framework';
import { postRequest, requestDelete, requestPatch } from '../../../common/crud/Data';
import { useGet } from '../../../common/crud/useGet';
import { StatusCell } from '../../../common/Status';
import { AwxError } from '../../common/AwxError';
import { awxAPI } from '../../common/api/awx-utils';
import { useAwxActiveUser } from '../../common/useAwxActiveUser';
import { useAwxView } from '../../common/useAwxView';
import { EdaStatus } from '../../interfaces/EdaActivation';
import { useAwxNavigationCapabilities } from '../../main/awxNavigationCapabilities';
import { EdaActivationStartModal } from './EdaActivationStartModal';

export interface EdaResourceRecord {
  id: number;
  name?: string;
  status?: string;
  state?: string;
  description?: string;
  created?: string;
  modified?: string;
  [key: string]: unknown;
}

interface EdaResourceField {
  label: string;
  keys: string[];
  type?: 'status' | 'date' | 'text';
}

export interface EdaResourceConfig {
  resource: string;
  title: string;
  description: string;
  emptyStateTitle: string;
  emptyStateDescription: string;
  fields: EdaResourceField[];
  nameSort?: string;
  createSample?: Record<string, unknown>;
  readOnly?: boolean;
  form?: EdaResourceFormType;
}

type EdaResourceFormType =
  | 'project'
  | 'decision-environment'
  | 'event-stream'
  | 'credential'
  | 'credential-type';

interface EdaCredentialRecord {
  id: number | string;
  name?: string;
  description?: string;
  credential_type?: {
    id?: number | string;
    name?: string;
    namespace?: string;
    kind?: string;
  };
  credential_type_id?: number | string;
  credential_type_name?: string;
  kind?: string;
  inputs?: Record<string, unknown>;
  organization_id?: number | string;
  organization?: {
    id?: number | string;
    name?: string;
  };
}

interface EdaCredentialInputField {
  id?: string;
  label?: string;
  type?: string;
  secret?: boolean;
  multiline?: boolean;
  choices?: Array<string | { value?: string; label?: string }>;
  default?: unknown;
  help_text?: string;
}

interface EdaCredentialTypeRecord {
  id: number | string;
  name?: string;
  namespace?: string;
  kind?: string;
  description?: string;
  managed?: boolean;
  inputs?: {
    fields?: EdaCredentialInputField[];
    required?: string[];
  };
  injectors?: Record<string, unknown>;
}

interface CredentialTypeFieldDraft {
  localId: string;
  id: string;
  label: string;
  type: 'string' | 'boolean';
  helpText: string;
  secret: boolean;
  defaultValue: string;
  choices: string;
}

interface EdaItemsResponse<T> {
  count: number;
  next?: string | null;
  previous?: string | null;
  results: T[];
}

const SERVER_MANAGED_FIELDS = new Set([
  'id',
  'related',
  'summary_fields',
  'created',
  'modified',
  'created_by',
  'modified_by',
]);

export function EdaResourceList(props: { config: EdaResourceConfig }) {
  const { config } = props;
  const { t } = useTranslation();
  const alertToaster = usePageAlertToaster();
  const { activeAwxUser } = useAwxActiveUser();
  const capabilities = useAwxNavigationCapabilities(activeAwxUser);
  const canManageEda = Boolean(activeAwxUser?.is_superuser) || Boolean(capabilities.canManageEda);
  const [modalState, setModalState] = useState<{
    mode: 'create' | 'edit' | 'view';
    record?: EdaResourceRecord;
  } | null>(null);
  const [deleteRecord, setDeleteRecord] = useState<EdaResourceRecord | null>(null);
  const [startRulebookRecord, setStartRulebookRecord] = useState<EdaResourceRecord | null>(null);
  const [eventStreamActivationsRecord, setEventStreamActivationsRecord] =
    useState<EdaResourceRecord | null>(null);
  const {
    data: status,
    error: statusError,
    refresh: refreshStatus,
  } = useGet<EdaStatus>(awxAPI`/eda/status/`);
  const tableColumns = useEdaResourceColumns(config);
  const view = useAwxView<EdaResourceRecord>({
    url: awxAPI`/eda/${config.resource}/`,
    tableColumns,
  });

  const deleteResource = useCallback(
    async (record: EdaResourceRecord) => {
      if (record.id === undefined || record.id === null) return;
      try {
        await requestDelete(
          awxAPI`/eda/${config.resource}/${String(record.id)}/`,
          new AbortController().signal
        );
        alertToaster.addAlert({
          variant: 'success',
          title: t('EDA resource delete requested'),
          timeout: 4000,
        });
        setDeleteRecord(null);
        await view.refresh();
      } catch (err) {
        alertToaster.addAlert({
          variant: 'danger',
          title: t('Failed to delete EDA resource'),
          children: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [alertToaster, config.resource, t, view]
  );

  const syncProject = useCallback(
    async (record: EdaResourceRecord) => {
      if (record.id === undefined || record.id === null) return;
      try {
        await postRequest(awxAPI`/eda/projects/${String(record.id)}/sync/`, {});
        alertToaster.addAlert({
          variant: 'success',
          title: t('EDA project sync requested'),
          timeout: 4000,
        });
        await view.refresh();
      } catch (err) {
        alertToaster.addAlert({
          variant: 'danger',
          title: t('Failed to sync EDA project'),
          children: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [alertToaster, t, view]
  );

  const toolbarActions = useMemo<IPageAction<EdaResourceRecord>[]>(
    () =>
      config.readOnly
        ? []
        : [
            {
              type: PageActionType.Button,
              selection: PageActionSelection.None,
              variant: ButtonVariant.primary,
              isPinned: true,
              icon: PlusCircleIcon,
              label: t('Create'),
              isDisabled: !canManageEda
                ? t('You need EDA administrator permissions to create this resource.')
                : undefined,
              onClick: () => setModalState({ mode: 'create' }),
            },
          ],
    [canManageEda, config.readOnly, t]
  );

  const rowActions = useMemo<IPageAction<EdaResourceRecord>[]>(() => {
    const actions: IPageAction<EdaResourceRecord>[] = [
      {
        type: PageActionType.Button,
        selection: PageActionSelection.Single,
        label: t('View JSON'),
        onClick: (record) => setModalState({ mode: 'view', record }),
      },
    ];

    if (config.resource === 'projects') {
      actions.push({
        type: PageActionType.Button,
        selection: PageActionSelection.Single,
        label: t('Sync'),
        isDisabled: !canManageEda
          ? t('You need EDA administrator permissions to sync this project.')
          : undefined,
        onClick: (record) => void syncProject(record),
      });
    }

    if (config.resource === 'rulebooks') {
      actions.push({
        type: PageActionType.Button,
        selection: PageActionSelection.Single,
        label: t('Create/start activation'),
        isDisabled: !canManageEda
          ? t('You need EDA administrator permissions to create activations from rulebooks.')
          : undefined,
        onClick: (record) => setStartRulebookRecord(record),
      });
    }

    if (config.resource === 'event-streams') {
      actions.push({
        type: PageActionType.Button,
        selection: PageActionSelection.Single,
        label: t('View activations'),
        onClick: (record) => setEventStreamActivationsRecord(record),
      });
    }

    if (!config.readOnly) {
      actions.push({
        type: PageActionType.Button,
        selection: PageActionSelection.Single,
        label: config.form ? t('Edit') : t('Edit JSON'),
        isDisabled: !canManageEda
          ? t('You need EDA administrator permissions to edit this resource.')
          : undefined,
        onClick: (record) => setModalState({ mode: 'edit', record }),
      });
      actions.push({
        type: PageActionType.Button,
        selection: PageActionSelection.Single,
        label: t('Delete'),
        isDanger: true,
        isDisabled: !canManageEda
          ? t('You need EDA administrator permissions to delete this resource.')
          : undefined,
        onClick: (record) => setDeleteRecord(record),
      });
    }

    return actions;
  }, [canManageEda, config.form, config.readOnly, config.resource, syncProject, t]);

  if (statusError) return <AwxError error={statusError} handleRefresh={refreshStatus} />;

  return (
    <PageLayout>
      <PageHeader title={config.title} description={config.description} />
      {status && !status.configured && (
        <Alert
          isInline
          variant="warning"
          title={t('EDA Controller is not configured')}
          style={{ margin: '0 24px 16px' }}
        >
          {status.message}
        </Alert>
      )}
      <PageTable<EdaResourceRecord>
        id={`eda-${config.resource}-table`}
        tableColumns={tableColumns}
        toolbarActions={toolbarActions}
        rowActions={rowActions}
        errorStateTitle={t('Error loading EDA resources')}
        emptyStateTitle={config.emptyStateTitle}
        emptyStateDescription={config.emptyStateDescription}
        emptyStateButtonIcon={!config.readOnly && canManageEda ? <PlusCircleIcon /> : undefined}
        emptyStateButtonText={!config.readOnly && canManageEda ? t('Create') : undefined}
        emptyStateButtonClick={
          !config.readOnly && canManageEda ? () => setModalState({ mode: 'create' }) : undefined
        }
        {...view}
      />
      {modalState && (
        <EdaResourceModal
          config={config}
          mode={modalState.mode}
          record={modalState.record}
          onClose={() => setModalState(null)}
          onSaved={async () => {
            setModalState(null);
            await view.refresh();
          }}
        />
      )}
      {deleteRecord && (
        <Modal
          title={t('Delete EDA resource')}
          isOpen
          onClose={() => setDeleteRecord(null)}
          variant="small"
          actions={[
            <Button key="delete" variant="danger" onClick={() => void deleteResource(deleteRecord)}>
              {t('Delete')}
            </Button>,
            <Button key="cancel" variant="link" onClick={() => setDeleteRecord(null)}>
              {t('Cancel')}
            </Button>,
          ]}
        >
          {t('Delete "{{name}}"?', { name: recordName(deleteRecord) })}
        </Modal>
      )}
      {startRulebookRecord && (
        <EdaActivationStartModal
          canCreateActivation={canManageEda}
          initialRulebook={startRulebookRecord}
          onClose={() => setStartRulebookRecord(null)}
          onStarted={async () => {
            setStartRulebookRecord(null);
            await view.refresh();
          }}
        />
      )}
      {eventStreamActivationsRecord && (
        <EdaEventStreamActivationsModal
          record={eventStreamActivationsRecord}
          onClose={() => setEventStreamActivationsRecord(null)}
        />
      )}
    </PageLayout>
  );
}

function useEdaResourceColumns(config: EdaResourceConfig): ITableColumn<EdaResourceRecord>[] {
  const { t } = useTranslation();
  return useMemo(
    () => [
      {
        header: t('Name'),
        cell: (record) => <TextCell text={recordName(record)} />,
        sort: config.nameSort ?? 'name',
        card: 'name',
        list: 'name',
      },
      ...config.fields.map((field) => ({
        header: field.label,
        cell: (record: EdaResourceRecord) => {
          const value = pickValue(record, field.keys);
          if (field.type === 'status') return <StatusCell status={String(value || '-')} />;
          return <TextCell text={formatValue(value, field.type)} />;
        },
      })),
    ],
    [config.fields, t]
  );
}

function EdaResourceModal(props: {
  config: EdaResourceConfig;
  mode: 'create' | 'edit' | 'view';
  record?: EdaResourceRecord;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  if (props.config.form && (props.mode === 'create' || props.mode === 'edit')) {
    return (
      <EdaResourceFormModal
        config={props.config}
        form={props.config.form}
        mode={props.mode}
        record={props.record}
        onClose={props.onClose}
        onSaved={props.onSaved}
      />
    );
  }
  return <EdaResourceJsonModal {...props} />;
}

function EdaResourceFormModal(props: {
  config: EdaResourceConfig;
  form: EdaResourceFormType;
  mode: 'create' | 'edit';
  record?: EdaResourceRecord;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { config, form, mode, record } = props;
  const { t } = useTranslation();
  const alertToaster = usePageAlertToaster();
  const [name, setName] = useState(() => stringValue(record?.name));
  const [description, setDescription] = useState(() => stringValue(record?.description));
  const [projectUrl, setProjectUrl] = useState(() => stringValue(record?.url ?? record?.scm_url));
  const [scmBranch, setScmBranch] = useState(() =>
    mode === 'create' ? 'main' : stringValue(record?.scm_branch)
  );
  const [scmRefspec, setScmRefspec] = useState(() => stringValue(record?.scm_refspec));
  const [verifySsl, setVerifySsl] = useState(() => booleanValue(record?.verify_ssl, true));
  const [updateRevisionOnLaunch, setUpdateRevisionOnLaunch] = useState(() =>
    booleanValue(record?.update_revision_on_launch, false)
  );
  const [scmCacheTimeout, setScmCacheTimeout] = useState(() =>
    stringValue(record?.scm_update_cache_timeout)
  );
  const [imageUrl, setImageUrl] = useState(() =>
    mode === 'create'
      ? 'quay.io/ansible/ansible-rulebook:latest'
      : stringValue(record?.image_url ?? record?.image ?? record?.container_image)
  );
  const [pullPolicy, setPullPolicy] = useState(() =>
    form === 'decision-environment' ? stringValue(record?.pull_policy || 'always') : ''
  );
  const [edaCredentialId, setEdaCredentialId] = useState(() =>
    stringValue(record?.eda_credential_id ?? nestedId(record?.eda_credential))
  );
  const [signatureCredentialId, setSignatureCredentialId] = useState(() =>
    stringValue(
      record?.signature_validation_credential_id ??
        nestedId(record?.signature_validation_credential)
    )
  );
  const [testMode, setTestMode] = useState(() => booleanValue(record?.test_mode, false));
  const [eventStreamUuid, setEventStreamUuid] = useState(() => stringValue(record?.uuid));
  const [additionalDataHeaders, setAdditionalDataHeaders] = useState(() =>
    JSON.stringify(record?.additional_data_headers ?? {}, null, 2)
  );
  const [credentialTypeId, setCredentialTypeId] = useState(() =>
    stringValue(record?.credential_type_id ?? nestedId(record?.credential_type))
  );
  const [credentialInputValues, setCredentialInputValues] = useState<Record<string, unknown>>(() =>
    record && typeof record.inputs === 'object' && record.inputs !== null
      ? (record.inputs as Record<string, unknown>)
      : {}
  );
  const [credentialTypeFields, setCredentialTypeFields] = useState<CredentialTypeFieldDraft[]>(
    () => {
      const fields = credentialTypeFieldDrafts(record?.inputs);
      return fields.length > 0 || mode === 'edit' ? fields : [newCredentialTypeFieldDraft(0)];
    }
  );
  const [generateInjectors, setGenerateInjectors] = useState(() =>
    mode === 'create' ? true : !hasObjectKeys(record?.injectors)
  );
  const [credentialTypeInjectorsText, setCredentialTypeInjectorsText] = useState(() =>
    JSON.stringify(record?.injectors ?? {}, null, 2)
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { data: credentials, isLoading: credentialsLoading } = useGet<
    EdaItemsResponse<EdaCredentialRecord>
  >(
    form === 'project' || form === 'decision-environment' || form === 'event-stream'
      ? awxAPI`/eda/credentials/`
      : undefined,
    { page_size: 200, order_by: 'name' },
    { revalidateOnFocus: false }
  );
  const { data: credentialTypes, isLoading: credentialTypesLoading } = useGet<
    EdaItemsResponse<EdaCredentialTypeRecord>
  >(
    form === 'credential' ? awxAPI`/eda/credential-types/` : undefined,
    { page_size: 200, order_by: 'name' },
    { revalidateOnFocus: false }
  );
  const regularCredentials = (credentials?.results ?? []).filter(
    (credential) => !isRuleEngineCredential(credential)
  );
  const selectedCredentialType = (credentialTypes?.results ?? []).find(
    (credentialType) => String(credentialType.id) === credentialTypeId
  );
  const credentialInputFields = selectedCredentialType?.inputs?.fields ?? [];
  const requiredCredentialInputIds = selectedCredentialType?.inputs?.required ?? [];
  const isManagedCredentialType =
    form === 'credential-type' && booleanValue(record?.managed, false) && mode === 'edit';

  const submit = async () => {
    if (!name.trim()) {
      alertToaster.addAlert({ variant: 'danger', title: t('Name is required') });
      return;
    }
    if (form === 'project' && !projectUrl.trim()) {
      alertToaster.addAlert({ variant: 'danger', title: t('Source control URL is required') });
      return;
    }
    if (form === 'decision-environment' && !imageUrl.trim()) {
      alertToaster.addAlert({ variant: 'danger', title: t('Image is required') });
      return;
    }
    if (form === 'event-stream' && !edaCredentialId) {
      alertToaster.addAlert({ variant: 'danger', title: t('Credential is required') });
      return;
    }
    if (form === 'credential' && !credentialTypeId) {
      alertToaster.addAlert({ variant: 'danger', title: t('Credential type is required') });
      return;
    }
    if (isManagedCredentialType) {
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Managed credential types cannot be edited'),
      });
      return;
    }

    let payload: Record<string, unknown>;
    try {
      if (form === 'project') {
        payload = projectPayload({
          name,
          description,
          projectUrl,
          scmBranch,
          scmRefspec,
          verifySsl,
          updateRevisionOnLaunch,
          scmCacheTimeout,
          edaCredentialId,
          signatureCredentialId,
          includeClears: mode === 'edit',
        });
      } else if (form === 'decision-environment') {
        payload = decisionEnvironmentPayload({
          name,
          description,
          imageUrl,
          pullPolicy,
          edaCredentialId,
          includeClears: mode === 'edit',
        });
      } else if (form === 'event-stream') {
        payload = eventStreamPayload({
          name,
          testMode,
          edaCredentialId,
          additionalDataHeaders,
          eventStreamUuid,
        });
      } else if (form === 'credential') {
        payload = credentialPayload({
          name,
          description,
          credentialTypeId,
          credentialInputFields,
          credentialInputValues,
          includeCredentialType: mode === 'create',
        });
      } else {
        payload = credentialTypePayload({
          name,
          description,
          fields: credentialTypeFields,
          generateInjectors,
          injectorsText: credentialTypeInjectorsText,
        });
      }
    } catch (err) {
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Form data is invalid'),
        children: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    setIsSubmitting(true);
    try {
      if (mode === 'create') {
        await postRequest(awxAPI`/eda/${config.resource}/`, payload);
      } else if (record?.id !== undefined && record.id !== null) {
        await requestPatch(awxAPI`/eda/${config.resource}/${String(record.id)}/`, payload);
      }
      alertToaster.addAlert({
        variant: 'success',
        title: t('EDA resource saved'),
        timeout: 4000,
      });
      await props.onSaved();
    } catch (err) {
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Failed to save EDA resource'),
        children: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      title={
        mode === 'create'
          ? t('Create {{resource}}', { resource: config.title })
          : t('Edit {{resource}}', { resource: recordName(record) })
      }
      isOpen
      onClose={props.onClose}
      variant="medium"
      actions={[
        <Button
          key="save"
          variant="primary"
          isLoading={isSubmitting}
          isDisabled={isSubmitting || isManagedCredentialType}
          onClick={() => void submit()}
        >
          {t('Save')}
        </Button>,
        <Button key="cancel" variant="link" onClick={props.onClose}>
          {t('Cancel')}
        </Button>,
      ]}
    >
      <Form>
        {isManagedCredentialType && (
          <Alert
            isInline
            variant="warning"
            title={t('Managed credential type')}
            style={{ marginBottom: 16 }}
          >
            {t('This credential type is managed by EDA and cannot be edited from AWX.')}
          </Alert>
        )}
        <FormGroup label={t('Name')} fieldId={`eda-${form}-name`} isRequired>
          <TextInput id={`eda-${form}-name`} value={name} onChange={(_, value) => setName(value)} />
        </FormGroup>
        {form !== 'event-stream' && (
          <FormGroup label={t('Description')} fieldId={`eda-${form}-description`}>
            <TextArea
              id={`eda-${form}-description`}
              value={description}
              rows={3}
              onChange={(_, value) => setDescription(value)}
            />
          </FormGroup>
        )}
        {form === 'project' ? (
          <>
            <FormGroup label={t('Source control URL')} fieldId="eda-project-url" isRequired>
              <TextInput
                id="eda-project-url"
                value={projectUrl}
                onChange={(_, value) => setProjectUrl(value)}
              />
            </FormGroup>
            <FormGroup label={t('Source control branch')} fieldId="eda-project-branch">
              <TextInput
                id="eda-project-branch"
                value={scmBranch}
                onChange={(_, value) => setScmBranch(value)}
              />
            </FormGroup>
            <FormGroup label={t('Source control refspec')} fieldId="eda-project-refspec">
              <TextInput
                id="eda-project-refspec"
                value={scmRefspec}
                onChange={(_, value) => setScmRefspec(value)}
              />
            </FormGroup>
            <FormGroup label={t('Project credential')} fieldId="eda-project-credential">
              <CredentialSelect
                id="eda-project-credential"
                value={edaCredentialId}
                credentials={regularCredentials}
                isLoading={credentialsLoading}
                onChange={setEdaCredentialId}
              />
            </FormGroup>
            <FormGroup
              label={t('Signature validation credential')}
              fieldId="eda-project-signature-credential"
            >
              <CredentialSelect
                id="eda-project-signature-credential"
                value={signatureCredentialId}
                credentials={regularCredentials}
                isLoading={credentialsLoading}
                onChange={setSignatureCredentialId}
              />
            </FormGroup>
            <FormGroup label={t('SCM update cache timeout')} fieldId="eda-project-cache-timeout">
              <TextInput
                id="eda-project-cache-timeout"
                type="number"
                min={0}
                value={scmCacheTimeout}
                onChange={(_, value) => setScmCacheTimeout(value)}
              />
            </FormGroup>
            <Checkbox
              id="eda-project-verify-ssl"
              label={t('Verify SSL')}
              isChecked={verifySsl}
              onChange={(_, checked) => setVerifySsl(checked)}
            />
            <Checkbox
              id="eda-project-update-revision"
              label={t('Update revision on launch')}
              isChecked={updateRevisionOnLaunch}
              onChange={(_, checked) => setUpdateRevisionOnLaunch(checked)}
            />
          </>
        ) : form === 'decision-environment' ? (
          <>
            <FormGroup label={t('Image')} fieldId="eda-decision-environment-image" isRequired>
              <TextInput
                id="eda-decision-environment-image"
                value={imageUrl}
                onChange={(_, value) => setImageUrl(value)}
              />
            </FormGroup>
            <FormGroup label={t('Pull policy')} fieldId="eda-decision-environment-pull-policy">
              <FormSelect
                id="eda-decision-environment-pull-policy"
                value={pullPolicy}
                onChange={(_, value) => setPullPolicy(value)}
              >
                <FormSelectOption value="always" label={t('Always')} />
                <FormSelectOption value="missing" label={t('If missing')} />
                <FormSelectOption value="never" label={t('Never')} />
              </FormSelect>
            </FormGroup>
            <FormGroup
              label={t('Registry credential')}
              fieldId="eda-decision-environment-credential"
            >
              <CredentialSelect
                id="eda-decision-environment-credential"
                value={edaCredentialId}
                credentials={regularCredentials}
                isLoading={credentialsLoading}
                onChange={setEdaCredentialId}
              />
            </FormGroup>
          </>
        ) : form === 'event-stream' ? (
          <>
            <FormGroup
              label={t('Event stream credential')}
              fieldId="eda-event-stream-credential"
              isRequired
            >
              <CredentialSelect
                id="eda-event-stream-credential"
                value={edaCredentialId}
                credentials={regularCredentials}
                isLoading={credentialsLoading}
                onChange={setEdaCredentialId}
              />
            </FormGroup>
            <FormGroup label={t('UUID')} fieldId="eda-event-stream-uuid">
              <TextInput
                id="eda-event-stream-uuid"
                value={eventStreamUuid}
                onChange={(_, value) => setEventStreamUuid(value)}
              />
            </FormGroup>
            <FormGroup
              label={t('Additional data headers')}
              fieldId="eda-event-stream-additional-data-headers"
            >
              <TextArea
                id="eda-event-stream-additional-data-headers"
                value={additionalDataHeaders}
                rows={5}
                onChange={(_, value) => setAdditionalDataHeaders(value)}
                style={{ fontFamily: 'monospace' }}
              />
            </FormGroup>
            <Checkbox
              id="eda-event-stream-test-mode"
              label={t('Test mode')}
              isChecked={testMode}
              onChange={(_, checked) => setTestMode(checked)}
            />
          </>
        ) : form === 'credential' ? (
          <>
            <FormGroup label={t('Credential type')} fieldId="eda-credential-type" isRequired>
              <FormSelect
                id="eda-credential-type"
                value={credentialTypeId}
                isDisabled={mode === 'edit'}
                onChange={(_, value) => {
                  setCredentialTypeId(value);
                  const nextType = (credentialTypes?.results ?? []).find(
                    (credentialType) => String(credentialType.id) === value
                  );
                  setCredentialInputValues(credentialInputDefaults(nextType));
                }}
              >
                <FormSelectOption
                  value=""
                  label={
                    credentialTypesLoading
                      ? t('Loading credential types...')
                      : t('Select credential type')
                  }
                />
                {(credentialTypes?.results ?? []).map((credentialType) => (
                  <FormSelectOption
                    key={String(credentialType.id)}
                    value={String(credentialType.id)}
                    label={credentialTypeLabel(credentialType)}
                  />
                ))}
              </FormSelect>
            </FormGroup>
            {credentialInputFields.map((field) => (
              <CredentialInput
                key={credentialInputFieldId(field)}
                field={field}
                isRequired={requiredCredentialInputIds.includes(credentialInputFieldId(field))}
                value={credentialInputValues[credentialInputFieldId(field)]}
                onChange={(value) =>
                  setCredentialInputValues((currentValues) => ({
                    ...currentValues,
                    [credentialInputFieldId(field)]: value,
                  }))
                }
              />
            ))}
          </>
        ) : (
          <>
            <FormGroup label={t('Input fields')} fieldId="eda-credential-type-fields" isRequired>
              <div id="eda-credential-type-fields">
                {credentialTypeFields.map((field, index) => (
                  <CredentialTypeFieldEditor
                    key={field.localId}
                    field={field}
                    index={index}
                    isRemovable={credentialTypeFields.length > 1}
                    onChange={(nextField) =>
                      setCredentialTypeFields((currentFields) =>
                        currentFields.map((currentField) =>
                          currentField.localId === field.localId ? nextField : currentField
                        )
                      )
                    }
                    onRemove={() =>
                      setCredentialTypeFields((currentFields) =>
                        currentFields.filter(
                          (currentField) => currentField.localId !== field.localId
                        )
                      )
                    }
                  />
                ))}
              </div>
            </FormGroup>
            <Button
              id="eda-credential-type-add-field"
              variant="secondary"
              icon={<PlusCircleIcon />}
              onClick={() =>
                setCredentialTypeFields((currentFields) => [
                  ...currentFields,
                  newCredentialTypeFieldDraft(nextCredentialTypeFieldIndex(currentFields)),
                ])
              }
            >
              {t('Add field')}
            </Button>
            <Checkbox
              id="eda-credential-type-generate-injectors"
              label={t('Generate extra vars from fields')}
              isChecked={generateInjectors}
              onChange={(_, checked) => setGenerateInjectors(checked)}
            />
            {!generateInjectors && (
              <FormGroup
                label={t('Injector configuration')}
                fieldId="eda-credential-type-injectors"
              >
                <TextArea
                  id="eda-credential-type-injectors"
                  value={credentialTypeInjectorsText}
                  rows={6}
                  onChange={(_, value) => setCredentialTypeInjectorsText(value)}
                  style={{ fontFamily: 'monospace' }}
                />
              </FormGroup>
            )}
          </>
        )}
      </Form>
    </Modal>
  );
}

function CredentialSelect(props: {
  id: string;
  value: string;
  credentials: EdaCredentialRecord[];
  isLoading: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <FormSelect id={props.id} value={props.value} onChange={(_, value) => props.onChange(value)}>
      <FormSelectOption
        value=""
        label={props.isLoading ? t('Loading credentials...') : t('None')}
      />
      {props.credentials.map((credential) => (
        <FormSelectOption
          key={String(credential.id)}
          value={String(credential.id)}
          label={credentialLabel(credential)}
        />
      ))}
    </FormSelect>
  );
}

function EdaEventStreamActivationsModal(props: { record: EdaResourceRecord; onClose: () => void }) {
  const { t } = useTranslation();
  const eventStreamId = props.record.id === undefined ? '' : String(props.record.id);
  const { data, error, isLoading } = useGet<EdaItemsResponse<EdaResourceRecord>>(
    eventStreamId ? awxAPI`/eda/event-streams/${eventStreamId}/activations/` : undefined,
    { page_size: 50, order_by: 'name' },
    { revalidateOnFocus: false }
  );
  const activations = data?.results ?? [];

  return (
    <Modal
      title={t('Event stream activations')}
      isOpen
      onClose={props.onClose}
      variant="large"
      actions={[
        <Button key="close" variant="primary" onClick={props.onClose}>
          {t('Close')}
        </Button>,
      ]}
    >
      <div style={{ marginBottom: 16 }}>
        <strong>{recordName(props.record)}</strong>
      </div>
      {isLoading ? (
        <Spinner size="lg" />
      ) : error ? (
        <Alert isInline variant="danger" title={t('Failed to load event stream activations')}>
          {error.message}
        </Alert>
      ) : activations.length === 0 ? (
        <p>{t('No activations are linked to this event stream.')}</p>
      ) : (
        <table className="pf-v5-c-table pf-m-grid-md" aria-label={t('Event stream activations')}>
          <thead>
            <tr>
              <th>{t('Name')}</th>
              <th>{t('Status')}</th>
              <th>{t('Created')}</th>
              <th>{t('Modified')}</th>
            </tr>
          </thead>
          <tbody>
            {activations.map((activation) => (
              <tr key={String(activation.id)}>
                <td>{recordName(activation)}</td>
                <td>
                  <StatusCell status={String(activation.status ?? activation.state ?? '-')} />
                </td>
                <td>{formatDateValue(activation.created ?? activation.created_at)}</td>
                <td>{formatDateValue(activation.modified ?? activation.modified_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

function CredentialInput(props: {
  field: EdaCredentialInputField;
  isRequired: boolean;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const { t } = useTranslation();
  const field = props.field;
  const fieldId = credentialInputFieldId(field);
  const inputId = `eda-credential-input-${fieldId}`;
  const label = field.label || fieldId;
  const type = (field.type || 'string').toLowerCase();
  const choices = credentialInputChoices(field);

  if (type === 'boolean') {
    return (
      <FormGroup label={label} fieldId={inputId} isRequired={props.isRequired}>
        <Checkbox
          id={inputId}
          label={label}
          isChecked={booleanValue(props.value, booleanValue(field.default, false))}
          onChange={(_, checked) => props.onChange(checked)}
        />
      </FormGroup>
    );
  }

  if (choices.length > 0) {
    return (
      <FormGroup label={label} fieldId={inputId} isRequired={props.isRequired}>
        <FormSelect
          id={inputId}
          value={stringValue(props.value)}
          onChange={(_, value) => props.onChange(value)}
        >
          <FormSelectOption value="" label={t('Select {{label}}', { label })} />
          {choices.map((choice) => (
            <FormSelectOption key={choice.value} value={choice.value} label={choice.label} />
          ))}
        </FormSelect>
      </FormGroup>
    );
  }

  if (field.multiline || type === 'textarea') {
    return (
      <FormGroup label={label} fieldId={inputId} isRequired={props.isRequired}>
        <TextArea
          id={inputId}
          value={stringValue(props.value)}
          rows={4}
          onChange={(_, value) => props.onChange(value)}
        />
      </FormGroup>
    );
  }

  return (
    <FormGroup label={label} fieldId={inputId} isRequired={props.isRequired}>
      <TextInput
        id={inputId}
        type={
          field.secret ? 'password' : type === 'integer' || type === 'number' ? 'number' : 'text'
        }
        value={stringValue(props.value)}
        onChange={(_, value) => props.onChange(value)}
      />
    </FormGroup>
  );
}

function CredentialTypeFieldEditor(props: {
  field: CredentialTypeFieldDraft;
  index: number;
  isRemovable: boolean;
  onChange: (field: CredentialTypeFieldDraft) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const { field } = props;
  const updateField = (patch: Partial<CredentialTypeFieldDraft>) =>
    props.onChange({ ...field, ...patch });

  return (
    <div
      style={{
        borderTop: props.index > 0 ? '1px solid var(--pf-v5-global--BorderColor--100)' : 0,
        marginTop: props.index > 0 ? 16 : 0,
        paddingTop: props.index > 0 ? 16 : 0,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
        <strong>{t('Field {{number}}', { number: props.index + 1 })}</strong>
        <Button
          variant="plain"
          aria-label={t('Remove field {{number}}', { number: props.index + 1 })}
          icon={<TrashIcon />}
          isDisabled={!props.isRemovable}
          onClick={props.onRemove}
        />
      </div>
      <FormGroup
        label={t('Field ID')}
        fieldId={`eda-credential-type-field-id-${field.localId}`}
        isRequired
      >
        <TextInput
          id={`eda-credential-type-field-id-${field.localId}`}
          value={field.id}
          onChange={(_, value) => updateField({ id: value })}
        />
      </FormGroup>
      <FormGroup label={t('Label')} fieldId={`eda-credential-type-field-label-${field.localId}`}>
        <TextInput
          id={`eda-credential-type-field-label-${field.localId}`}
          value={field.label}
          onChange={(_, value) => updateField({ label: value })}
        />
      </FormGroup>
      <FormGroup label={t('Type')} fieldId={`eda-credential-type-field-type-${field.localId}`}>
        <FormSelect
          id={`eda-credential-type-field-type-${field.localId}`}
          value={field.type}
          onChange={(_, value) =>
            updateField({
              type: value === 'boolean' ? 'boolean' : 'string',
              secret: value === 'boolean' ? false : field.secret,
              choices: value === 'boolean' ? '' : field.choices,
            })
          }
        >
          <FormSelectOption value="string" label={t('String')} />
          <FormSelectOption value="boolean" label={t('Boolean')} />
        </FormSelect>
      </FormGroup>
      <FormGroup label={t('Help text')} fieldId={`eda-credential-type-field-help-${field.localId}`}>
        <TextInput
          id={`eda-credential-type-field-help-${field.localId}`}
          value={field.helpText}
          onChange={(_, value) => updateField({ helpText: value })}
        />
      </FormGroup>
      <FormGroup
        label={t('Default value')}
        fieldId={`eda-credential-type-field-default-${field.localId}`}
      >
        <TextInput
          id={`eda-credential-type-field-default-${field.localId}`}
          value={field.defaultValue}
          onChange={(_, value) => updateField({ defaultValue: value })}
        />
      </FormGroup>
      {field.type === 'string' && (
        <>
          <FormGroup
            label={t('Choices')}
            fieldId={`eda-credential-type-field-choices-${field.localId}`}
          >
            <TextInput
              id={`eda-credential-type-field-choices-${field.localId}`}
              value={field.choices}
              placeholder={t('Comma-separated values')}
              onChange={(_, value) => updateField({ choices: value })}
            />
          </FormGroup>
          <Checkbox
            id={`eda-credential-type-field-secret-${field.localId}`}
            label={t('Secret')}
            isChecked={field.secret}
            onChange={(_, checked) => updateField({ secret: checked })}
          />
        </>
      )}
    </div>
  );
}

function EdaResourceJsonModal(props: {
  config: EdaResourceConfig;
  mode: 'create' | 'edit' | 'view';
  record?: EdaResourceRecord;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { config, mode, record } = props;
  const { t } = useTranslation();
  const alertToaster = usePageAlertToaster();
  const [jsonText, setJsonText] = useState(() =>
    JSON.stringify(initialPayload(config, mode, record), null, 2)
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isReadOnly = mode === 'view';

  const submit = async () => {
    if (isReadOnly) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonText || '{}') as Record<string, unknown>;
    } catch (err) {
      alertToaster.addAlert({
        variant: 'danger',
        title: t('JSON is invalid'),
        children: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    setIsSubmitting(true);
    try {
      if (mode === 'create') {
        await postRequest(awxAPI`/eda/${config.resource}/`, parsed);
      } else if (record?.id !== undefined && record.id !== null) {
        await requestPatch(awxAPI`/eda/${config.resource}/${String(record.id)}/`, parsed);
      }
      alertToaster.addAlert({
        variant: 'success',
        title: t('EDA resource saved'),
        timeout: 4000,
      });
      await props.onSaved();
    } catch (err) {
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Failed to save EDA resource'),
        children: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      title={
        mode === 'create'
          ? t('Create {{resource}}', { resource: config.title })
          : mode === 'edit'
            ? t('Edit {{resource}}', { resource: recordName(record) })
            : t('View {{resource}}', { resource: recordName(record) })
      }
      isOpen
      onClose={props.onClose}
      variant="large"
      actions={[
        !isReadOnly && (
          <Button
            key="save"
            variant="primary"
            isLoading={isSubmitting}
            isDisabled={isSubmitting}
            onClick={() => void submit()}
          >
            {t('Save')}
          </Button>
        ),
        <Button key="cancel" variant="link" onClick={props.onClose}>
          {isReadOnly ? t('Close') : t('Cancel')}
        </Button>,
      ].filter(Boolean)}
    >
      <Form>
        <FormGroup label={t('Resource JSON')} fieldId="eda-resource-json">
          <TextArea
            id="eda-resource-json"
            value={jsonText}
            onChange={(_, value) => setJsonText(value)}
            rows={18}
            readOnly={isReadOnly}
            style={{ fontFamily: 'monospace' }}
          />
        </FormGroup>
      </Form>
    </Modal>
  );
}

function initialPayload(
  config: EdaResourceConfig,
  mode: 'create' | 'edit' | 'view',
  record?: EdaResourceRecord
) {
  if (mode === 'create') return config.createSample ?? { name: '' };
  if (mode === 'view') return record ?? {};
  return sanitizeEditablePayload(record ?? {});
}

function sanitizeEditablePayload(record: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => !SERVER_MANAGED_FIELDS.has(key))
  );
}

function projectPayload(values: {
  name: string;
  description: string;
  projectUrl: string;
  scmBranch: string;
  scmRefspec: string;
  verifySsl: boolean;
  updateRevisionOnLaunch: boolean;
  scmCacheTimeout: string;
  edaCredentialId: string;
  signatureCredentialId: string;
  includeClears: boolean;
}) {
  const payload: Record<string, unknown> = {
    name: values.name.trim(),
    description: values.description,
    url: values.projectUrl.trim(),
    scm_branch: values.scmBranch.trim(),
    verify_ssl: values.verifySsl,
    update_revision_on_launch: values.updateRevisionOnLaunch,
  };
  if (values.scmRefspec.trim()) payload.scm_refspec = values.scmRefspec.trim();
  if (values.scmCacheTimeout.trim()) {
    payload.scm_update_cache_timeout = Number(values.scmCacheTimeout);
  }
  if (values.edaCredentialId) {
    payload.eda_credential_id = Number(values.edaCredentialId);
  } else if (values.includeClears) {
    payload.eda_credential_id = null;
  }
  if (values.signatureCredentialId) {
    payload.signature_validation_credential_id = Number(values.signatureCredentialId);
  } else if (values.includeClears) {
    payload.signature_validation_credential_id = null;
  }
  return payload;
}

function decisionEnvironmentPayload(values: {
  name: string;
  description: string;
  imageUrl: string;
  pullPolicy: string;
  edaCredentialId: string;
  includeClears: boolean;
}) {
  const payload: Record<string, unknown> = {
    name: values.name.trim(),
    description: values.description,
    image_url: values.imageUrl.trim(),
    pull_policy: values.pullPolicy || 'always',
  };
  if (values.edaCredentialId) {
    payload.eda_credential_id = Number(values.edaCredentialId);
  } else if (values.includeClears) {
    payload.eda_credential_id = null;
  }
  return payload;
}

function eventStreamPayload(values: {
  name: string;
  testMode: boolean;
  edaCredentialId: string;
  additionalDataHeaders: string;
  eventStreamUuid: string;
}) {
  const payload: Record<string, unknown> = {
    name: values.name.trim(),
    test_mode: values.testMode,
    eda_credential_id: Number(values.edaCredentialId),
    additional_data_headers: parseJsonObject(
      values.additionalDataHeaders,
      'Additional data headers'
    ),
  };
  if (values.eventStreamUuid.trim()) payload.uuid = values.eventStreamUuid.trim();
  return payload;
}

function credentialPayload(values: {
  name: string;
  description: string;
  credentialTypeId: string;
  credentialInputFields: EdaCredentialInputField[];
  credentialInputValues: Record<string, unknown>;
  includeCredentialType: boolean;
}) {
  const payload: Record<string, unknown> = {
    name: values.name.trim(),
    description: values.description,
    inputs: credentialInputsPayload(values.credentialInputFields, values.credentialInputValues),
  };
  if (values.includeCredentialType) payload.credential_type_id = Number(values.credentialTypeId);
  return payload;
}

function credentialTypePayload(values: {
  name: string;
  description: string;
  fields: CredentialTypeFieldDraft[];
  generateInjectors: boolean;
  injectorsText: string;
}) {
  const inputFields = credentialTypeInputFields(values.fields);
  return {
    name: values.name.trim(),
    description: values.description,
    inputs: { fields: inputFields },
    injectors: values.generateInjectors
      ? generatedCredentialTypeInjectors(inputFields)
      : parseJsonObject(values.injectorsText, 'Injector configuration'),
  };
}

function credentialTypeInputFields(fields: CredentialTypeFieldDraft[]) {
  const usedIds = new Set<string>();
  return fields.map((field) => {
    const id = field.id.trim();
    if (!id) throw new Error('Credential type field ID is required.');
    if (!/^[A-Za-z0-9_]+$/.test(id)) {
      throw new Error(
        `Credential type field ID "${id}" can only use letters, numbers, and underscore.`
      );
    }
    if (usedIds.has(id)) throw new Error(`Credential type field ID "${id}" is duplicated.`);
    usedIds.add(id);

    const inputField: EdaCredentialInputField = {
      id,
      label: field.label.trim() || id,
      type: field.type,
    };
    if (field.helpText.trim()) inputField.help_text = field.helpText.trim();
    if (field.type === 'string' && field.secret) inputField.secret = true;
    if (field.defaultValue.trim()) {
      inputField.default =
        field.type === 'boolean'
          ? ['true', '1', 'yes', 'on'].includes(field.defaultValue.trim().toLowerCase())
          : field.defaultValue.trim();
    }
    const choices = field.choices
      .split(',')
      .map((choice) => choice.trim())
      .filter(Boolean);
    if (field.type === 'string' && choices.length > 0) inputField.choices = choices;
    return inputField;
  });
}

function generatedCredentialTypeInjectors(fields: EdaCredentialInputField[]) {
  return {
    extra_vars: Object.fromEntries(
      fields.map((field) => [credentialInputFieldId(field), `{{${credentialInputFieldId(field)}}}`])
    ),
  };
}

function credentialInputsPayload(
  fields: EdaCredentialInputField[],
  inputValues: Record<string, unknown>
) {
  const inputs: Record<string, unknown> = {};
  for (const field of fields) {
    const fieldId = credentialInputFieldId(field);
    const type = (field.type || 'string').toLowerCase();
    const value = inputValues[fieldId];
    if (type === 'boolean') {
      inputs[fieldId] = booleanValue(value, booleanValue(field.default, false));
      continue;
    }
    const text = stringValue(value);
    if (!text.trim()) continue;
    if (type === 'integer' || type === 'number') {
      const numberValue = Number(text);
      inputs[fieldId] = Number.isFinite(numberValue) ? numberValue : text.trim();
    } else {
      inputs[fieldId] = text;
    }
  }
  return inputs;
}

function parseJsonObject(jsonText: string, label: string) {
  if (!jsonText.trim()) return {};
  const parsed = JSON.parse(jsonText) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function stringValue(value: unknown) {
  return value === undefined || value === null ? '' : String(value);
}

function booleanValue(value: unknown, defaultValue: boolean) {
  return typeof value === 'boolean' ? value : defaultValue;
}

function nestedId(value: unknown) {
  if (typeof value === 'object' && value !== null && 'id' in value) {
    const id = (value as { id?: unknown }).id;
    return id === undefined || id === null ? '' : String(id);
  }
  return '';
}

function credentialLabel(credential: EdaCredentialRecord) {
  const name = String(credential.name ?? credential.id ?? '');
  const type =
    credential.credential_type?.name ??
    credential.credential_type_name ??
    credential.credential_type?.kind ??
    credential.kind ??
    '';
  return type ? `${name} (${type})` : name;
}

function credentialTypeLabel(credentialType: EdaCredentialTypeRecord) {
  const name = String(credentialType.name ?? credentialType.id);
  const namespace = credentialType.namespace || credentialType.kind || '';
  return namespace ? `${name} (${namespace})` : name;
}

function credentialInputFieldId(field: EdaCredentialInputField) {
  if (field.id) return field.id;
  if (field.label) {
    return field.label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }
  return 'value';
}

function credentialInputChoices(field: EdaCredentialInputField) {
  return (field.choices ?? []).map((choice) =>
    typeof choice === 'string'
      ? { value: choice, label: choice }
      : {
          value: String(choice.value ?? ''),
          label: String(choice.label ?? choice.value ?? ''),
        }
  );
}

function credentialInputDefaults(credentialType?: EdaCredentialTypeRecord) {
  const values: Record<string, unknown> = {};
  for (const field of credentialType?.inputs?.fields ?? []) {
    if (field.default !== undefined) values[credentialInputFieldId(field)] = field.default;
  }
  return values;
}

function credentialTypeFieldDrafts(inputs: unknown): CredentialTypeFieldDraft[] {
  if (
    !inputs ||
    typeof inputs !== 'object' ||
    !Array.isArray((inputs as { fields?: unknown }).fields)
  ) {
    return [];
  }
  return ((inputs as { fields: EdaCredentialInputField[] }).fields ?? []).map((field, index) => {
    const choices = credentialInputChoices(field).map((choice) => choice.value);
    return {
      localId: `field-${index}`,
      id: credentialInputFieldId(field),
      label: field.label ?? credentialInputFieldId(field),
      type: field.type === 'boolean' ? 'boolean' : 'string',
      helpText: field.help_text ?? '',
      secret: booleanValue(field.secret, false),
      defaultValue: field.default === undefined ? '' : String(field.default),
      choices: choices.join(', '),
    };
  });
}

function newCredentialTypeFieldDraft(index: number): CredentialTypeFieldDraft {
  return {
    localId: `field-${index}`,
    id: '',
    label: '',
    type: 'string',
    helpText: '',
    secret: false,
    defaultValue: '',
    choices: '',
  };
}

function nextCredentialTypeFieldIndex(fields: CredentialTypeFieldDraft[]) {
  return (
    fields.reduce((maxIndex, field) => {
      const index = Number(field.localId.replace(/^field-/, ''));
      return Number.isFinite(index) ? Math.max(maxIndex, index) : maxIndex;
    }, -1) + 1
  );
}

function hasObjectKeys(value: unknown) {
  return Boolean(value && typeof value === 'object' && Object.keys(value).length > 0);
}

function isRuleEngineCredential(credential: EdaCredentialRecord) {
  const type = (
    credential.credential_type?.name ??
    credential.credential_type_name ??
    credential.credential_type?.kind ??
    credential.kind ??
    ''
  ).toLowerCase();
  const namespace = (credential.credential_type?.namespace ?? '').toLowerCase();
  return namespace === 'drools' || type.includes('rule engine');
}

function recordName(record?: EdaResourceRecord) {
  if (!record) return '-';
  return String(record.name ?? record.id ?? '-');
}

function pickValue(record: EdaResourceRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function formatValue(value: unknown, type?: 'status' | 'date' | 'text') {
  if (value === undefined || value === null || value === '') return '-';
  if (type === 'date' && typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length ? `${value.length}` : '-';
  if (typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    return String(
      objectValue.name ?? objectValue.username ?? objectValue.id ?? JSON.stringify(value)
    );
  }
  return String(value);
}

function formatDateValue(value: unknown) {
  return formatValue(value, 'date');
}
