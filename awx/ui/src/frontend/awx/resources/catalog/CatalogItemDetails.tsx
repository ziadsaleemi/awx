import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { LoadingPage, PageDetail, PageDetails } from '../../../../framework';
import { useGetItem } from '../../../common/crud/useGet';
import { AwxError } from '../../common/AwxError';
import { awxAPI } from '../../common/api/awx-utils';
import { CatalogItem } from '../../interfaces/CatalogItem';

export function CatalogItemDetails() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();

  const {
    data: item,
    error,
    isLoading,
    refresh,
  } = useGetItem<CatalogItem>(awxAPI`/catalog_items`, params.id);

  if (error) return <AwxError error={error} handleRefresh={refresh} />;
  if (isLoading || !item) return <LoadingPage />;

  return (
    <PageDetails>
      <PageDetail label={t('Name')}>{item.name}</PageDetail>
      <PageDetail label={t('Description')}>{item.description || '-'}</PageDetail>
      <PageDetail label={t('Organization')}>
        {item.summary_fields?.organization?.name ?? '-'}
      </PageDetail>
      <PageDetail label={t('Name template')}>{item.name_template || t('None')}</PageDetail>
      <PageDetail label={t('Dynamic source field')}>
        {item.dynamic_name_field || t('None')}
      </PageDetail>
      {item.summary_fields?.terraform_job_template && (
        <PageDetail label={t('Terraform template')}>
          {item.summary_fields.terraform_job_template.name}
        </PageDetail>
      )}
      {item.icon_data && item.icon_data.startsWith('data:image/') && (
        <PageDetail label={t('Uploaded icon')}>
          <img
            src={item.icon_data}
            alt={t('Catalog icon')}
            style={{ width: 64, height: 64, objectFit: 'contain' }}
          />
        </PageDetail>
      )}
      <PageDetail label={t('Override downstream workflow limit')}>
        {item.override_workflow_limit ? t('Enabled') : t('Disabled')}
      </PageDetail>
      {item.icon_url && <PageDetail label={t('Icon URL')}>{item.icon_url}</PageDetail>}
      {item.extra_vars_schema && (
        <PageDetail label={t('Extra variables schema')}>
          <pre style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
            {JSON.stringify(item.extra_vars_schema, null, 2)}
          </pre>
        </PageDetail>
      )}
      <PageDetail label={t('Default lease')}>
        {item.default_lease_minutes
          ? t('{{n}} minutes', { n: item.default_lease_minutes })
          : t('None')}
      </PageDetail>
      <PageDetail label={t('Require lease')}>{item.require_lease ? t('Yes') : t('No')}</PageDetail>
      <PageDetail label={t('Created')}>{new Date(item.created).toLocaleString()}</PageDetail>
      <PageDetail label={t('Modified')}>{new Date(item.modified).toLocaleString()}</PageDetail>
    </PageDetails>
  );
}
