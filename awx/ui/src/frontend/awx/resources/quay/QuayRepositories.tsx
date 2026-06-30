import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  ButtonVariant,
  Form,
  FormGroup,
  FormSelect,
  FormSelectOption,
  Modal,
  ModalVariant,
  TextArea,
  TextInput,
} from '@patternfly/react-core';
import { PencilAltIcon, PlusCircleIcon, TrashIcon } from '@patternfly/react-icons';
import {
  DateTimeCell,
  IPageAction,
  ITableColumn,
  IToolbarFilter,
  PageActionSelection,
  PageActionType,
  PageHeader,
  PageLayout,
  PageTable,
  TextCell,
  ToolbarFilterType,
  usePageAlertToaster,
} from '../../../../framework';
import { postRequest } from '../../../common/crud/Data';
import { useGet } from '../../../common/crud/useGet';
import { ModuleAIAssistantAction } from '../../common/ModuleAIAssistantAction';
import { awxAPI } from '../../common/api/awx-utils';
import { useAwxBulkConfirmation } from '../../common/useAwxBulkConfirmation';
import { useAwxView } from '../../common/useAwxView';
import { QuayStatus } from './QuayOverview';

interface QuayRepository {
  id: number;
  _awx_key?: string;
  name?: string;
  namespace?: string;
  description?: string;
  is_public?: boolean;
  last_modified?: string;
  state?: string;
  tags?: {
    name?: string;
    last_modified?: string;
  }[];
}

interface QuayRepositoryForm {
  repository: string;
  namespace: string;
  description: string;
  visibility: 'public' | 'private';
}

interface QuayRepositoryActionResponse {
  source: string;
  action: string;
  namespace: string;
  repository: string;
  repository_path: string;
}

type QuayRepositoryModalMode = 'create' | 'edit';

function visibility(repository: QuayRepository) {
  if (typeof repository.is_public === 'boolean') {
    return repository.is_public ? 'Public' : 'Private';
  }
  return '-';
}

function lastModified(repository: QuayRepository) {
  if (repository.last_modified) return repository.last_modified;
  return repository.tags?.[0]?.last_modified;
}

function useQuayFilters(): IToolbarFilter[] {
  const { t } = useTranslation();
  return useMemo(
    () => [
      {
        key: 'search',
        label: t('Search'),
        type: ToolbarFilterType.MultiText,
        query: 'search',
        comparison: 'contains',
      },
    ],
    [t]
  );
}

function useQuayRepositoryColumns(): ITableColumn<QuayRepository>[] {
  const { t } = useTranslation();
  return useMemo(
    () => [
      {
        header: t('Repository'),
        cell: (repository) => <TextCell text={repository.name || '-'} />,
        card: 'name',
        list: 'name',
      },
      {
        header: t('Namespace'),
        cell: (repository) => <TextCell text={repository.namespace || '-'} />,
      },
      {
        header: t('Visibility'),
        cell: (repository) => <TextCell text={visibility(repository)} />,
      },
      {
        header: t('Description'),
        cell: (repository) => <TextCell text={repository.description || '-'} />,
      },
      {
        header: t('Updated'),
        cell: (repository) => <DateTimeCell value={lastModified(repository)} />,
      },
    ],
    [t]
  );
}

