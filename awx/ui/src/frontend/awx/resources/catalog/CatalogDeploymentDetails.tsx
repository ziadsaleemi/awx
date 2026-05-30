import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import {
  LoadingPage,
  PageDetail,
  PageDetails,
  useGetPageUrl,
  usePageNavigate,
} from '../../../../framework';
import { useGetItem } from '../../../common/crud/useGet';
import { AwxError } from '../../common/AwxError';
import { awxAPI } from '../../common/api/awx-utils';
import { AwxRoute } from '../../main/AwxRoutes';
import { CatalogDeployment } from '../../interfaces/CatalogDeployment';
import { StatusCell } from '../../../common/Status';
import { PageDetailCodeEditor } from '../../../../framework/PageDetails/PageDetailCodeEditor';

export function CatalogDeploymentDetails() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const id = params.id ?? '';
  const getPageUrl = useGetPageUrl();
  const pageNavigate = usePageNavigate();

  const {
    data: deployment,
    error,
    isLoading,
    refresh,
  } = useGetItem<CatalogDeployment>(awxAPI`/catalog_deployments`, id);

  if (error) return <AwxError error={error} handleRefresh={refresh} />;
  if (isLoading || !deployment) return <LoadingPage />;

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
      <PageDetail label={t('Organization')}>
        {deployment.summary_fields?.organization?.name ?? '-'}
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
      <PageDetailCodeEditor
        label={t('Extra variables')}
        value={deployment.extra_vars ? JSON.stringify(deployment.extra_vars, null, 2) : ''}
        showCopyToClipboard
      />
      <PageDetailCodeEditor
        label={t('Last deprovision variables')}
        value={
          deployment.last_deprovision_vars
            ? JSON.stringify(deployment.last_deprovision_vars, null, 2)
            : ''
        }
        showCopyToClipboard
      />
      <PageDetailCodeEditor
        label={t('Provisioning history')}
        value={
          deployment.provisioning_history
            ? JSON.stringify(deployment.provisioning_history, null, 2)
            : ''
        }
        showCopyToClipboard
      />
    </PageDetails>
  );
}

