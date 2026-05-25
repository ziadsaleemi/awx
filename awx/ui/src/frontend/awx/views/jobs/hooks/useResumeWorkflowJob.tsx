import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { usePageAlertToaster } from '../../../../../framework';
import { usePostRequest } from '../../../../common/crud/usePostRequest';
import { UnifiedJob } from '../../../interfaces/UnifiedJob';
import { useGetJobOutputUrl } from '../useGetJobOutputUrl';

export function useResumeWorkflowJob() {
  const alertToaster = usePageAlertToaster();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const postRequest = usePostRequest();
  const getJobOutputUrl = useGetJobOutputUrl();

  return async (job: UnifiedJob) => {
    if (!job.related.resume) {
      return;
    }
    try {
      const resumedJob = await postRequest<UnifiedJob>(job.related.resume, {});
      navigate(getJobOutputUrl(resumedJob));
    } catch (error) {
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Failed to resume workflow job'),
        children: error instanceof Error && error.message,
        timeout: 2000,
      });
    }
  };
}
