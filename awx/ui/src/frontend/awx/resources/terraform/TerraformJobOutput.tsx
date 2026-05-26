import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { PageSection } from '@patternfly/react-core';
import { LoadingPage } from '../../../../framework/components/LoadingPage';
import { useGetItem } from '../../../common/crud/useGet';
import { AwxError } from '../../common/AwxError';
import { awxAPI } from '../../common/api/awx-utils';
import { TerraformJob } from '../../interfaces/TerraformJob';

export function TerraformJobOutput() {
  const { t } = useTranslation();
  const params = useParams<{ job_id: string }>();
  const jobId = params.job_id ?? '';

  const { data: job, error, isLoading, refresh } = useGetItem<TerraformJob>(
    awxAPI`/terraform_jobs`,
    jobId
  );

  if (error) return <AwxError error={error} handleRefresh={refresh} />;
  if (isLoading || !job) return <LoadingPage />;

  return (
    <PageSection
      variant="light"
      style={{
        overflow: 'auto',
        height: 'calc(100vh - 204px)',
        backgroundColor: 'var(--pf-v5-global--BackgroundColor--dark-100, #1b1d21)',
      }}
    >
      <pre
        style={{
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          fontFamily: 'var(--pf-v5-global--FontFamily--monospace)',
          fontSize: 'var(--pf-v5-global--FontSize--sm)',
          color: 'var(--pf-v5-global--Color--light-100, #f0f0f0)',
          margin: 0,
          padding: '1rem',
        }}
      >
        {job.result_stdout || t('(No output)')}
      </pre>
    </PageSection>
  );
}

