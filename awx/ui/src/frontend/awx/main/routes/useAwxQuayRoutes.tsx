import { CubesIcon } from '@patternfly/react-icons';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { PageNavigationItem } from '../../../../framework';
import { QuayApiToken } from '../../resources/quay/QuayApiToken';
import { QuayExecutionEnvironmentImages } from '../../resources/quay/QuayExecutionEnvironmentImages';
import { QuayOverview } from '../../resources/quay/QuayOverview';
import { QuayRepositories } from '../../resources/quay/QuayRepositories';
import { QuayRepositoryPermissions } from '../../resources/quay/QuayRepositoryPermissions';
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
          id: AwxRoute.QuayRepositoryPermissions,
          label: t('Repository Permissions'),
          path: 'repository-permissions',
          element: <QuayRepositoryPermissions />,
        },
        {
          id: AwxRoute.QuayRobots,
          label: t('Robot Accounts'),
          path: 'robots',
          element: <QuayRobots />,
        },
        {
          id: AwxRoute.QuayExecutionEnvironmentImages,
          label: t('Execution Environments'),
          path: 'execution-environment-images',
          element: <QuayExecutionEnvironmentImages />,
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
