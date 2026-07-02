import { CubesIcon } from '@patternfly/react-icons';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { PageNavigationItem } from '../../../../framework';
import { ResourceNotifications } from '../../resources/notifications/ResourceNotifications';
import {
  QuayImageBuildTemplateAddTeams,
  QuayImageBuildTemplateAddUsers,
} from '../../resources/quay/QuayImageBuildTemplateAddAccess';
import { QuayApiToken } from '../../resources/quay/QuayApiToken';
import { QuayExecutionEnvironmentImages } from '../../resources/quay/QuayExecutionEnvironmentImages';
import { QuayOverview } from '../../resources/quay/QuayOverview';
import { QuayRepositories, QuayRepositoryDetails } from '../../resources/quay/QuayRepositories';
import { QuayRobots } from '../../resources/quay/QuayRobots';
import { awxAPI } from '../../common/api/awx-utils';
import { ScheduleDetails } from '../../views/schedules/SchedulePage/ScheduleDetails';
import { SchedulePage } from '../../views/schedules/SchedulePage/SchedulePage';
import { ScheduleAddWizard } from '../../views/schedules/wizard/ScheduleAddWizard';
import { ScheduleEditWizard } from '../../views/schedules/wizard/ScheduleEditWizard';
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
          label: t('Execution Environments'),
          path: 'execution-environment-images',
          element: <QuayExecutionEnvironmentImages />,
        },
        {
          id: AwxRoute.QuayImageBuildTemplateScheduleCreate,
          path: 'execution-environment-images/templates/:id/schedules/create',
          element: (
            <ScheduleAddWizard
              resourceEndPoint={awxAPI`/quay/execution-environment-images/templates/`}
            />
          ),
          hidden: true,
        },
        {
          id: AwxRoute.QuayImageBuildTemplateScheduleEdit,
          path: 'execution-environment-images/templates/:id/schedules/:schedule_id/edit',
          element: (
            <ScheduleEditWizard
              resourceEndPoint={awxAPI`/quay/execution-environment-images/templates/`}
            />
          ),
          hidden: true,
        },
        {
          id: AwxRoute.QuayImageBuildTemplateSchedulePage,
          path: 'execution-environment-images/templates/:id/schedules/:schedule_id',
          element: (
            <SchedulePage
              resourceEndPoint={awxAPI`/quay/execution-environment-images/templates/`}
              initialBreadCrumbs={[
                { label: t('Project Quay'), to: AwxRoute.QuayOverview },
                {
                  label: t('Execution Environments'),
                  to: AwxRoute.QuayExecutionEnvironmentImages,
                },
                { id: 'data', to: AwxRoute.QuayExecutionEnvironmentImages },
                {
                  label: t('Schedules'),
                  id: 'schedules',
                  to: AwxRoute.QuayExecutionEnvironmentImages,
                },
              ]}
              backTab={{
                label: t('Back to Schedules'),
                page: AwxRoute.QuayExecutionEnvironmentImages,
                persistentFilterKey: 'quay-image-build-template-schedules',
              }}
              tabs={[
                {
                  label: t('Details'),
                  page: AwxRoute.QuayImageBuildTemplateScheduleDetails,
                },
              ]}
            />
          ),
          hidden: true,
          children: [
            {
              id: AwxRoute.QuayImageBuildTemplateScheduleDetails,
              path: 'details',
              element: <ScheduleDetails />,
            },
          ],
        },
        {
          id: AwxRoute.QuayImageBuildTemplateAddTeams,
          path: 'execution-environment-images/templates/:id/team-access/add',
          element: <QuayImageBuildTemplateAddTeams />,
          hidden: true,
        },
        {
          id: AwxRoute.QuayImageBuildTemplateAddUsers,
          path: 'execution-environment-images/templates/:id/user-access/add',
          element: <QuayImageBuildTemplateAddUsers />,
          hidden: true,
        },
        {
          path: 'execution-environment-images/templates/:id/notifications',
          element: <ResourceNotifications resourceType="quay_image_build_templates" />,
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
