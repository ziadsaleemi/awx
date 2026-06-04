import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { PageNavigationItem } from '../../../../framework';
import { CatalogBrowse } from '../../resources/catalog/CatalogBrowse';
import { CatalogDeployWizard } from '../../resources/catalog/CatalogDeployWizard';
import { CatalogDeployments } from '../../resources/catalog/CatalogDeployments';
import { CatalogDeploymentPage } from '../../resources/catalog/CatalogDeploymentPage';
import { CatalogDeploymentDetails } from '../../resources/catalog/CatalogDeploymentDetails';
import { CatalogDeploymentHistory } from '../../resources/catalog/CatalogDeploymentHistory';
import { CatalogItems } from '../../resources/catalog/CatalogItems';
import { CatalogItemPage } from '../../resources/catalog/CatalogItemPage';
import { CatalogItemDetails } from '../../resources/catalog/CatalogItemDetails';
import { CatalogItemCloudProviders } from '../../resources/catalog/CatalogItemCloudProviders';
import { CreateCatalogItem, EditCatalogItem } from '../../resources/catalog/CatalogItemForm';
import { CatalogAdminDeployments } from '../../resources/catalog/CatalogAdminDeployments';
import { CatalogAdminRouteGuard } from '../../resources/catalog/CatalogAdminRouteGuard';
import { CatalogVmSizes } from '../../resources/catalog/CatalogVmSizes';
import { MarketplaceIngestion } from '../../resources/catalog/MarketplaceIngestion';
import { useCatalogAdminAccess } from '../../resources/catalog/useCatalogAdminAccess';
import { AwxRoute } from '../AwxRoutes';

export function useAwxCatalogRoutes() {
  const { t } = useTranslation();
  const { canManageCatalog } = useCatalogAdminAccess();
  const catalogRoutes = useMemo<PageNavigationItem>(
    () => ({
      id: AwxRoute.Catalog,
      label: t('Catalog'),
      path: 'catalog',
      children: [
        // Browse (user-facing card gallery)
        {
          id: AwxRoute.CatalogItems,
          label: t('Browse'),
          path: 'browse',
          element: <CatalogBrowse />,
        },
        // Deploy wizard (no nav label — launched from browse cards)
        {
          id: AwxRoute.CatalogDeploy,
          path: 'browse/:id/deploy',
          element: <CatalogDeployWizard />,
        },
        // My Deployments
        {
          id: AwxRoute.CatalogDeployments,
          label: t('My Deployments'),
          path: 'deployments',
          children: [
            {
              id: AwxRoute.CatalogDeploymentPage,
              path: ':id',
              element: <CatalogDeploymentPage />,
              children: [
                {
                  id: AwxRoute.CatalogDeploymentDetails,
                  path: 'details',
                  element: <CatalogDeploymentDetails />,
                },
                {
                  id: AwxRoute.CatalogDeploymentHistory,
                  path: 'history',
                  element: <CatalogDeploymentHistory />,
                },
                { path: '', element: <Navigate to="details" replace /> },
              ],
            },
            { path: '', element: <CatalogDeployments /> },
          ],
        },
        // Admin — Catalog Items
        {
          id: AwxRoute.CatalogAdminItems,
          label: t('Catalog Items'),
          path: 'admin/items',
          hidden: !canManageCatalog,
          children: [
            {
              id: AwxRoute.CreateCatalogItem,
              path: 'create',
              element: (
                <CatalogAdminRouteGuard>
                  <CreateCatalogItem />
                </CatalogAdminRouteGuard>
              ),
            },
            {
              id: AwxRoute.EditCatalogItem,
              path: ':id/edit',
              element: (
                <CatalogAdminRouteGuard>
                  <EditCatalogItem />
                </CatalogAdminRouteGuard>
              ),
            },
            {
              id: AwxRoute.CatalogItemPage,
              path: ':id',
              element: (
                <CatalogAdminRouteGuard>
                  <CatalogItemPage />
                </CatalogAdminRouteGuard>
              ),
              children: [
                {
                  id: AwxRoute.CatalogItemDetails,
                  path: 'details',
                  element: <CatalogItemDetails />,
                },
                {
                  id: AwxRoute.CatalogItemCloudProviders,
                  path: 'cloud-providers',
                  element: <CatalogItemCloudProviders />,
                },
                { path: '', element: <Navigate to="details" replace /> },
              ],
            },
            {
              path: '',
              element: (
                <CatalogAdminRouteGuard>
                  <CatalogItems />
                </CatalogAdminRouteGuard>
              ),
            },
          ],
        },
        {
          id: AwxRoute.CatalogAdminVmSizes,
          label: t('VM Sizes'),
          path: 'admin/vm-sizes',
          hidden: !canManageCatalog,
          element: (
            <CatalogAdminRouteGuard>
              <CatalogVmSizes />
            </CatalogAdminRouteGuard>
          ),
        },
        // Admin — All Deployments
        {
          id: AwxRoute.CatalogAdminDeployments,
          label: t('All Deployments'),
          path: 'admin/deployments',
          hidden: !canManageCatalog,
          element: (
            <CatalogAdminRouteGuard>
              <CatalogAdminDeployments />
            </CatalogAdminRouteGuard>
          ),
        },
        // Marketplace ingestion
        {
          id: AwxRoute.CatalogMarketplace,
          label: t('Marketplace'),
          path: 'admin/marketplace',
          hidden: !canManageCatalog,
          element: (
            <CatalogAdminRouteGuard>
              <MarketplaceIngestion />
            </CatalogAdminRouteGuard>
          ),
        },
        // Default redirect
        { path: '', element: <Navigate to="browse" replace /> },
      ],
    }),
    [canManageCatalog, t]
  );

  return catalogRoutes;
}
