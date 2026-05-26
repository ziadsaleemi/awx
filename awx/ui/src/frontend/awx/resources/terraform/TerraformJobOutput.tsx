import { useParams } from 'react-router-dom';
import { LoadingPage } from '../../../../framework/components/LoadingPage';
import { useGetItem } from '../../../common/crud/useGet';
import { AwxError } from '../../common/AwxError';
import { awxAPI } from '../../common/api/awx-utils';
import { TerraformJob } from '../../interfaces/TerraformJob';
import { JobOutputInner } from '../../views/jobs/JobOutput/JobOutput';
import { Job } from '../../interfaces/Job';

/**
 * Displays real-time / completed output for a Terraform job.
 *
 * Terraform jobs produce standard AWX job events on the same
 * /api/v2/terraform_jobs/<id>/job_events/ endpoint, so we can
 * reuse the shared <JobOutputInner> component by casting the job to
 * the generic Job union type that JobOutputInner already understands.
 * We fetch the job ourselves (using job_id param) rather than letting
 * JobOutput read params.id / params.job_type.
 */
export function TerraformJobOutput() {
  const params = useParams<{ job_id: string }>();
  const jobId = params.job_id ?? '';

  const { data: job, error, isLoading, refresh } = useGetItem<TerraformJob>(
    awxAPI`/terraform_jobs`,
    jobId
  );

  if (error) return <AwxError error={error} handleRefresh={refresh} />;
  if (isLoading || !job) return <LoadingPage />;

  // TerraformJob is structurally compatible with Job for output rendering.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <JobOutputInner job={job as unknown as Job} reloadJob={refresh} />;
}
