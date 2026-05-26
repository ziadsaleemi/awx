import { useMemo } from 'react';
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
import { ButtonVariant } from '@patternfly/react-core';
import { PlusCircleIcon } from '@patternfly/react-icons';
import { awxAPI } from '../../common/api/awx-utils';
import { useAwxView } from '../../common/useAwxView';
import { useOptions } from '../../../common/crud/useOptions';
import { OptionsResponse, ActionsResponse } from '../../interfaces/OptionsResponse';
import { CatalogItem } from '../../interfaces/CatalogItem';
import { AwxRoute } from '../../main/AwxRoutes';
import { useDeleteCatalogItems } from './hooks/useDeleteCatalogItems';

export function CatalogItems() {
  const { t } = useTranslation();
  const pageNavigate = usePageNavigate();

  const toolbarFilters = useCatalogItemFilters();
  const tableColumns = useCatalogItemColumns();

  const view = useAwxView<CatalogItem>({
    url: awxAPI`/catalog_items/`,
    toolbarFilters,
    tableColumns,
  });

  const deleteCatalogItems = useDeleteCatalogItems(view.unselectItemsAndRefresh);

  const { data } = useOptions<OptionsResponse<ActionsResponse>>(awxAPI`/catalog_items/`);
  const canCreate = Boolean(data?.actions?.['POST']);

  const toolbarActions = useMemo(
    () => [
      {
        type: 'button' as const,
        selection: 'none' as const,
        variant: ButtonVariant.primary,
        isPinned: true,
        label: t('Create catalog item'),
        icon: <PlusCircleIcon />,
        onClick: () => pageNavigate(AwxRoute.CreateCatalogItem),
        isDisabled: () =>
          canCreate
            ? ''
            : t('You do not have permission to create catalog items.'),
      },
      {
        type: 'bulk' as const,
        selection: 'multiple' as const,
        label: t('Delete selected'),
        onClick: deleteCatalogItems,
        isDanger: true,
      },
    ],
    [canCreate, deleteCatalogItems, pageNavigate, t]
  );

  const rowActions = useMemo(
    () => [
      {
        type: 'button' as const,
        selection: 'single' as const,
        label: t('Edit'),
        onClick: (item: CatalogItem) =>
          pageNavigate(AwxRoute.EditCatalogItem, { params: { id: String(item.id) } }),
        isDisabled: (item: CatalogItem) =>
          item.summary_fields?.user_capabilities?.edit ? '' : t('No permission'),
      },
      {
        type: 'button' as const,
        selection: 'single' as const,
        label: t('Delete'),
        isDanger: true,
        onClick: (item: CatalogItem) => deleteCatalogItems([item]),
        isDisabled: (item: CatalogItem) =>
          item.summary_fields?.user_capabilities?.delete ? '' : t('No permission'),
      },
    ],
    [deleteCatalogItems, pageNavigate, t]
  );

  return (
    <PageLayout>
      <PageHeader
        title={t('Catalog Items')}
        description={t('Manage the service catalog items available to users.')}
      />
      <PageTable<CatalogItem>
        id="catalog-items-table"
        toolbarFilters={toolbarFilters}
        tableColumns={tableColumns}
        toolbarActions={toolbarActions}
        rowActions={rowActions}
        errorStateTitle={t('Error loading catalog items')}
        emptyStateTitle={t('No catalog items')}
        emptyStateDescription={t('Create a catalog item to get started.')}
        {...view}
      />
    </PageLayout>
  );
}

function useCatalogItemFilters(): IToolbarFilter[] {
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

function useCatalogItemColumns(): ITableColumn<CatalogItem>[] {
  const { t } = useTranslation();
  const pageNavigate = usePageNavigate();
  return useMemo(
    () => [
      {
        header: t('Name'),
        cell: (item) => (
          <TextCell
            text={item.name}
            onClick={() =>
              pageNavigate(AwxRoute.CatalogItemPage, { params: { id: String(item.id) } })
            }
          />
        ),
        sort: 'name',
        card: 'name',
        list: 'name',
      },
      {
        header: t('Description'),
        cell: (item) => <TextCell text={item.description || '-'} />,
      },
      {
        header: t('Organization'),
        cell: (item) => (
          <TextCell text={item.summary_fields?.organization?.name ?? '-'} />
        ),
      },
      {
        header: t('Provision'),
        cell: (item) => (
          <TextCell
            text={
              item.summary_fields?.terraform_job_template?.name
                ? `${item.summary_fields.terraform_job_template.name} (Terraform)`
                : (item.summary_fields?.provision_workflow?.name ?? '-')
            }
          />
        ),
      },
    ],
    [pageNavigate, t]
  );
}
