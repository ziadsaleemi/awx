import { useParams } from 'react-router-dom';
import { LoadingPage } from '../../../../framework/components/LoadingPage';
import { useGetItem } from '../../../common/crud/useGet';
import { AwxError } from '../../common/AwxError';
import { awxAPI } from '../../common/api/awx-utils';
import { TerraformJob } from '../../interfaces/TerraformJob';
import { Job } from '../../interfaces/Job';
import { JobOutputInner } from '../../views/jobs/JobOutput/JobOutput';

export function TerraformJobOutput() {
  const params = useParams<{ job_id: string }>();
  const jobId = params.job_id ?? '';

  const {
    data: job,
    error,
    isLoading,
    refresh,
  } = useGetItem<TerraformJob>(awxAPI`/terraform_jobs`, jobId);

  if (error) return <AwxError error={error} handleRefresh={refresh} />;
  if (isLoading || !job) return <LoadingPage />;

  return <JobOutputInner job={job as unknown as Job} reloadJob={refresh} />;
}
