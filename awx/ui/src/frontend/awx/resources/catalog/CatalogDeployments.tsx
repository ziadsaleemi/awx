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
} from '../../../../framework';
import { awxAPI } from '../../common/api/awx-utils';
import { useAwxView } from '../../common/useAwxView';
import { CatalogDeployment } from '../../interfaces/CatalogDeployment';
import { AwxRoute } from '../../main/AwxRoutes';
import { StatusCell } from '../../../common/Status';
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
        label: t('Deprovision'),
        isDanger: true,
        isDisabled: (deployment: CatalogDeployment) =>
          ['deprovisioning', 'destroyed', 'provisioning'].includes(deployment.status)
            ? t('Deployment cannot be deprovisioned in its current state.')
            : '',
        onClick: handleDeprovision,
      },
    ],
    [handleDeprovision, pageNavigate, t]
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
