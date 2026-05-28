import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { Navigate } from 'react-router-dom';
import {
  LoadingPage,
  PageHeader,
  PageLayout,
  useGetPageUrl,
  usePageNavigate,
} from '../../../../framework';
import { PageRoutedTabs } from '../../../common/PageRoutedTabs';
import { awxAPI } from '../../common/api/awx-utils';
import { useGetItem } from '../../../common/crud/useGet';
import { AwxError } from '../../common/AwxError';
import { CatalogDeployment } from '../../interfaces/CatalogDeployment';
import { AwxRoute } from '../../main/AwxRoutes';

export function CatalogDeploymentPage() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const getPageUrl = useGetPageUrl();

  const { data: deployment, error, isLoading, refresh } = useGetItem<CatalogDeployment>(
    awxAPI`/catalog_deployments`,
    params.id
  );

  if (error) return <AwxError error={error} handleRefresh={refresh} />;
  if (isLoading || !deployment) return <LoadingPage />;

  return (
    <PageLayout>
      <PageHeader
        title={deployment.name}
        breadcrumbs={[
          { label: t('My Deployments'), to: getPageUrl(AwxRoute.CatalogDeployments) },
          { label: deployment.name },
        ]}
      />
      <PageRoutedTabs
        tabs={[
          {
            label: t('Details'),
            page: AwxRoute.CatalogDeploymentDetails,
            dataCy: 'catalog-deployment-details-tab',
          },
          {
            label: t('Provisioning History'),
            page: AwxRoute.CatalogDeploymentHistory,
            dataCy: 'catalog-deployment-history-tab',
          },
        ]}
        params={{ id: String(deployment.id) }}
      />
    </PageLayout>
  );
}
