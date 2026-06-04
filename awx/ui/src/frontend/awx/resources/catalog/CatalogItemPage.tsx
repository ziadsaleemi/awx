import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { LoadingPage, PageHeader, PageLayout, useGetPageUrl } from '../../../../framework';
import { PageRoutedTabs } from '../../../common/PageRoutedTabs';
import { useGetItem } from '../../../common/crud/useGet';
import { AwxError } from '../../common/AwxError';
import { awxAPI } from '../../common/api/awx-utils';
import { CatalogItem } from '../../interfaces/CatalogItem';
import { AwxRoute } from '../../main/AwxRoutes';
export function CatalogItemPage() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const getPageUrl = useGetPageUrl();

  const {
    data: item,
    error,
    isLoading,
    refresh,
  } = useGetItem<CatalogItem>(awxAPI`/catalog_items`, params.id);

  if (error) return <AwxError error={error} handleRefresh={refresh} />;
  if (isLoading || !item) return <LoadingPage breadcrumbs tabs />;

  return (
    <PageLayout>
      <PageHeader
        title={item.name}
        description={item.description}
        breadcrumbs={[
          { label: t('Catalog'), to: getPageUrl(AwxRoute.CatalogItems) },
          { label: item.name },
        ]}
      />
      <PageRoutedTabs
        tabs={[
          {
            label: t('Details'),
            page: AwxRoute.CatalogItemDetails,
            dataCy: 'catalog-item-details-tab',
          },
          {
            label: t('Cloud Providers'),
            page: AwxRoute.CatalogItemCloudProviders,
            dataCy: 'catalog-item-cloud-providers-tab',
          },
        ]}
        params={{ id: String(item.id) }}
      />
    </PageLayout>
  );
}
