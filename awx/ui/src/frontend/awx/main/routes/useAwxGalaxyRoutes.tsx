import { CubesIcon } from '@patternfly/react-icons';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { PageNavigationItem } from '../../../../framework';
import { GalaxyNgOverview } from '../../resources/galaxy/GalaxyNgOverview';
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
          path: '',
          element: <Navigate to="overview" replace />,
        },
      ],
    }),
    [t]
  );
}
