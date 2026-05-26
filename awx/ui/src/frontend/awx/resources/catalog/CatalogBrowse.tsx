import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  CardTitle,
  Gallery,
  GalleryItem,
  EmptyState,
  EmptyStateBody,
  EmptyStateIcon,
  Spinner,
  Title,
} from '@patternfly/react-core';
import { CubesIcon } from '@patternfly/react-icons';
import { PageHeader, PageLayout } from '../../../../framework';
import { awxAPI } from '../../common/api/awx-utils';
import { useGet } from '../../../common/crud/useGet';
import { CatalogItem } from '../../interfaces/CatalogItem';
import { CatalogDeployModal } from './CatalogDeployModal';

interface CatalogItemListResponse {
  count: number;
  results: CatalogItem[];
}

export function CatalogBrowse() {
  const { t } = useTranslation();
  const [deployItem, setDeployItem] = useState<CatalogItem | null>(null);

  const { data, isLoading } = useGet<CatalogItemListResponse>(awxAPI`/catalog_items/`);
  const items = data?.results ?? [];

  return (
    <PageLayout>
      <PageHeader
        title={t('Service Catalog')}
        description={t('Browse and deploy available catalog items.')}
      />
      {isLoading ? (
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <Spinner />
        </div>
      ) : !items || items.length === 0 ? (
        <EmptyState variant="full">
          <EmptyStateIcon icon={CubesIcon} />
          <Title headingLevel="h4" size="lg">
            {t('No catalog items')}
          </Title>
          <EmptyStateBody>
            {t('No catalog items are available. Contact your administrator to create items.')}
          </EmptyStateBody>
        </EmptyState>
      ) : (
        <div style={{ padding: '1.5rem' }}>
          <Gallery hasGutter minWidths={{ default: '280px' }}>
            {items.map((item) => (
              <GalleryItem key={item.id}>
                <CatalogItemCard
                  item={item}
                  onDeploy={() => setDeployItem(item)}
                />
              </GalleryItem>
            ))}
          </Gallery>
        </div>
      )}
      {deployItem && (
        <CatalogDeployModal item={deployItem} onClose={() => setDeployItem(null)} />
      )}
    </PageLayout>
  );
}

function CatalogItemCard({
  item,
  onDeploy,
}: {
  item: CatalogItem;
  onDeploy: () => void;
}) {
  const { t } = useTranslation();
  const iconSrc = item.icon_data && item.icon_data.startsWith('data:image/') ? item.icon_data : item.icon_url;

  return (
    <Card isRaised style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CardHeader>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {iconSrc ? (
            <img
              src={iconSrc}
              alt=""
              style={{ width: 40, height: 40, objectFit: 'contain' }}
            />
          ) : (
            <CubesIcon style={{ width: 40, height: 40 }} />
          )}
          <CardTitle>{item.name}</CardTitle>
        </div>
      </CardHeader>
      <CardBody style={{ flexGrow: 1 }}>
        {item.description || (
          <span style={{ color: 'var(--pf-global--Color--200)' }}>
            {t('No description provided.')}
          </span>
        )}
        {item.summary_fields?.organization && (
          <p style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--pf-global--Color--200)' }}>
            {t('Org: {{name}}', { name: item.summary_fields.organization.name })}
          </p>
        )}
        {item.summary_fields?.terraform_job_template && (
          <p style={{ marginTop: '0.25rem', fontSize: '0.8rem', color: 'var(--pf-global--Color--200)' }}>
            {t('Terraform: {{name}}', { name: item.summary_fields.terraform_job_template.name })}
          </p>
        )}
      </CardBody>
      <CardFooter>
        <Button
          variant="primary"
          isDisabled={!item.summary_fields?.user_capabilities?.use}
          onClick={onDeploy}
        >
          {t('Deploy')}
        </Button>
      </CardFooter>
    </Card>
  );
}
