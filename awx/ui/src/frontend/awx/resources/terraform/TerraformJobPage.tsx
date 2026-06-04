import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { LoadingPage, PageHeader, PageLayout, useGetPageUrl } from '../../../../framework';
import { PageRoutedTabs } from '../../../common/PageRoutedTabs';
import { useGetItem } from '../../../common/crud/useGet';
import { AwxError } from '../../common/AwxError';
import { awxAPI } from '../../common/api/awx-utils';
import { AwxRoute } from '../../main/AwxRoutes';
import { TerraformJob } from '../../interfaces/TerraformJob';

export function TerraformJobPage() {
  const { t } = useTranslation();
  const params = useParams<{ job_id: string }>();
  const getPageUrl = useGetPageUrl();
  const jobId = params.job_id ?? '';

  const {
    data: job,
    error,
    isLoading,
    refresh,
  } = useGetItem<TerraformJob>(awxAPI`/terraform_jobs`, jobId);

  if (error) return <AwxError error={error} handleRefresh={refresh} />;
  if (isLoading || !job) return <LoadingPage breadcrumbs tabs />;

  const templateId = job.summary_fields?.terraform_job_template?.id;

  return (
    <PageLayout>
      <PageHeader
        title={job.name || t('Terraform Job {{id}}', { id: job.id })}
        description={job.status}
        breadcrumbs={[
          { label: t('Terraform Templates'), to: getPageUrl(AwxRoute.TerraformTemplates) },
          ...(templateId
            ? [
                {
                  label: job.summary_fields?.terraform_job_template?.name ?? t('Template'),
                  to: getPageUrl(AwxRoute.TerraformTemplatePage, {
                    params: { id: templateId },
                  }),
                },
              ]
            : []),
          { label: `#${job.id}` },
        ]}
      />
      <PageRoutedTabs
        backTab={
          templateId
            ? {
                label: t('Back to Jobs'),
                page: AwxRoute.TerraformTemplateJobs,
                persistentFilterKey: 'terraform-jobs',
              }
            : undefined
        }
        tabs={[
          { label: t('Output'), page: AwxRoute.TerraformJobOutput },
          { label: t('Details'), page: AwxRoute.TerraformJobDetails },
        ]}
        params={{ job_id: jobId }}
        componentParams={{ job }}
      />
    </PageLayout>
  );
}
