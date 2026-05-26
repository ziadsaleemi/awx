import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { Button } from '@patternfly/react-core';
import {
  LoadingPage,
  PageDetail,
  PageDetails,
  useGetPageUrl,
  usePageNavigate,
  usePageAlertToaster,
} from '../../../../framework';
import { useGetItem } from '../../../common/crud/useGet';
import { usePostRequest } from '../../../common/crud/usePostRequest';
import { AwxError } from '../../common/AwxError';
import { awxAPI } from '../../common/api/awx-utils';
import { AwxRoute } from '../../main/AwxRoutes';
import { CatalogDeployment } from '../../interfaces/CatalogDeployment';
import { StatusCell } from '../../../common/Status';

export function CatalogDeploymentDetails() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const id = params.id ?? '';
  const getPageUrl = useGetPageUrl();
  const pageNavigate = usePageNavigate();
  const alertToaster = usePageAlertToaster();
  const postRequest = usePostRequest();

  const { data: deployment, error, isLoading, refresh } = useGetItem<CatalogDeployment>(
    awxAPI`/catalog_deployments`,
    id
  );

  const handleDeprovision = async () => {
    try {
      await postRequest(awxAPI`/catalog_deployments/${id}/deprovision/`, {});
      alertToaster.addAlert({
        variant: 'success',
        title: t('Deprovision started'),
        timeout: 4000,
      });
      refresh();
    } catch (err) {
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Failed to deprovision'),
        children: err instanceof Error ? err.message : String(err),
      });
    }
  };

  if (error) return <AwxError error={error} handleRefresh={refresh} />;
  if (isLoading || !deployment) return <LoadingPage />;

  const canDeprovision = !['deprovisioning', 'destroyed', 'provisioning', 'pending'].includes(
    deployment.status
  );

  return (
    <PageDetails>
      <PageDetail label={t('Name')}>{deployment.name}</PageDetail>
      <PageDetail label={t('Status')}>
        <StatusCell status={deployment.status} />
      </PageDetail>
      <PageDetail label={t('Catalog item')}>
        {deployment.summary_fields?.catalog_item ? (
          <a
            href={getPageUrl(AwxRoute.CatalogItemPage, {
              params: { id: String(deployment.catalog_item) },
            })}
          >
            {deployment.summary_fields.catalog_item.name}
          </a>
        ) : (
          '-'
        )}
      </PageDetail>
      <PageDetail label={t('Owner')}>
        {deployment.summary_fields?.owner?.username ?? '-'}
      </PageDetail>
      {deployment.provision_job && (
        <PageDetail label={t('Provision job')}>
          <a
            href={getPageUrl(AwxRoute.Jobs)}
            onClick={(e) => {
              e.preventDefault();
              /* navigate to workflow job detail when we have the route */
            }}
          >
            {t('Job #{{id}}', { id: deployment.provision_job })}
          </a>
        </PageDetail>
      )}
      {deployment.terraform_provision_job && (
        <PageDetail label={t('Terraform provision job')}>
          <a
            href={getPageUrl(AwxRoute.TerraformJobPage, {
              params: { job_id: String(deployment.terraform_provision_job) },
            })}
            onClick={(e) => {
              e.preventDefault();
              pageNavigate(AwxRoute.TerraformJobPage, {
                params: { job_id: String(deployment.terraform_provision_job) },
              });
            }}
          >
            {t('Terraform Job #{{id}}', { id: deployment.terraform_provision_job })}
          </a>
        </PageDetail>
      )}
      {deployment.deprovision_job && (
        <PageDetail label={t('Deprovision job')}>
          {t('Job #{{id}}', { id: deployment.deprovision_job })}
        </PageDetail>
      )}
      <PageDetail label={t('Extra variables')}>
        {deployment.extra_vars ? (
          <pre style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
            {JSON.stringify(deployment.extra_vars, null, 2)}
          </pre>
        ) : (
          '-'
        )}
      </PageDetail>
      <PageDetail label={t('Deployed')}>
        {new Date(deployment.created).toLocaleString()}
      </PageDetail>
      <PageDetail label={t('Actions')}>
        <Button
          variant="danger"
          isDisabled={!canDeprovision}
          onClick={() => void handleDeprovision()}
        >
          {t('Deprovision')}
        </Button>
      </PageDetail>
    </PageDetails>
  );
}
