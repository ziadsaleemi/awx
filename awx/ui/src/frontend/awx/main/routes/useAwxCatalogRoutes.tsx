import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { PageNavigationItem } from '../../../../framework';
import { CatalogBrowse } from '../../resources/catalog/CatalogBrowse';
import { CatalogDeployWizard } from '../../resources/catalog/CatalogDeployWizard';
import { CatalogDeployments } from '../../resources/catalog/CatalogDeployments';
import { CatalogDeploymentPage } from '../../resources/catalog/CatalogDeploymentPage';
import { CatalogDeploymentDetails } from '../../resources/catalog/CatalogDeploymentDetails';
import { CatalogItems } from '../../resources/catalog/CatalogItems';
import { CatalogItemPage } from '../../resources/catalog/CatalogItemPage';
import { CatalogItemDetails } from '../../resources/catalog/CatalogItemDetails';
import { CreateCatalogItem, EditCatalogItem } from '../../resources/catalog/CatalogItemForm';
import { CatalogAdminDeployments } from '../../resources/catalog/CatalogAdminDeployments';
import { AwxRoute } from '../AwxRoutes';

export function useAwxCatalogRoutes() {
  const { t } = useTranslation();

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
                { path: '', element: <Navigate to="details" replace /> },
              ],
            },
            { path: '', element: <CatalogDeployments /> },
          ],
        },
        // Admin — Catalog Items
        {
          id: AwxRoute.CatalogAdminItems,
          label: t('Items (Admin)'),
          path: 'admin/items',
          children: [
            {
              id: AwxRoute.CreateCatalogItem,
              path: 'create',
              element: <CreateCatalogItem />,
            },
            {
              id: AwxRoute.EditCatalogItem,
              path: ':id/edit',
              element: <EditCatalogItem />,
            },
            {
              id: AwxRoute.CatalogItemPage,
              path: ':id',
              element: <CatalogItemPage />,
              children: [
                {
                  id: AwxRoute.CatalogItemDetails,
                  path: 'details',
                  element: <CatalogItemDetails />,
                },
                { path: '', element: <Navigate to="details" replace /> },
              ],
            },
            { path: '', element: <CatalogItems /> },
          ],
        },
        // Admin — All Deployments
        {
          id: AwxRoute.CatalogAdminDeployments,
          label: t('All Deployments'),
          path: 'admin/deployments',
          element: <CatalogAdminDeployments />,
        },
        // Default redirect
        { path: '', element: <Navigate to="browse" replace /> },
      ],
    }),
    [t]
  );

  return catalogRoutes;
}
