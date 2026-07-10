import { useTranslation } from 'react-i18next';
import {
  IPageAction,
  ITableColumn,
  IToolbarFilter,
  PageActionSelection,
  PageActionType,
  PageHeader,
  PageLayout,
  PageTable,
  ToolbarFilterType,
  usePageNavigate,
} from '../../../../framework';
import { awxAPI } from '../../common/api/awx-utils';
import { useAwxView } from '../../common/useAwxView';
import { AwxRoute } from '../../main/AwxRoutes';
import { TerraformJobTemplate } from '../../interfaces/TerraformJobTemplate';
import { PlusCircleIcon } from '@patternfly/react-icons';
import { useMemo } from 'react';
import { ButtonVariant } from '@patternfly/react-core';
import { useOptions } from '../../../common/crud/useOptions';
import { OptionsResponse, ActionsResponse } from '../../interfaces/OptionsResponse';
import { StatusCell } from '../../../common/Status';
import { useDeleteTerraformTemplates } from './hooks/useDeleteTerraformTemplates';

export function TerraformTemplates() {
  const { t } = useTranslation();
  const pageNavigate = usePageNavigate();

  const toolbarFilters = useTerraformTemplatesFilters();
  const tableColumns = useTerraformTemplatesColumns();

  const view = useAwxView<TerraformJobTemplate>({
    url: awxAPI`/terraform_job_templates/`,
    toolbarFilters,
    tableColumns,
  });

  const deleteTerraformTemplates = useDeleteTerraformTemplates(view.unselectItemsAndRefresh);

  const { data } = useOptions<OptionsResponse<ActionsResponse>>(awxAPI`/terraform_job_templates/`);
  const canCreate = Boolean(data?.actions?.['POST']);

  const toolbarActions = useMemo<IPageAction<TerraformJobTemplate>[]>(
    () => [
      {
        type: PageActionType.Button,
        selection: PageActionSelection.None,
        variant: ButtonVariant.primary,
        isPinned: true,
        label: t('Create Terraform template'),
        icon: PlusCircleIcon,
        onClick: () => pageNavigate(AwxRoute.CreateTerraformTemplate),
        isDisabled: () =>
          canCreate
            ? undefined
            : t(
                'You do not have permission to create a Terraform template. Please contact your organization administrator.'
              ),
      },
      {
        type: PageActionType.Button,
        selection: PageActionSelection.Multiple,
        variant: ButtonVariant.danger,
        label: t('Delete selected'),
        onClick: deleteTerraformTemplates,
      },
    ],
    [canCreate, deleteTerraformTemplates, pageNavigate, t]
  );

  const rowActions = useMemo<IPageAction<TerraformJobTemplate>[]>(
    () => [
      {
        type: PageActionType.Button,
        selection: PageActionSelection.Single,
        label: t('Edit'),
        onClick: (template: TerraformJobTemplate) =>
          pageNavigate(AwxRoute.EditTerraformTemplate, { params: { id: template.id } }),
        isDisabled: (template: TerraformJobTemplate) =>
          template.summary_fields.user_capabilities.edit ? undefined : t('No permission'),
      },
      {
        type: PageActionType.Button,
        selection: PageActionSelection.Single,
        label: t('Launch'),
        onClick: (template: TerraformJobTemplate) =>
          pageNavigate(AwxRoute.TerraformTemplateLaunch, { params: { id: template.id } }),
        isDisabled: (template: TerraformJobTemplate) =>
          template.summary_fields.user_capabilities.start ? undefined : t('No permission'),
      },
      {
        type: PageActionType.Button,
        selection: PageActionSelection.Single,
        label: t('Delete'),
        isDanger: true,
        onClick: (template: TerraformJobTemplate) => deleteTerraformTemplates([template]),
        isDisabled: (template: TerraformJobTemplate) =>
          template.summary_fields.user_capabilities.delete ? undefined : t('No permission'),
      },
    ],
    [deleteTerraformTemplates, pageNavigate, t]
  );

  return (
    <PageLayout>
      <PageHeader
        title={t('Terraform Templates')}
        description={t(
          'Terraform templates define how Capstan runs Terraform against a project — the working directory, extra variables, credentials, and inventory to populate after apply.'
        )}
        titleHelpTitle={t('Terraform Template')}
        titleHelp={t(
          'A Terraform template links an SCM project to a Terraform configuration directory and defines the default operation (apply, plan, or destroy), variables, and credentials used for each run.'
        )}
      />
      <PageTable<TerraformJobTemplate>
        id="awx-terraform-templates-table"
        toolbarFilters={toolbarFilters}
        toolbarActions={toolbarActions}
        tableColumns={tableColumns}
        rowActions={rowActions}
        errorStateTitle={t('Error loading Terraform templates')}
        emptyStateTitle={
          canCreate
            ? t('There are currently no Terraform templates')
            : t('You do not have permission to create a Terraform template.')
        }
        emptyStateDescription={
          canCreate
            ? t('Please create a Terraform template by using the button below.')
            : t(
                'Please contact your organization administrator if there is an issue with your access.'
              )
        }
        emptyStateButtonIcon={<PlusCircleIcon />}
        emptyStateButtonText={canCreate ? t('Create Terraform template') : undefined}
        emptyStateButtonClick={
          canCreate ? () => pageNavigate(AwxRoute.CreateTerraformTemplate) : undefined
        }
        {...view}
        defaultSubtitle={t('Terraform Template')}
      />
    </PageLayout>
  );
}

function useTerraformTemplatesFilters(): IToolbarFilter[] {
  const { t } = useTranslation();
  return useMemo<IToolbarFilter[]>(
    () => [
      {
        key: 'name',
        label: t('Name'),
        type: ToolbarFilterType.SingleText,
        query: 'name__icontains',
        comparison: 'contains',
      },
      {
        key: 'description',
        label: t('Description'),
        type: ToolbarFilterType.SingleText,
        query: 'description__icontains',
        comparison: 'contains',
      },
    ],
    [t]
  );
}

function useTerraformTemplatesColumns(): ITableColumn<TerraformJobTemplate>[] {
  const { t } = useTranslation();
  const pageNavigate = usePageNavigate();

  return useMemo<ITableColumn<TerraformJobTemplate>[]>(
    () => [
      {
        header: t('Name'),
        cell: (template) => template.name,
        sort: 'name',
        defaultSort: true,
        card: 'name',
        list: 'name',
        value: (template: TerraformJobTemplate) => template.name,
        onClick: (template: TerraformJobTemplate) =>
          pageNavigate(AwxRoute.TerraformTemplatePage, { params: { id: template.id } }),
      },
      {
        header: t('Status'),
        cell: (template) => (template.status ? <StatusCell status={template.status} /> : <></>),
        sort: 'status',
      },
      {
        header: t('Operation'),
        cell: (template) => template.terraform_operation,
        sort: 'terraform_operation',
      },
      {
        header: t('Project'),
        cell: (template) => template.summary_fields?.project?.name ?? '-',
        sort: 'project__name',
      },
      {
        header: t('Directory'),
        cell: (template) => template.terraform_dir || '.',
        sort: 'terraform_dir',
      },
      {
        header: t('Last run'),
        cell: (template) =>
          template.last_job_run ? new Date(template.last_job_run).toLocaleString() : t('Never'),
        sort: 'last_job_run',
      },
    ],
    [pageNavigate, t]
  );
}
