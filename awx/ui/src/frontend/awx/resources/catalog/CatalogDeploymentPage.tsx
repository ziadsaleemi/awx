import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { Button } from '@patternfly/react-core';
import {
  LoadingPage,
  PageHeader,
  PageLayout,
  useGetPageUrl,
  usePageAlertToaster,
} from '../../../../framework';
import { PageRoutedTabs } from '../../../common/PageRoutedTabs';
import { awxAPI } from '../../common/api/awx-utils';
import { useGetItem } from '../../../common/crud/useGet';
import { usePostRequest } from '../../../common/crud/usePostRequest';
import { AwxError } from '../../common/AwxError';
import { CatalogDeployment } from '../../interfaces/CatalogDeployment';
import { AwxRoute } from '../../main/AwxRoutes';
import { StatusLabel } from '../../../common/Status';

export function CatalogDeploymentPage() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const getPageUrl = useGetPageUrl();
  const alertToaster = usePageAlertToaster();
  const postRequest = usePostRequest();

  const { data: deployment, error, isLoading, refresh } = useGetItem<CatalogDeployment>(
    awxAPI`/catalog_deployments`,
    params.id
  );

  if (error) return <AwxError error={error} handleRefresh={refresh} />;
  if (isLoading || !deployment) return <LoadingPage />;

  const canDeprovision = !['deprovisioning', 'destroyed', 'provisioning', 'pending'].includes(
    deployment.status
  );

  const handleRetry = async () => {
    try {
      await postRequest(awxAPI`/catalog_deployments/${String(deployment.id)}/retry/`, {});
      alertToaster.addAlert({ variant: 'success', title: t('Retry started'), timeout: 4000 });
      refresh();
    } catch (err) {
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Failed to retry deployment'),
        children: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleDeprovision = async () => {
    try {
      await postRequest(awxAPI`/catalog_deployments/${String(deployment.id)}/deprovision/`, {});
      alertToaster.addAlert({ variant: 'success', title: t('Deprovision started'), timeout: 4000 });
      refresh();
    } catch (err) {
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Failed to deprovision'),
        children: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <PageLayout>
      <PageHeader
        title={deployment.name}
        titleAdornment={<StatusLabel status={deployment.status} />}
        breadcrumbs={[
          { label: t('My Deployments'), to: getPageUrl(AwxRoute.CatalogDeployments) },
          { label: deployment.name },
        ]}
        headerActions={
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Button
                variant="secondary"
                isDisabled={
                  deployment.status !== 'failed' ||
                  !deployment.summary_fields?.user_capabilities?.retry
                }
                onClick={() => void handleRetry()}
              >
                {t('Retry provision')}
              </Button>
              <Button
                variant="danger"
                isDisabled={!canDeprovision}
                onClick={() => void handleDeprovision()}
              >
                {t('Deprovision')}
              </Button>
            </div>
            <span
              style={{
                fontSize: '0.8rem',
                color: 'var(--pf-v5-global--Color--200)',
                whiteSpace: 'nowrap',
              }}
            >
              {t('Deployed: {{time}}', { time: new Date(deployment.created).toLocaleString() })}
            </span>
          </div>
        }
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

