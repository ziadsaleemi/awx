import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { IToolbarFilter, usePageDialog } from '../../../../../framework';
import { SingleSelectDialog } from '../../../../../framework/PageDialogs/SingleSelectDialog';
import { awxAPI } from '../../../common/api/awx-utils';
import { useAwxView } from '../../../common/useAwxView';
import { TerraformJobTemplate } from '../../../interfaces/TerraformJobTemplate';
import { useTemplateColumns } from './useTemplateColumns';
import {
  useCreatedByToolbarFilter,
  useDescriptionToolbarFilter,
  useModifiedByToolbarFilter,
  useNameToolbarFilter,
} from '../../../common/awx-toolbar-filters';

function SelectTerraformJobTemplate(props: {
  title: string;
  onSelect: (template: TerraformJobTemplate) => void;
}) {
  const nameToolbarFilter = useNameToolbarFilter();
  const descriptionToolbarFilter = useDescriptionToolbarFilter();
  const createdByToolbarFilter = useCreatedByToolbarFilter();
  const modifiedByToolbarFilter = useModifiedByToolbarFilter();
  const toolbarFilters = useMemo<IToolbarFilter[]>(
    () => [
      nameToolbarFilter,
      descriptionToolbarFilter,
      createdByToolbarFilter,
      modifiedByToolbarFilter,
    ],
    [nameToolbarFilter, descriptionToolbarFilter, createdByToolbarFilter, modifiedByToolbarFilter]
  );
  const tableColumns = useTemplateColumns({ disableLinks: true });
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
