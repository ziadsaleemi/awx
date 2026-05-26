import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ITableColumn, IToolbarFilter, ToolbarFilterType, usePageDialog } from '../../../../../framework';
import { SingleSelectDialog } from '../../../../../framework/PageDialogs/SingleSelectDialog';
import { awxAPI } from '../../../common/api/awx-utils';
import { useAwxView } from '../../../common/useAwxView';
import { TerraformJobTemplate } from '../../../interfaces/TerraformJobTemplate';

function SelectTerraformJobTemplate(props: {
  title: string;
  onSelect: (template: TerraformJobTemplate) => void;
}) {
  const { t } = useTranslation();
  const toolbarFilters = useMemo<IToolbarFilter[]>(
    () => [
      {
        key: 'name',
        label: t('Name'),
        type: ToolbarFilterType.SingleText,
        query: 'name__icontains',
        comparison: 'contains',
      },
    ],
    [t]
  );
  const tableColumns = useMemo<ITableColumn<TerraformJobTemplate>[]>(
    () => [
      {
        header: t('Name'),
        cell: (template) => template.name,
        sort: 'name',
        defaultSort: true,
        card: 'name',
        list: 'name',
        value: (template) => template.name,
      },
      {
        header: t('Project'),
        cell: (template) => template.summary_fields?.project?.name ?? '-',
      },
      {
        header: t('Directory'),
        cell: (template) => template.terraform_dir || '.',
      },
    ],
    [t]
  );
  const view = useAwxView<TerraformJobTemplate>({
    url: awxAPI`/terraform_job_templates/`,
    toolbarFilters,
    tableColumns,
    disableQueryString: true,
  });
  return (
    <SingleSelectDialog<TerraformJobTemplate>
      {...props}
      toolbarFilters={toolbarFilters}
      tableColumns={tableColumns}
      view={view}
    />
  );
}

export function useSelectTerraformJobTemplate() {
  const [_, setDialog] = usePageDialog();
  const { t } = useTranslation();
  const openSelectDialog = useCallback(
    (onSelect: (template: TerraformJobTemplate) => void) => {
      setDialog(
        <SelectTerraformJobTemplate
          title={t('Select Terraform template')}
          onSelect={onSelect}
        />
      );
    },
    [setDialog, t]
  );
  return openSelectDialog;
}