export function QuayRepositories() {
  const { t } = useTranslation();
  const alertToaster = usePageAlertToaster();
  const toolbarFilters = useQuayFilters();
  const tableColumns = useQuayRepositoryColumns();
  const view = useAwxView<QuayRepository>({
    url: awxAPI`/quay/repositories/`,
    toolbarFilters,
    tableColumns,
  });
  const status = useGet<QuayStatus>(awxAPI`/quay/status/`);
  const statusData = status.data;
  const canManageQuay = Boolean(statusData?.can_manage);
  const canManageRepositories = Boolean(
    statusData?.can_manage && statusData?.management_configured
  );
  const defaultNamespace = statusData?.namespace || '';
  const bulkAction = useAwxBulkConfirmation<QuayRepository>();
  const [modalMode, setModalMode] = useState<QuayRepositoryModalMode>();
  const [repositoryForm, setRepositoryForm] = useState<QuayRepositoryForm>({
    repository: '',
    namespace: '',
    description: '',
    visibility: 'private',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const closeModal = useCallback(() => {
    setModalMode(undefined);
    setIsSubmitting(false);
  }, []);

  const openCreateModal = useCallback(() => {
    setRepositoryForm({
      repository: '',
      namespace: defaultNamespace,
      description: '',
      visibility: 'private',
    });
    setModalMode('create');
  }, [defaultNamespace]);

  const openEditModal = useCallback(
    (repository: QuayRepository) => {
      setRepositoryForm({
        repository: repository.name || '',
        namespace: repository.namespace || defaultNamespace,
        description: repository.description || '',
        visibility: repository.is_public ? 'public' : 'private',
      });
      setModalMode('edit');
    },
    [defaultNamespace]
  );

  const refreshQuay = useCallback(async () => {
    await view.refresh();
    status.refresh();
  }, [status, view]);

  const submitRepositoryForm = useCallback(async () => {
    if (!modalMode) return;
    setIsSubmitting(true);
    try {
      const endpoint =
        modalMode === 'create'
          ? awxAPI`/quay/repositories/create/`
          : awxAPI`/quay/repositories/update/`;
      const result = await postRequest<QuayRepositoryActionResponse, QuayRepositoryForm>(
        endpoint,
        repositoryForm
      );
      alertToaster.addAlert({
        variant: 'success',
        title:
          modalMode === 'create'
            ? t('Project Quay repository {{repository}} created.', {
                repository: result.repository_path,
              })
            : t('Project Quay repository {{repository}} updated.', {
                repository: result.repository_path,
              }),
        timeout: 4000,
      });
      closeModal();
      await refreshQuay();
    } catch (err) {
      alertToaster.addAlert({
        variant: 'danger',
        title:
          modalMode === 'create'
            ? t('Failed to create Project Quay repository')
            : t('Failed to update Project Quay repository'),
        children: err instanceof Error ? err.message : String(err),
      });
      setIsSubmitting(false);
    }
  }, [alertToaster, closeModal, modalMode, refreshQuay, repositoryForm, t]);

  const changeVisibility = useCallback(
    async (repository: QuayRepository, enabled: boolean) => {
      try {
        const result = await postRequest<
          QuayRepositoryActionResponse,
          { repository: string; namespace: string; visibility: 'public' | 'private' }
        >(awxAPI`/quay/repositories/change-visibility/`, {
          repository: repository.name || '',
          namespace: repository.namespace || defaultNamespace,
          visibility: enabled ? 'public' : 'private',
        });
        alertToaster.addAlert({
          variant: 'success',
          title: t('Project Quay repository {{repository}} visibility updated.', {
            repository: result.repository_path,
          }),
          timeout: 4000,
        });
        await refreshQuay();
      } catch (err) {
        alertToaster.addAlert({
          variant: 'danger',
          title: t('Failed to update Project Quay repository visibility'),
          children: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [alertToaster, defaultNamespace, refreshQuay, t]
  );

  const deleteRepositories = useCallback(
    (repositories: QuayRepository[]) => {
      bulkAction({
        title: t('Delete Project Quay repositories', { count: repositories.length }),
        confirmText: t(
          'Yes, I confirm that I want to delete these {{count}} Project Quay repositories.',
          {
            count: repositories.length,
          }
        ),
        actionButtonText: t('Delete repositories', { count: repositories.length }),
        items: repositories,
        keyFn: (repository) =>
          repository._awx_key ||
          `${repository.namespace || defaultNamespace}/${repository.name || repository.id}`,
        isDanger: true,
        confirmationColumns: tableColumns,
        actionColumns: tableColumns.slice(0, 1),
        onComplete: () => void refreshQuay(),
        actionFn: (repository, signal) =>
          postRequest<QuayRepositoryActionResponse, { repository: string; namespace: string }>(
            awxAPI`/quay/repositories/delete/`,
            {
              repository: repository.name || '',
              namespace: repository.namespace || defaultNamespace,
            },
            signal
          ),
      });
    },
    [bulkAction, defaultNamespace, refreshQuay, t, tableColumns]
  );

  const toolbarActions = useMemo<IPageAction<QuayRepository>[]>(
    () =>
      canManageRepositories
        ? [
            {
              type: PageActionType.Button,
              selection: PageActionSelection.None,
              icon: PlusCircleIcon,
              isPinned: true,
              label: t('Create repository'),
              onClick: openCreateModal,
              variant: ButtonVariant.primary,
            },
            { type: PageActionType.Seperator },
            {
              type: PageActionType.Button,
              selection: PageActionSelection.Multiple,
              icon: TrashIcon,
              label: t('Delete repositories'),
              onClick: deleteRepositories,
              isDanger: true,
            },
          ]
        : [],
    [canManageRepositories, deleteRepositories, openCreateModal, t]
  );

  const rowActions = useMemo<IPageAction<QuayRepository>[]>(
    () =>
      canManageRepositories
        ? [
            {
              type: PageActionType.Switch,
              selection: PageActionSelection.Single,
              label: t('Public repository'),
              labelOff: t('Private repository'),
              ariaLabel: (isPublic) =>
                isPublic
                  ? t('Click to make repository private')
                  : t('Click to make repository public'),
              isSwitchOn: (repository) => Boolean(repository.is_public),
              onToggle: (repository, enabled) => void changeVisibility(repository, enabled),
              isDisabled: (repository) =>
                repository.name ? undefined : t('This repository does not include a name.'),
              isPinned: true,
            },
            {
              type: PageActionType.Button,
              selection: PageActionSelection.Single,
              icon: PencilAltIcon,
              label: t('Edit description'),
              onClick: openEditModal,
              isDisabled: (repository) =>
                repository.name ? undefined : t('This repository does not include a name.'),
            },
            {
              type: PageActionType.Button,
              selection: PageActionSelection.Single,
              icon: TrashIcon,
              label: t('Delete repository'),
              onClick: (repository) => deleteRepositories([repository]),
              isDisabled: (repository) =>
                repository.name ? undefined : t('This repository does not include a name.'),
              isDanger: true,
            },
          ]
        : [],
    [canManageRepositories, changeVisibility, deleteRepositories, openEditModal, t]
  );

  return (
    <PageLayout>
      <PageHeader
        title={t('Repositories')}
        description={t('Project Quay repositories visible to AWX for execution environments.')}
        headerActions={
          <ModuleAIAssistantAction
            module="quay"
            page={t('Project Quay repositories')}
            prompt={t(
              'Help me review Project Quay repositories for AWX execution environment images. Explain whether repository names, namespaces, and visibility look correct for AWX usage.'
            )}
            context={{
              namespace: statusData?.namespace,
              registry: statusData?.registry,
              can_manage: statusData?.can_manage,
              management_configured: statusData?.management_configured,
            }}
          />
        }
      />
      {statusData && (!statusData.configured || statusData.controller_error) ? (
        <Alert
          isInline
          variant="warning"
          title={t('Project Quay is not ready')}
          style={{ margin: '0 24px 16px' }}
        >
          {statusData.controller_error || statusData.message}
        </Alert>
      ) : null}
      {statusData && statusData.configured && !canManageQuay ? (
        <Alert
          isInline
          variant="info"
          title={t('Read-only Project Quay access')}
          style={{ margin: '0 24px 16px' }}
        >
          {t(
            'You can inspect Project Quay repositories, but repository management actions require Quay management permission.'
          )}
        </Alert>
      ) : null}
      {statusData && statusData.configured && canManageQuay && !canManageRepositories ? (
        <Alert
          isInline
          variant="warning"
          title={t('Project Quay repository management needs an API token.')}
          style={{ margin: '0 24px 16px' }}
        >
          {t(
            'Configure QUAY_API_TOKEN with repo:read, repo:create, repo:write, and repo:admin scopes before creating, editing, or deleting repositories from AWX.'
          )}
        </Alert>
      ) : null}
      <PageTable<QuayRepository>
        id="quay-repositories-table"
        toolbarFilters={toolbarFilters}
        tableColumns={tableColumns}
        toolbarActions={toolbarActions}
        rowActions={rowActions}
        emptyStateActions={toolbarActions.slice(0, 1)}
        errorStateTitle={t('Error loading Project Quay repositories')}
        emptyStateTitle={t('No Project Quay repositories found')}
        emptyStateDescription={t(
          'Configure Project Quay settings or push an execution environment image to populate this view.'
        )}
        {...view}
      />
      <Modal
        variant={ModalVariant.medium}
        title={
          modalMode === 'create'
            ? t('Create Project Quay repository')
            : t('Edit Project Quay repository')
        }
        isOpen={Boolean(modalMode)}
        onClose={closeModal}
        actions={[
          <Button
            key="submit"
            variant="primary"
            onClick={() => void submitRepositoryForm()}
            isDisabled={
              isSubmitting || !repositoryForm.repository.trim() || !repositoryForm.namespace.trim()
            }
          >
            {modalMode === 'create' ? t('Create repository') : t('Save')}
          </Button>,
          <Button key="cancel" variant="link" onClick={closeModal} isDisabled={isSubmitting}>
            {t('Cancel')}
          </Button>,
        ]}
      >
        <Form>
          <FormGroup label={t('Namespace')} fieldId="quay-repository-namespace" isRequired>
            <TextInput
              id="quay-repository-namespace"
              value={repositoryForm.namespace}
              onChange={(_event, value) =>
                setRepositoryForm((current) => ({ ...current, namespace: value }))
              }
            />
          </FormGroup>
          <FormGroup label={t('Repository')} fieldId="quay-repository-name" isRequired>
            <TextInput
              id="quay-repository-name"
              value={repositoryForm.repository}
              isDisabled={modalMode === 'edit'}
              onChange={(_event, value) =>
                setRepositoryForm((current) => ({ ...current, repository: value }))
              }
            />
          </FormGroup>
          {modalMode === 'create' ? (
            <FormGroup label={t('Visibility')} fieldId="quay-repository-visibility">
              <FormSelect
                id="quay-repository-visibility"
                value={repositoryForm.visibility}
                onChange={(_event, value) =>
                  setRepositoryForm((current) => ({
                    ...current,
                    visibility: value as 'public' | 'private',
                  }))
                }
              >
                <FormSelectOption value="private" label={t('Private')} />
                <FormSelectOption value="public" label={t('Public')} />
              </FormSelect>
            </FormGroup>
          ) : null}
          <FormGroup label={t('Description')} fieldId="quay-repository-description">
            <TextArea
              id="quay-repository-description"
              value={repositoryForm.description}
              onChange={(_event, value) =>
                setRepositoryForm((current) => ({ ...current, description: value }))
              }
            />
          </FormGroup>
        </Form>
      </Modal>
    </PageLayout>
  );
}
