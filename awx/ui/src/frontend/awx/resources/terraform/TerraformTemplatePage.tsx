import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import {
  LoadingPage,
  PageActions,
  PageHeader,
  PageLayout,
  useGetPageUrl,
  usePageNavigate,
} from '../../../../framework';
import { PageRoutedTabs } from '../../../common/PageRoutedTabs';
import { useGetItem } from '../../../common/crud/useGet';
import { AwxError } from '../../common/AwxError';
import { awxAPI } from '../../common/api/awx-utils';
import { AwxRoute } from '../../main/AwxRoutes';
import { TerraformJobTemplate } from '../../interfaces/TerraformJobTemplate';
import { DropdownPosition } from '@patternfly/react-core/deprecated';
import { useTerraformTemplateActions } from './hooks/useTerraformTemplateActions';

export function TerraformTemplatePage() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const getPageUrl = useGetPageUrl();
  const pageNavigate = usePageNavigate();

  const {
    data: template,
    error,
    isLoading,
    refresh,
  } = useGetItem<TerraformJobTemplate>(awxAPI`/terraform_job_templates`, params.id);

  const itemActions = useTerraformTemplateActions({
    onTemplateDeleted: () => pageNavigate(AwxRoute.TerraformTemplates),
  });

  if (error) return <AwxError error={error} handleRefresh={refresh} />;
  if (isLoading || !template) return <LoadingPage breadcrumbs tabs />;

  return (
    <PageLayout>
      <PageHeader
        title={template.name}
        breadcrumbs={[
          { label: t('Terraform Templates'), to: getPageUrl(AwxRoute.TerraformTemplates) },
          { label: template.name },
        ]}
        headerActions={
          <PageActions
            actions={itemActions}
            position={DropdownPosition.right}
            additionalActionButtonProps={{ size: 'sm' }}
          />
        }
      />
      <PageRoutedTabs
        backTab={{
          label: t('Back to Terraform Templates'),
          page: AwxRoute.TerraformTemplates,
          persistentFilterKey: 'terraform-templates',
        }}
        tabs={[
          { label: t('Details'), page: AwxRoute.TerraformTemplateDetails },
          { label: t('Jobs'), page: AwxRoute.TerraformTemplateJobs },
        ]}
        params={{ id: template.id.toString() }}
        componentParams={{ template }}
      />
    </PageLayout>
  );
}
