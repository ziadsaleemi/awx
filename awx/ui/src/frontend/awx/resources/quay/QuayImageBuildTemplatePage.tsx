import { DropdownPosition } from '@patternfly/react-core/deprecated';
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
import { useGet } from '../../../common/crud/useGet';
import { AwxError } from '../../common/AwxError';
import { awxAPI } from '../../common/api/awx-utils';
import { QuayImageBuildTemplate } from '../../interfaces/QuayImageBuildTemplate';
import { AwxRoute } from '../../main/AwxRoutes';
import { useQuayImageBuildTemplateActions } from './hooks/useQuayImageBuildTemplateActions';

export function QuayImageBuildTemplatePage() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const getPageUrl = useGetPageUrl();
  const pageNavigate = usePageNavigate();
  const {
    data: template,
    error,
    isLoading,
    refresh,
  } = useGet<QuayImageBuildTemplate>(
    params.id ? awxAPI`/quay/execution-environment-images/templates/${params.id}/` : ''
  );
  const itemActions = useQuayImageBuildTemplateActions({
    onTemplateDeleted: () => pageNavigate(AwxRoute.Templates),
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
          <PageActions<QuayImageBuildTemplate>
            actions={itemActions}
            position={DropdownPosition.right}
            selectedItem={template}
          />
        }
      />
      <PageRoutedTabs
        backTab={{
          label: t('Back to Templates'),
          page: AwxRoute.Templates,
          persistentFilterKey: 'templates',
        }}
        tabs={[
          { label: t('Details'), page: AwxRoute.QuayImageBuildTemplateDetails },
          { label: t('Team Access'), page: AwxRoute.QuayImageBuildTemplateTeamAccess },
          { label: t('User Access'), page: AwxRoute.QuayImageBuildTemplateUserAccess },
          { label: t('Schedules'), page: AwxRoute.QuayImageBuildTemplateSchedules },
          { label: t('Jobs'), page: AwxRoute.QuayImageBuildTemplateJobs },
          { label: t('Notifications'), page: AwxRoute.QuayImageBuildTemplateNotifications },
          { label: t('Tags'), page: AwxRoute.QuayImageBuildTemplateTags },
        ]}
        params={{ id: template.id.toString() }}
        componentParams={{ template }}
      />
    </PageLayout>
  );
}
