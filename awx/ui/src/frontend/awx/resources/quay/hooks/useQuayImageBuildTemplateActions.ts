import { ButtonVariant } from '@patternfly/react-core';
import { PencilAltIcon, RocketIcon, TrashIcon } from '@patternfly/react-icons';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IPageAction,
  PageActionSelection,
  PageActionType,
  usePageAlertToaster,
  usePageNavigate,
} from '../../../../../framework';
import { useDeleteRequest } from '../../../../common/crud/useDeleteRequest';
import { usePostRequest } from '../../../../common/crud/usePostRequest';
import { awxAPI } from '../../../common/api/awx-utils';
import { QuayImageBuildTemplate } from '../../../interfaces/QuayImageBuildTemplate';
import { AwxRoute } from '../../../main/AwxRoutes';

type QuayBuildLaunch = {
  id: number;
  unified_job?: {
    id: number;
    url: string;
    status: string;
  } | null;
};

export function useQuayImageBuildTemplateActions(props: {
  onTemplateDeleted?: () => void;
}): IPageAction<QuayImageBuildTemplate>[] {
  const { t } = useTranslation();
  const pageNavigate = usePageNavigate();
  const deleteRequest = useDeleteRequest();
  const postRequest = usePostRequest<object, QuayBuildLaunch>();
  const alertToaster = usePageAlertToaster();

  const handleLaunch = useCallback(
    async (template: QuayImageBuildTemplate) => {
      try {
        const launched = await postRequest(
          template.related?.launch ??
            template.launch_url ??
            awxAPI`/quay/execution-environment-images/templates/${template.id.toString()}/launch/`,
          {}
        );
        pageNavigate(AwxRoute.JobOutput, {
          params: {
            job_type: 'quay-image-build',
            id: launched.unified_job?.id ?? launched.id,
          },
        });
      } catch (error) {
        alertToaster.addAlert({
          variant: 'danger',
          title: t('Failed to launch EE build template'),
          children: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [alertToaster, pageNavigate, postRequest, t]
  );

  const handleDelete = useCallback(
    async (template: QuayImageBuildTemplate) => {
      try {
        await deleteRequest(
          awxAPI`/quay/execution-environment-images/templates/${template.id.toString()}/`
        );
        props.onTemplateDeleted?.();
      } catch (error) {
        alertToaster.addAlert({
          variant: 'danger',
          title: t('Failed to delete EE build template'),
          children: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [alertToaster, deleteRequest, props, t]
  );

  return [
    {
      type: PageActionType.Button,
      selection: PageActionSelection.Single,
      variant: ButtonVariant.primary,
      isPinned: true,
      icon: RocketIcon,
      label: t('Launch template'),
      onClick: (template: QuayImageBuildTemplate) => void handleLaunch(template),
      isDisabled: (template: QuayImageBuildTemplate) =>
        template.summary_fields.user_capabilities.start
          ? undefined
          : t('You do not have permission to launch this template'),
    },
    {
      type: PageActionType.Button,
      selection: PageActionSelection.Single,
      variant: ButtonVariant.secondary,
      isPinned: true,
      icon: PencilAltIcon,
      label: t('Edit template'),
      onClick: (template: QuayImageBuildTemplate) =>
        pageNavigate(AwxRoute.EditQuayImageBuildTemplate, { params: { id: template.id } }),
      isDisabled: (template: QuayImageBuildTemplate) =>
        template.summary_fields.user_capabilities.edit
          ? undefined
          : t('You do not have permission to edit this template'),
    },
    { type: PageActionType.Seperator },
    {
      type: PageActionType.Button,
      selection: PageActionSelection.Single,
      variant: ButtonVariant.plain,
      isDanger: true,
      icon: TrashIcon,
      label: t('Delete template'),
      onClick: (template: QuayImageBuildTemplate) => void handleDelete(template),
      isDisabled: (template: QuayImageBuildTemplate) =>
        template.summary_fields.user_capabilities.delete
          ? undefined
          : t('You do not have permission to delete this template'),
    },
  ] satisfies IPageAction<QuayImageBuildTemplate>[];
}
