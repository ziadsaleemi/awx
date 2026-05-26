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
          { label: t('Templates'), to: getPageUrl(AwxRoute.Templates) },
          { label: template.name },
        ]}
        headerActions={
          <PageActions
            actions={itemActions}
            position={DropdownPosition.right}
            additionalActionButtonProps={{ size: 'sm' }}
            selectedItem={template}
          />
        }
      />
      <PageRoutedTabs
        backTab={{
          label: t('Back to Templates'),
          page: AwxRoute.Templates,
          persistentFilterKey: 'terraform-templates',
        }}
        tabs={[
          { label: t('Details'), page: AwxRoute.TerraformTemplateDetails },
          { label: t('Team Access'), page: AwxRoute.TerraformTemplateTeamAccess },
          { label: t('User Access'), page: AwxRoute.TerraformTemplateUserAccess },
          { label: t('Notifications'), page: AwxRoute.TerraformTemplateNotifications },
          { label: t('Jobs'), page: AwxRoute.TerraformTemplateJobs },
          { label: t('Schedules'), page: AwxRoute.TerraformTemplateSchedules },
          { label: t('Survey'), page: AwxRoute.TerraformTemplateSurvey },
        ]}
        params={{ id: template.id.toString() }}
        componentParams={{ template }}
      />
    </PageLayout>
  );
}
