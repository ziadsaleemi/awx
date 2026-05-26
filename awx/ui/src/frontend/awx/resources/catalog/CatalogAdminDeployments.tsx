import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ITableColumn,
  IToolbarFilter,
  PageHeader,
  PageLayout,
  PageTable,
  TextCell,
  ToolbarFilterType,
  usePageNavigate,
  usePageAlertToaster,
} from '../../../../framework';
import { awxAPI } from '../../common/api/awx-utils';
import { useAwxView } from '../../common/useAwxView';
import { usePostRequest } from '../../../common/crud/usePostRequest';
import { CatalogDeployment } from '../../interfaces/CatalogDeployment';
import { AwxRoute } from '../../main/AwxRoutes';
import { StatusCell } from '../../../common/Status';

export function CatalogAdminDeployments() {
  const { t } = useTranslation();
  const pageNavigate = usePageNavigate();
  const alertToaster = usePageAlertToaster();
  const postRequest = usePostRequest();

  const toolbarFilters = useAdminDeploymentFilters();
  const tableColumns = useAdminDeploymentColumns();

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

  const rowActions = useMemo(
    () => [
      {
        type: 'button' as const,
        selection: 'single' as const,
        label: t('View details'),
        onClick: (deployment: CatalogDeployment) =>
          pageNavigate(AwxRoute.CatalogDeploymentPage, { params: { id: String(deployment.id) } }),
      },
      {
        type: 'button' as const,
        selection: 'single' as const,
        label: t('Force deprovision'),
        isDanger: true,
        isDisabled: (deployment: CatalogDeployment) =>
          deployment.status === 'destroyed'
            ? t('Deployment is already destroyed.')
            : deployment.status === 'deprovisioning'
            ? t('Deprovision already in progress.')
            : '',
        onClick: handleDeprovision,
      },
    ],
    [handleDeprovision, pageNavigate, t]
  );

  return (
    <PageLayout>
      <PageHeader
        title={t('All Deployments')}
        description={t('Admin view of all catalog deployments across all users.')}
      />
      <PageTable<CatalogDeployment>
        id="catalog-admin-deployments-table"
        toolbarFilters={toolbarFilters}
        tableColumns={tableColumns}
        rowActions={rowActions}
        errorStateTitle={t('Error loading deployments')}
        emptyStateTitle={t('No deployments found')}
        emptyStateDescription={t('No catalog deployments have been created yet.')}
        {...view}
      />
    </PageLayout>
  );
}

function useAdminDeploymentFilters(): IToolbarFilter[] {
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
      {
        key: 'status',
        label: t('Status'),
        type: ToolbarFilterType.MultiText,
        query: 'status',
        comparison: 'equals',
      },
    ],
    [t]
  );
}

function useAdminDeploymentColumns(): ITableColumn<CatalogDeployment>[] {
  const { t } = useTranslation();
  const pageNavigate = usePageNavigate();
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
        header: t('Owner'),
        cell: (deployment) => (
          <TextCell text={deployment.summary_fields?.owner?.username ?? '-'} />
        ),
      },
      {
        header: t('Catalog item'),
        cell: (deployment) => (
          <TextCell text={deployment.summary_fields?.catalog_item?.name ?? '-'} />
        ),
      },
      {
        header: t('Status'),
        cell: (deployment) => <StatusCell status={deployment.status} />,
        sort: 'status',
      },
      {
        header: t('Deployed'),
        cell: (deployment) => <TextCell text={new Date(deployment.created).toLocaleString()} />,
        sort: 'created',
      },
    ],
    [pageNavigate, t]
  );
}
