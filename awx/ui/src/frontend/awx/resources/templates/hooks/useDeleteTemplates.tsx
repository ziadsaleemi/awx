import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { compareStrings } from '../../../../../framework';
import { useNameColumn } from '../../../../common/columns';
import { getItemKey, requestDelete } from '../../../../common/crud/Data';
import { awxAPI } from '../../../common/api/awx-utils';
import { useAwxBulkConfirmation } from '../../../common/useAwxBulkConfirmation';
import { JobTemplate } from '../../../interfaces/JobTemplate';
import { QuayImageBuildTemplate } from '../../../interfaces/QuayImageBuildTemplate';
import { TerraformJobTemplate } from '../../../interfaces/TerraformJobTemplate';
import { WorkflowJobTemplate } from '../../../interfaces/WorkflowJobTemplate';
import { useTemplateColumns } from './useTemplateColumns';

type Template = JobTemplate | WorkflowJobTemplate | TerraformJobTemplate | QuayImageBuildTemplate;

export function useDeleteTemplates(onComplete: (templates: Template[]) => void) {
  const { t } = useTranslation();
  const confirmationColumns = useTemplateColumns({ disableLinks: true, disableSort: true });
  const deleteActionNameColumn = useNameColumn({ disableLinks: true, disableSort: true });
  const actionColumns = useMemo(() => [deleteActionNameColumn], [deleteActionNameColumn]);
  const bulkAction = useAwxBulkConfirmation<Template>();
  const getSingularDeleteTitle = (type: string) =>
    type === 'job_template'
      ? t('Permanently delete job template')
      : type === 'terraform_job_template'
        ? t('Permanently delete terraform template')
        : type === 'quay_image_build_template'
          ? t('Permanently delete EE build template')
          : t('Permanently delete workflow job template');
  const deleteTemplates = (templates: Template[]) => {
    bulkAction({
      title:
        templates.length === 1
          ? getSingularDeleteTitle(templates[0].type)
          : t('Permanently delete templates'),
      confirmText: t('Yes, I confirm that I want to delete these {{count}} templates.', {
        count: templates.length,
      }),
      actionButtonText: t('Delete template', { count: templates.length }),
      items: templates.sort((l: { name: string }, r: { name: string }) =>
        compareStrings(l.name, r.name)
      ),
      keyFn: getItemKey,
      isDanger: true,
      confirmationColumns,
      actionColumns,
      onComplete,
      actionFn: (template: Template, signal) => {
        if (template.type === 'job_template') {
          return requestDelete(awxAPI`/job_templates/${template.id.toString()}/`, signal);
        } else if (template.type === 'terraform_job_template') {
          return requestDelete(awxAPI`/terraform_job_templates/${template.id.toString()}/`, signal);
        } else if (template.type === 'quay_image_build_template') {
          return requestDelete(
            awxAPI`/quay/execution-environment-images/templates/${template.id.toString()}/`,
            signal
          );
        } else {
          return requestDelete(awxAPI`/workflow_job_templates/${template.id.toString()}/`, signal);
        }
      },
    });
  };
  return deleteTemplates;
}
