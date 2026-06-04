import { PageSection } from '@patternfly/react-core';
import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyStateUnauthorized } from '../../../../framework/components/EmptyStateUnauthorized';
import { PageHeader, PageLayout } from '../../../../framework';
import { useCatalogAdminAccess } from './useCatalogAdminAccess';

export function CatalogAdminRouteGuard(props: { children: ReactNode }) {
  const { t } = useTranslation();
  const { canManageCatalog, isLoading } = useCatalogAdminAccess();

  if (isLoading) {
    return null;
  }

  if (!canManageCatalog) {
    return (
      <PageLayout>
        <PageHeader
          title={t('Catalog administration')}
          description={t('Catalog administration is available to organization administrators.')}
        />
        <PageSection variant="light">
          <EmptyStateUnauthorized
            title={t('You do not have permission to manage catalog resources.')}
          />
        </PageSection>
      </PageLayout>
    );
  }

  return <>{props.children}</>;
}
