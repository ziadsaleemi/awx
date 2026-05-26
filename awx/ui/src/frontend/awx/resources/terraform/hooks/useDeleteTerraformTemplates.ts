import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useDeleteRequest } from '../../../../common/crud/useDeleteRequest';
import { usePostRequest } from '../../../../common/crud/usePostRequest';
import { awxAPI } from '../../../common/api/awx-utils';
import { TerraformJobTemplate } from '../../../interfaces/TerraformJobTemplate';
import { usePageAlertToaster } from '../../../../../framework';

export function useDeleteTerraformTemplates(
  onComplete?: (deletedTemplates: TerraformJobTemplate[]) => void
) {
  const { t } = useTranslation();
  const deleteRequest = useDeleteRequest();
  const alertToaster = usePageAlertToaster();

  return useCallback(
    async (templates: TerraformJobTemplate[]) => {
      const deleted: TerraformJobTemplate[] = [];
      const errors: string[] = [];

      for (const template of templates) {
        try {
          await deleteRequest(awxAPI`/terraform_job_templates/${template.id.toString()}/`);
          deleted.push(template);
        } catch (err) {
          errors.push(
            t('Failed to delete {{name}}: {{error}}', {
              name: template.name,
              error: err instanceof Error ? err.message : String(err),
            })
          );
        }
      }

      if (errors.length) {
        alertToaster.addAlert({
          variant: 'danger',
          title: t('Failed to delete one or more Terraform templates'),
          children: errors.join(', '),
        });
      }

      if (deleted.length && onComplete) {
        onComplete(deleted);
      }
    },
    [alertToaster, deleteRequest, onComplete, t]
  );
}
