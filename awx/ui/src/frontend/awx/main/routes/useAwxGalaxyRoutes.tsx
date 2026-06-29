import { CubesIcon } from '@patternfly/react-icons';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { PageNavigationItem } from '../../../../framework';
import { GalaxyNgOverview } from '../../resources/galaxy/GalaxyNgOverview';
import { GalaxyNgResourceList } from '../../resources/galaxy/GalaxyNgResourceList';
import { AwxRoute } from '../AwxRoutes';

export function useAwxGalaxyRoutes() {
  const { t } = useTranslation();

  return useMemo<PageNavigationItem>(
    () => ({
      id: AwxRoute.GalaxyNG,
      label: t('Galaxy NG'),
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
          id: AwxRoute.GalaxyNGRepositories,
          label: t('Repositories'),
          path: 'repositories',
          element: <GalaxyNgResourceList resource="repositories" />,
        },
        {
          id: AwxRoute.GalaxyNGTasks,
          label: t('Tasks'),
          path: 'tasks',
          element: <GalaxyNgResourceList resource="tasks" />,
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
