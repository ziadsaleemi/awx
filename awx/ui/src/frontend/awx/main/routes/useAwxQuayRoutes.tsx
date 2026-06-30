import { CubesIcon } from '@patternfly/react-icons';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { PageNavigationItem } from '../../../../framework';
import { QuayExecutionEnvironmentImages } from '../../resources/quay/QuayExecutionEnvironmentImages';
import { QuayOverview } from '../../resources/quay/QuayOverview';
import { QuayRepositories } from '../../resources/quay/QuayRepositories';
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
          id: AwxRoute.QuayExecutionEnvironmentImages,
          label: t('Execution Environments'),
          path: 'execution-environment-images',
          element: <QuayExecutionEnvironmentImages />,
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
