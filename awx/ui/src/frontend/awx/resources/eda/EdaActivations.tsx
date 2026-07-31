import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Alert, ButtonVariant } from '@patternfly/react-core';
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
  useGetPageUrl,
  usePageAlertToaster,
  usePageNavigate,
} from '../../../../framework';
import { requestDelete } from '../../../common/crud/Data';
import { useGet } from '../../../common/crud/useGet';
import { usePostRequest } from '../../../common/crud/usePostRequest';
import { StatusCell } from '../../../common/Status';
import { AwxError } from '../../common/AwxError';
import { awxAPI } from '../../common/api/awx-utils';
import { useAwxActiveUser } from '../../common/useAwxActiveUser';
import { useAwxView } from '../../common/useAwxView';
import {
  EdaActivation,
  EdaActivationActionResponse,
  EdaStatus,
} from '../../interfaces/EdaActivation';
import { useAwxNavigationCapabilities } from '../../main/awxNavigationCapabilities';
import { AwxRoute } from '../../main/AwxRoutes';

export function EdaActivations() {
  const { t } = useTranslation();
  const alertToaster = usePageAlertToaster();
  const navigate = useNavigate();
  const pageNavigate = usePageNavigate();
  const postRequest = usePostRequest<unknown, EdaActivationActionResponse>();
  const { activeAwxUser } = useAwxActiveUser();
  const capabilities = useAwxNavigationCapabilities(activeAwxUser);
  const canOperateEda = Boolean(activeAwxUser?.is_superuser) || Boolean(capabilities.canOperateEda);
  const canManageEda = Boolean(activeAwxUser?.is_superuser) || Boolean(capabilities.canManageEda);
  const tableColumns = useEdaActivationColumns();
  const {
    data: status,
    error: statusError,
    refresh: refreshStatus,
  } = useGet<EdaStatus>(awxAPI`/eda/status/`);
  const view = useAwxView<EdaActivation>({
    url: awxAPI`/eda/activations/`,
    tableColumns,
  });

  const runAction = useCallback(
    async (activation: EdaActivation, action: 'enable' | 'disable' | 'restart') => {
      try {
        await postRequest(awxAPI`/eda/activations/${String(activation.id)}/${action}/`, {});
        alertToaster.addAlert({
          variant: 'success',
          title: t('EDA activation {{action}} requested for "{{name}}"', {
            action,
            name: activation.name,
          }),
          timeout: 4000,
        });
        await view.refresh();
      } catch (err) {
        alertToaster.addAlert({
          variant: 'danger',
          title: t('Failed to update EDA activation'),
          children: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [alertToaster, postRequest, t, view]
  );

  const deleteActivation = useCallback(
    async (activation: EdaActivation) => {
      try {
        await requestDelete(
          awxAPI`/eda/activations/${String(activation.id)}/`,
          new AbortController().signal
        );
        alertToaster.addAlert({
          variant: 'success',
          title: t('EDA activation delete requested for "{{name}}"', { name: activation.name }),
          timeout: 4000,
        });
        await view.refresh();
      } catch (err) {
        alertToaster.addAlert({
          variant: 'danger',
          title: t('Failed to delete EDA activation'),
          children: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [alertToaster, t, view]
  );

  const toolbarActions = useMemo<IPageAction<EdaActivation>[]>(
    () => [
      {
        type: PageActionType.Button,
        selection: PageActionSelection.None,
        variant: ButtonVariant.primary,
        isPinned: true,
        icon: PlusCircleIcon,
        label: t('Create/start activation'),
        isDisabled: !canOperateEda
          ? t('You need EDA operator or administrator permissions to start activations.')
          : undefined,
        onClick: () => navigate('/eda/activations/create'),
      },
    ],
    [canOperateEda, navigate, t]
  );

  const rowActions = useMemo<IPageAction<EdaActivation>[]>(
    () => [
      {
        type: PageActionType.Button,
        selection: PageActionSelection.Single,
        label: t('View details'),
        onClick: (activation) =>
          pageNavigate(AwxRoute.EdaActivationPage, {
            params: { id: String(activation.id) },
          }),
      },
      {
        type: PageActionType.Button,
        selection: PageActionSelection.Single,
        label: t('Restart'),
        isDisabled: !canOperateEda
          ? t('You need EDA operator or administrator permissions to restart activations.')
          : undefined,
        onClick: (activation) => void runAction(activation, 'restart'),
      },
      {
        type: PageActionType.Button,
        selection: PageActionSelection.Single,
        label: t('Enable'),
        isDisabled: !canOperateEda
          ? t('You need EDA operator or administrator permissions to enable activations.')
          : undefined,
        onClick: (activation) => void runAction(activation, 'enable'),
      },
      {
        type: PageActionType.Button,
        selection: PageActionSelection.Single,
        label: t('Disable'),
        isDisabled: !canOperateEda
          ? t('You need EDA operator or administrator permissions to disable activations.')
          : undefined,
        onClick: (activation) => void runAction(activation, 'disable'),
      },
      {
        type: PageActionType.Button,
        selection: PageActionSelection.Single,
        label: t('Delete'),
        isDanger: true,
        isDisabled: !canManageEda
          ? t('You need EDA administrator permissions to delete activations.')
          : undefined,
        onClick: (activation) => void deleteActivation(activation),
      },
    ],
    [canManageEda, canOperateEda, deleteActivation, pageNavigate, runAction, t]
  );

  if (statusError) return <AwxError error={statusError} handleRefresh={refreshStatus} />;

  return (
    <PageLayout>
      <PageHeader
        title={t('Rulebook Activations')}
        description={t(
          'Create, start, inspect, and manage Event-Driven Ansible rulebook activations.'
        )}
      />
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
      <PageTable<EdaActivation>
        id="eda-activations-table"
        tableColumns={tableColumns}
        toolbarActions={toolbarActions}
        rowActions={rowActions}
        errorStateTitle={t('Error loading EDA activations')}
        emptyStateTitle={t('No EDA activations found')}
        emptyStateDescription={t('Create an activation or configure the EDA Controller settings.')}
        emptyStateButtonIcon={canOperateEda ? <PlusCircleIcon /> : undefined}
        emptyStateButtonText={canOperateEda ? t('Create/start activation') : undefined}
        emptyStateButtonClick={
          canOperateEda ? () => navigate('/eda/activations/create') : undefined
        }
        {...view}
      />
    </PageLayout>
  );
}

function useEdaActivationColumns(): ITableColumn<EdaActivation>[] {
  const { t } = useTranslation();
  const getPageUrl = useGetPageUrl();
  return useMemo(
    () => [
      {
        header: t('Name'),
        cell: (activation) => (
          <TextCell
            text={activation.name || String(activation.id)}
            to={getPageUrl(AwxRoute.EdaActivationPage, {
              params: { id: String(activation.id) },
            })}
          />
        ),
        sort: 'name',
        card: 'name',
        list: 'name',
      },
      {
        header: t('Status'),
        cell: (activation) => <StatusCell status={activation.status} />,
      },
      {
        header: t('Rulebook'),
        cell: (activation) => <TextCell text={activation.rulebook || '-'} />,
      },
      {
        header: t('Event source'),
        cell: (activation) => <TextCell text={activation.event_source || '-'} />,
      },
      {
        header: t('Started'),
        cell: (activation) => (
          <TextCell
            text={activation.started ? new Date(activation.started).toLocaleString() : '-'}
          />
        ),
      },
      {
        header: t('Finished'),
        cell: (activation) => (
          <TextCell
            text={activation.finished ? new Date(activation.finished).toLocaleString() : '-'}
          />
        ),
      },
    ],
    [getPageUrl, t]
  );
}
