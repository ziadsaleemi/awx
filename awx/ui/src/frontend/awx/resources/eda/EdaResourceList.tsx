import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  ButtonVariant,
  Form,
  FormGroup,
  Modal,
  TextArea,
} from '@patternfly/react-core';
import { PlusCircleIcon } from '@patternfly/react-icons';
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
  createSample?: Record<string, unknown>;
  readOnly?: boolean;
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

    if (!config.readOnly) {
      actions.push({
        type: PageActionType.Button,
        selection: PageActionSelection.Single,
        label: t('Edit JSON'),
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
  }, [canManageEda, config.readOnly, config.resource, syncProject, t]);

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
        <EdaResourceJsonModal
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
        sort: 'name',
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
