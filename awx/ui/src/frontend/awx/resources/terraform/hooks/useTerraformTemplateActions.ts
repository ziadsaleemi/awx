import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { usePageNavigate, IPageAction, PageActionType, PageActionSelection } from '../../../../../framework';
import { ButtonVariant } from '@patternfly/react-core';
import { PencilAltIcon, TrashIcon, RocketIcon } from '@patternfly/react-icons';
import { useDeleteRequest } from '../../../../common/crud/useDeleteRequest';
import { usePageAlertToaster } from '../../../../../framework';
import { awxAPI } from '../../../common/api/awx-utils';
import { AwxRoute } from '../../../main/AwxRoutes';
import { TerraformJobTemplate } from '../../../interfaces/TerraformJobTemplate';

export function useTerraformTemplateActions({
  onTemplateDeleted,
}: {
  onTemplateDeleted?: () => void;
}): IPageAction<TerraformJobTemplate>[] {
  const { t } = useTranslation();
  const pageNavigate = usePageNavigate();
  const deleteRequest = useDeleteRequest();
  const alertToaster = usePageAlertToaster();

  const handleDelete = useCallback(
    async (template: TerraformJobTemplate) => {
      try {
        await deleteRequest(awxAPI`/terraform_job_templates/${template.id.toString()}/`);
        onTemplateDeleted?.();
      } catch (err) {
        alertToaster.addAlert({
          variant: 'danger',
          title: t('Failed to delete Terraform template'),
          children: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [alertToaster, deleteRequest, onTemplateDeleted, t]
  );

  return [
    {
      type: PageActionType.Button,
      selection: PageActionSelection.Single,
      variant: ButtonVariant.primary,
      isPinned: true,
      icon: RocketIcon,
      label: t('Launch template'),
      onClick: (template) =>
        pageNavigate(AwxRoute.TerraformTemplateLaunch, { params: { id: template.id } }),
      isDisabled: (template) =>
        template.summary_fields.user_capabilities.start ? undefined : t('No permission'),
    },
    {
      type: PageActionType.Button,
      selection: PageActionSelection.Single,
      variant: ButtonVariant.secondary,
      isPinned: true,
      icon: PencilAltIcon,
      label: t('Edit template'),
      onClick: (template) =>
        pageNavigate(AwxRoute.EditTerraformTemplate, { params: { id: template.id } }),
      isDisabled: (template) =>
        template.summary_fields.user_capabilities.edit ? undefined : t('No permission'),
    },
    {
      type: PageActionType.Seperator,
    },
    {
      type: PageActionType.Button,
      selection: PageActionSelection.Single,
      variant: ButtonVariant.plain,
      isDanger: true,
      icon: TrashIcon,
      label: t('Delete template'),
      onClick: handleDelete,
      isDisabled: (template) =>
        template.summary_fields.user_capabilities.delete ? undefined : t('No permission'),
    },
  ];
}
