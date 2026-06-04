import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { LoadingPage, PageDetail, PageDetails } from '../../../../framework';
import { PageDetailCodeEditor } from '../../../../framework/PageDetails/PageDetailCodeEditor';
import { useGetItem } from '../../../common/crud/useGet';
import { AwxError } from '../../common/AwxError';
import { awxAPI } from '../../common/api/awx-utils';
import { TerraformJob } from '../../interfaces/TerraformJob';
import { StatusCell } from '../../../common/Status';

export function TerraformJobDetails() {
  const { t } = useTranslation();
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

  const artifacts =
    typeof job.artifacts === 'string'
      ? job.artifacts
      : JSON.stringify(job.artifacts ?? {}, null, 2);

  const verbosityLabels: Record<number, string> = {
    0: t('0 (Normal)'),
    1: t('1 (Verbose)'),
    2: t('2 (More Verbose)'),
    3: t('3 (Debug)'),
    4: t('4 (Connection Debug)'),
  };

  return (
    <PageDetails>
      <PageDetail label={t('Status')}>
        <StatusCell status={job.status} />
      </PageDetail>
      <PageDetail label={t('Terraform Template')}>
        {job.summary_fields?.terraform_job_template?.name ?? '-'}
      </PageDetail>
      <PageDetail label={t('Operation')}>{job.terraform_operation}</PageDetail>
      <PageDetail label={t('Project')}>{job.summary_fields?.project?.name ?? '-'}</PageDetail>
      <PageDetail label={t('Terraform Directory')}>{job.terraform_dir || '.'}</PageDetail>
      <PageDetail label={t('Target Inventory')}>
        {job.summary_fields?.target_inventory?.name ?? t('None')}
      </PageDetail>
      {job.target_group && <PageDetail label={t('Target Group')}>{job.target_group}</PageDetail>}
      <PageDetail label={t('Verbosity')}>
        {verbosityLabels[job.verbosity] ?? job.verbosity}
      </PageDetail>
      {job.execution_node && (
        <PageDetail label={t('Execution Node')}>{job.execution_node}</PageDetail>
      )}
      {job.started && (
        <PageDetail label={t('Started')}>{new Date(job.started).toLocaleString()}</PageDetail>
      )}
      {job.finished && (
        <PageDetail label={t('Finished')}>{new Date(job.finished).toLocaleString()}</PageDetail>
      )}
      {job.elapsed !== undefined && (
        <PageDetail label={t('Duration')}>{`${job.elapsed.toFixed(1)}s`}</PageDetail>
      )}
      {job.summary_fields?.created_by && (
        <PageDetail label={t('Launched by')}>{job.summary_fields.created_by.username}</PageDetail>
      )}
      {job.extra_vars && (
        <PageDetailCodeEditor label={t('Extra Variables')} value={job.extra_vars} />
      )}
      <PageDetailCodeEditor label={t('Artifacts')} value={artifacts} />
    </PageDetails>
  );
}
