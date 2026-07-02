import { useMemo } from 'react';
import { IPageAction, PageActionSelection, PageActionType } from '../../../../../framework';
import { ButtonVariant } from '@patternfly/react-core';
import { RedoIcon, RocketIcon } from '@patternfly/react-icons';
import { UnifiedJob } from '../../../interfaces/UnifiedJob';
import { useRelaunchJob } from './useRelaunchJob';
import { useResumeWorkflowJob } from './useResumeWorkflowJob';
import { useTranslation } from 'react-i18next';

export function useRelaunchOptions(): IPageAction<UnifiedJob>[] {
  const { t } = useTranslation();
  const relaunchJob = useRelaunchJob();
  const relaunchAllHosts = useRelaunchJob({ hosts: 'all' });
  const relaunchFailedHosts = useRelaunchJob({ hosts: 'failed' });
  const resumeWorkflowJob = useResumeWorkflowJob();
  return useMemo(
    () => [
      {
        type: PageActionType.Button,
        selection: PageActionSelection.Single,
        variant: ButtonVariant.primary,
        isPinned: true,
        icon: RocketIcon,
        label: t(`Relaunch job`),
        isHidden: (job: UnifiedJob) =>
          !(job.type !== 'system_job' && job.summary_fields?.user_capabilities?.start) ||
          job.type === 'quay_image_build_job' ||
          (job.status === 'failed' && job.type === 'job'),
        onClick: (job: UnifiedJob) => void relaunchJob(job),
      },
      {
        type: PageActionType.Dropdown,
        selection: PageActionSelection.Single,
        isPinned: true,
        icon: RocketIcon,
        label: t(`Relaunch using host parameters`),
        isHidden: (job: UnifiedJob) =>
          !(job.type !== 'system_job' && job.summary_fields?.user_capabilities?.start) ||
          job.type === 'quay_image_build_job' ||
          !(job.status === 'failed' && job.type === 'job'),
        actions: [
          {
            type: PageActionType.Button,
            selection: PageActionSelection.Single,
            label: t(`Relaunch on all hosts`),
            onClick: (job: UnifiedJob) => void relaunchAllHosts(job),
          },
          {
            type: PageActionType.Button,
            selection: PageActionSelection.Single,
            label: t(`Relaunch on failed hosts`),
            onClick: (job: UnifiedJob) => void relaunchFailedHosts(job),
          },
        ],
      },
      {
        type: PageActionType.Button,
        selection: PageActionSelection.Single,
        variant: ButtonVariant.primary,
        isPinned: true,
        icon: RedoIcon,
        label: t(`Resume`),
        isHidden: (job: UnifiedJob) =>
          !job.related.resume ||
          !job.status ||
          !['failed', 'canceled', 'error'].includes(job.status) ||
          job.type !== 'workflow_job',
        onClick: (job: UnifiedJob) => void resumeWorkflowJob(job),
        ouiaId: 'workflow-job-resume-button',
      },
    ],
    [t, relaunchAllHosts, relaunchFailedHosts, relaunchJob, resumeWorkflowJob]
  );
}
