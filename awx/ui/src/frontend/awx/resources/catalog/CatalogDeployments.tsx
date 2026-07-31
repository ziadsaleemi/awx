import { useCallback, useMemo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Label } from '@patternfly/react-core';
import {
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
  useGetPageUrl,
  usePageNavigate,
} from '../../../../framework';
import { awxAPI } from '../../common/api/awx-utils';
import { useAwxView } from '../../common/useAwxView';
import { CatalogDeployment } from '../../interfaces/CatalogDeployment';
import { AwxRoute } from '../../main/AwxRoutes';
import { StatusCell } from '../../../common/Status';
import { terraformJobOutputRoute, workflowJobOutputRoute } from './catalogJobRoutes';

/** Format seconds into a human-readable duration like "3 h 22 m" or "45 m". */
function formatSeconds(totalSeconds: number): string {
  if (totalSeconds <= 0) return '0 m';
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days} d ${hours} h`;
  if (hours > 0) return `${hours} h ${mins} m`;
  return `${mins} m`;
}

/** Live countdown badge; colour shifts as expiry approaches. */
function LeaseCountdown({ expiresAt }: { expiresAt: string | null | undefined }) {
  const { t } = useTranslation();
  const [secondsLeft, setSecondsLeft] = useState<number>(() => {
    if (!expiresAt) return -1;
    return Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  });

  useEffect(() => {
    if (!expiresAt) return;
    const id = setInterval(() => {
      setSecondsLeft(Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)));
    }, 30_000);
    return () => clearInterval(id);
  }, [expiresAt]);

  if (!expiresAt)
    return <span style={{ color: 'var(--pf-v5-global--Color--200)' }}>{t('No limit')}</span>;
  if (secondsLeft <= 0)
    return (
      <Label color="red" isCompact>
        {t('Expired')}
      </Label>
    );

  const color = secondsLeft <= 3600 ? 'red' : secondsLeft <= 14400 ? 'orange' : 'green';
  return (
    <Label color={color} isCompact>
      {formatSeconds(secondsLeft)}
    </Label>
  );
}
import { usePostRequest } from '../../../common/crud/usePostRequest';
import { usePageAlertToaster } from '../../../../framework';

export function CatalogDeployments() {
  const { t } = useTranslation();
  const pageNavigate = usePageNavigate();
  const alertToaster = usePageAlertToaster();
  const postRequest = usePostRequest();

  const toolbarFilters = useCatalogDeploymentFilters();
  const tableColumns = useCatalogDeploymentColumns();

  const view = useAwxView<CatalogDeployment>({
    url: awxAPI`/catalog_deployments/`,
    toolbarFilters,
    tableColumns,
  });

  const handleDeprovision = useCallback(
    async (deployment: CatalogDeployment) => {
      try {
        await postRequest(awxAPI`/catalog_deployments/${String(deployment.id)}/deprovision/`, {});
        alertToaster.addAlert({
          variant: 'success',
          title: t('Deprovision started for "{{name}}"', { name: deployment.name }),
          timeout: 4000,
        });
        void view.refresh();
      } catch (err) {
        alertToaster.addAlert({
          variant: 'danger',
          title: t('Failed to deprovision'),
          children: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [alertToaster, postRequest, t, view]
  );

  const handleRetry = useCallback(
    async (deployment: CatalogDeployment) => {
      try {
        await postRequest(awxAPI`/catalog_deployments/${String(deployment.id)}/retry/`, {});
        alertToaster.addAlert({
          variant: 'success',
          title: t('Retry started for "{{name}}"', { name: deployment.name }),
          timeout: 4000,
        });
        void view.refresh();
      } catch (err) {
        alertToaster.addAlert({
          variant: 'danger',
          title: t('Failed to retry deployment'),
          children: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [alertToaster, postRequest, t, view]
  );

  const handleCancel = useCallback(
    async (deployment: CatalogDeployment) => {
      try {
        await postRequest(awxAPI`/catalog_deployments/${String(deployment.id)}/cancel/`, {});
        alertToaster.addAlert({
          variant: 'success',
          title: t('Cancelled "{{name}}"', { name: deployment.name }),
          timeout: 4000,
        });
        void view.refresh();
      } catch (err) {
        alertToaster.addAlert({
          variant: 'danger',
          title: t('Failed to cancel deployment'),
          children: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [alertToaster, postRequest, t, view]
  );

  const rowActions = useMemo<IPageAction<CatalogDeployment>[]>(
    () => [
      {
        type: PageActionType.Button,
        selection: PageActionSelection.Single,
        label: t('View details'),
        onClick: (deployment: CatalogDeployment) =>
          pageNavigate(AwxRoute.CatalogDeploymentPage, { params: { id: String(deployment.id) } }),
      },
      {
        type: PageActionType.Button,
        selection: PageActionSelection.Single,
        label: t('Cancel'),
        isDanger: true,
        isDisabled: (deployment: CatalogDeployment) =>
          !['provisioning', 'deprovisioning'].includes(deployment.status)
            ? t('Only deployments that are provisioning or deprovisioning can be cancelled.')
            : undefined,
        onClick: handleCancel,
      },
      {
        type: PageActionType.Button,
        selection: PageActionSelection.Single,
        label: t('Retry provision'),
        isDisabled: (deployment: CatalogDeployment) =>
          deployment.status !== 'failed' || !deployment.summary_fields?.user_capabilities?.retry
            ? t('Only failed deployments can be retried.')
            : undefined,
        onClick: handleRetry,
      },
      {
        type: PageActionType.Button,
        selection: PageActionSelection.Single,
        label: t('Deprovision'),
        isDanger: true,
        isDisabled: (deployment: CatalogDeployment) =>
          ['deprovisioning', 'destroyed', 'provisioning'].includes(deployment.status)
            ? t('Deployment cannot be deprovisioned in its current state.')
            : undefined,
        onClick: handleDeprovision,
      },
    ],
    [handleCancel, handleDeprovision, handleRetry, pageNavigate, t]
  );

  return (
    <PageLayout>
      <PageHeader
        title={t('My Deployments')}
        description={t('View and manage your catalog deployments.')}
      />
      <PageTable<CatalogDeployment>
        id="catalog-deployments-table"
        toolbarFilters={toolbarFilters}
        tableColumns={tableColumns}
        rowActions={rowActions}
        errorStateTitle={t('Error loading deployments')}
        emptyStateTitle={t('No deployments yet')}
        emptyStateDescription={t('Deploy a catalog item to see it here.')}
        {...view}
      />
    </PageLayout>
  );
}

function useCatalogDeploymentFilters(): IToolbarFilter[] {
  const { t } = useTranslation();
  return useMemo(
    () => [
      {
        key: 'name',
        label: t('Name'),
        type: ToolbarFilterType.MultiText,
        query: 'name__icontains',
        comparison: 'contains',
      },
    ],
    [t]
  );
}

function useCatalogDeploymentColumns(): ITableColumn<CatalogDeployment>[] {
  const { t } = useTranslation();
  const pageNavigate = usePageNavigate();
  const getPageUrl = useGetPageUrl();
  return useMemo(
    () => [
      {
        header: t('Name'),
        cell: (deployment) => (
          <TextCell
            text={deployment.name}
            onClick={() =>
              pageNavigate(AwxRoute.CatalogDeploymentPage, {
                params: { id: String(deployment.id) },
              })
            }
          />
        ),
        sort: 'name',
        card: 'name',
        list: 'name',
      },
      {
        header: t('Catalog item'),
        cell: (deployment) => (
          <TextCell text={deployment.summary_fields?.catalog_item?.name ?? '-'} />
        ),
      },
      {
        header: t('Organization'),
        cell: (deployment) => (
          <TextCell text={deployment.summary_fields?.organization?.name ?? '-'} />
        ),
      },
      {
        header: t('Provision details'),
        cell: (deployment) => {
          const route = deployment.terraform_provision_job
            ? terraformJobOutputRoute(deployment.terraform_provision_job)
            : workflowJobOutputRoute(deployment.provision_job);
          return (
            <TextCell
              text={
                deployment.terraform_provision_job
                  ? t('Terraform #{{id}}', { id: deployment.terraform_provision_job })
                  : deployment.provision_job
                    ? t('Workflow #{{id}}', { id: deployment.provision_job })
                    : '-'
              }
              to={route ? getPageUrl(route.route, { params: route.params }) : undefined}
            />
          );
        },
      },
      {
        header: t('Status'),
        cell: (deployment) => <StatusCell status={deployment.status} />,
        sort: 'status',
      },
      {
        header: t('Lease'),
        cell: (deployment) => <LeaseCountdown expiresAt={deployment.expires_at} />,
      },
      {
        header: t('Deployed'),
        cell: (deployment) => <TextCell text={new Date(deployment.created).toLocaleString()} />,
        sort: 'created',
        defaultSort: true,
        defaultSortDirection: 'desc',
      },
    ],
    [getPageUrl, pageNavigate, t]
  );
}
