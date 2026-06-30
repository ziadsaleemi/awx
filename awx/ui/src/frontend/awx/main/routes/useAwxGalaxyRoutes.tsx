import { CubesIcon } from '@patternfly/react-icons';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { PageNavigationItem } from '../../../../framework';
import { GalaxyNgApiToken } from '../../resources/galaxy/GalaxyNgApiToken';
import { GalaxyNgOverview } from '../../resources/galaxy/GalaxyNgOverview';
import { GalaxyNgProjectImports } from '../../resources/galaxy/GalaxyNgProjectImports';
import { GalaxyNgResourceList } from '../../resources/galaxy/GalaxyNgResourceList';
import { AwxRoute } from '../AwxRoutes';

export function useAwxGalaxyRoutes() {
  const { t } = useTranslation();

  return useMemo<PageNavigationItem>(
    () => ({
      id: AwxRoute.GalaxyNG,
      label: t('Automation Hub'),
      path: 'galaxy-ng',
      icon: <CubesIcon />,
      children: [
        {
          id: AwxRoute.GalaxyNGOverview,
          label: t('Overview'),
          path: 'overview',
          element: <GalaxyNgOverview />,
        },
        {
          id: AwxRoute.GalaxyNGNamespaces,
          label: t('Namespaces'),
          path: 'namespaces',
          element: <GalaxyNgResourceList resource="namespaces" />,
        },
        {
          id: AwxRoute.GalaxyNGCollections,
          label: t('Collections'),
          path: 'collections',
          element: <GalaxyNgResourceList resource="collections" />,
        },
        {
          id: AwxRoute.GalaxyNGProjectImports,
          label: t('Project Imports'),
          path: 'project-imports',
          element: <GalaxyNgProjectImports />,
        },
        {
          id: AwxRoute.GalaxyNGRepositories,
          label: t('Repositories'),
          path: 'repositories',
          element: <GalaxyNgResourceList resource="repositories" />,
        },
        {
          id: AwxRoute.GalaxyNGRemoteRegistries,
          label: t('Remote Registries'),
          path: 'remote-registries',
          element: <GalaxyNgResourceList resource="remote-registries" />,
        },
        {
          id: AwxRoute.GalaxyNGRemotes,
          label: t('Remotes'),
          path: 'remotes',
          element: <GalaxyNgResourceList resource="remotes" />,
        },
        {
          id: AwxRoute.GalaxyNGSignatureKeys,
          label: t('Signature Keys'),
          path: 'signature-keys',
          element: <GalaxyNgResourceList resource="signature-keys" />,
        },
        {
          id: AwxRoute.GalaxyNGCollectionApprovals,
          label: t('Collection Approvals'),
          path: 'collection-approvals',
          element: <GalaxyNgResourceList resource="collection-approvals" />,
        },
        {
          id: AwxRoute.GalaxyNGTasks,
          label: t('Task Management'),
          path: 'tasks',
          element: <GalaxyNgResourceList resource="tasks" />,
        },
        {
          id: AwxRoute.GalaxyNGApiToken,
          label: t('API Token'),
          path: 'api-token',
          element: <GalaxyNgApiToken />,
        },
        {
          path: '',
          element: <Navigate to="overview" replace />,
        },
      ],
    }),
    [t]
  );
}
