import { CubesIcon } from '@patternfly/react-icons';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { PageNavigationItem } from '../../../../framework';
import { QuayApiToken } from '../../resources/quay/QuayApiToken';
import { QuayOverview } from '../../resources/quay/QuayOverview';
import { QuayRepositories, QuayRepositoryDetails } from '../../resources/quay/QuayRepositories';
import { QuayRobots } from '../../resources/quay/QuayRobots';
import { AwxRoute } from '../AwxRoutes';

export function useAwxQuayRoutes() {
  const { t } = useTranslation();

  return useMemo<PageNavigationItem>(
    () => ({
      id: AwxRoute.Quay,
      label: t('Project Quay'),
      path: 'quay',
      icon: <CubesIcon />,
      children: [
        {
          id: AwxRoute.QuayOverview,
          label: t('Overview'),
          path: 'overview',
          element: <QuayOverview />,
        },
        {
          id: AwxRoute.QuayRepositories,
          label: t('Repositories'),
          path: 'repositories',
          element: <QuayRepositories />,
        },
        {
          id: AwxRoute.QuayRepositoryDetails,
          path: 'repositories/:namespace/:repository',
          element: <QuayRepositoryDetails />,
          hidden: true,
        },
        {
          id: AwxRoute.QuayRepositoryPermissions,
          path: 'repository-permissions',
          element: <Navigate to="../repositories" replace />,
          hidden: true,
        },
        {
          id: AwxRoute.QuayRobots,
          label: t('Robot Accounts'),
          path: 'robots',
          element: <QuayRobots />,
        },
        {
          id: AwxRoute.QuayExecutionEnvironmentImages,
          path: 'execution-environment-images',
          element: <Navigate to="/templates" replace />,
          hidden: true,
        },
        {
          id: AwxRoute.QuayApiToken,
          label: t('API Token'),
          path: 'api-token',
          element: <QuayApiToken />,
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
