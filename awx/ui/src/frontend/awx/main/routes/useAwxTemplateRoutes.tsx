import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { PageNavigationItem } from '../../../../framework';
import { awxAPI } from '../../common/api/awx-utils';
import { CreateJobTemplate, EditJobTemplate } from '../../resources/templates/TemplateForm';
import { TemplateDetails } from '../../resources/templates/TemplatePage/TemplateDetails';
import { LaunchTemplate } from '../../resources/templates/TemplatePage/TemplateLaunchWizard';
import { TemplatePage } from '../../resources/templates/TemplatePage/TemplatePage';
import { Templates } from '../../resources/templates/Templates';
import {
  CreateWorkflowJobTemplate,
  EditWorkflowJobTemplate,
} from '../../resources/templates/WorkflowJobTemplateForm';
import { WorkflowJobTemplateDetails } from '../../resources/templates/WorkflowJobTemplatePage/WorkflowJobTemplateDetails';
import { WorkflowJobTemplatePage } from '../../resources/templates/WorkflowJobTemplatePage/WorkflowJobTemplatePage';
import { WorkflowJobTemplateTeamAccess } from '../../resources/templates/WorkflowJobTemplatePage/WorkflowJobTemplateTeamAccess';
import { WorkflowJobTemplateUserAccess } from '../../resources/templates/WorkflowJobTemplatePage/WorkflowJobTemplateUserAccess';
import { WorkflowJobTemplateAddTeams } from '../../resources/templates/WorkflowJobTemplateAddTeams';
import { WorkflowJobTemplateAddUsers } from '../../resources/templates/WorkflowJobTemplateAddUsers';
import { WorkflowVisualizer } from '../../resources/templates/WorkflowVisualizer/WorkflowVisualizer';
import { ScheduleAddWizard } from '../../views/schedules/wizard/ScheduleAddWizard';
import { ScheduleDetails } from '../../views/schedules/SchedulePage/ScheduleDetails';
import { SchedulePage } from '../../views/schedules/SchedulePage/SchedulePage';
import { AwxRoute } from '../AwxRoutes';
import { ResourceNotifications } from '../../resources/notifications/ResourceNotifications';
import {
  CreateQuayImageBuildTemplate,
  EditQuayImageBuildTemplate,
} from '../../resources/quay/QuayImageBuildTemplateForm';
import { QuayImageBuildTemplatePage } from '../../resources/quay/QuayImageBuildTemplatePage';
import { QuayImageBuildTemplateDetails } from '../../resources/quay/QuayImageBuildTemplateDetails';
import {
  QuayImageBuildTemplateTeamAccess,
  QuayImageBuildTemplateUserAccess,
} from '../../resources/quay/QuayImageBuildTemplateAccess';
import { QuayImageBuildTemplateJobs } from '../../resources/quay/QuayImageBuildTemplateJobs';
import { QuayImageBuildTemplateTags } from '../../resources/quay/QuayImageBuildTemplateTags';
import {
  QuayImageBuildTemplateAddTeams,
  QuayImageBuildTemplateAddUsers,
} from '../../resources/quay/QuayImageBuildTemplateAddAccess';
import { TemplateTeamAccess } from '../../resources/templates/TemplatePage/TemplateTeamAccess';
import { TemplateUserAccess } from '../../resources/templates/TemplatePage/TemplateUserAccess';
import { JobTemplateAddTeams } from '../../resources/templates/JobTemplateAddTeams';
import { JobTemplateAddUsers } from '../../resources/templates/JobTemplateAddUsers';
import { TemplateJobs } from '../../resources/templates/TemplatePage/TemplateJobs';
import { TemplateSurvey } from '../../resources/templates/TemplatePage/TemplateSurvey';
import { SchedulesList } from '../../views/schedules/SchedulesList';
import { ScheduleEditWizard } from '../../views/schedules/wizard/ScheduleEditWizard';
import {
  EditTemplateSurveyForm,
  AddTemplateSurveyForm,
} from '../../resources/templates/TemplatePage/TemplateSurveyForm';

export function useAwxTemplateRoutes() {
  const { t } = useTranslation();
  const templateRoutes = useMemo<PageNavigationItem>(
    () => ({
      label: t('Templates'),
      path: 'templates',
      children: [
        {
          path: 'job-template',
          children: [
            {
              id: AwxRoute.CreateJobTemplate,
              path: 'create',
              element: <CreateJobTemplate />,
            },
            {
              id: AwxRoute.EditJobTemplate,
              path: ':id/edit',
              element: <EditJobTemplate />,
            },
            {
              id: AwxRoute.JobTemplateScheduleCreate,
              path: ':id/schedules/create',
              element: <ScheduleAddWizard resourceEndPoint={awxAPI`/job_templates/`} />,
            },
            {
              id: AwxRoute.JobTemplateScheduleEdit,
              path: ':id/schedules/:schedule_id/edit',
              element: <ScheduleEditWizard resourceEndPoint={awxAPI`/job_templates/`} />,
            },
            {
              id: AwxRoute.JobTemplateSchedulePage,
              path: ':id/schedules/:schedule_id',
              element: (
                <SchedulePage
                  resourceEndPoint={awxAPI`/job_templates/`}
                  initialBreadCrumbs={[
                    { label: t('Templates'), to: AwxRoute.Templates },
                    { id: 'data', to: AwxRoute.JobTemplatePage },
                    { label: t('Schedules'), id: 'schedules', to: AwxRoute.JobTemplateSchedules },
                  ]}
                  backTab={{
                    label: t('Back to Schedules'),
                    page: AwxRoute.JobTemplateSchedules,
                    persistentFilterKey: 'job_template-schedules',
                  }}
                  tabs={[
                    {
                      label: t('Details'),
                      page: AwxRoute.JobTemplateScheduleDetails,
                    },
                  ]}
                />
              ),
              children: [
                {
                  id: AwxRoute.JobTemplateScheduleDetails,
                  path: 'details',
                  element: <ScheduleDetails />,
                },
              ],
            },
            {
              id: AwxRoute.JobTemplatePage,
              path: ':id',
              element: <TemplatePage />,
              children: [
                {
                  id: AwxRoute.JobTemplateDetails,
                  path: 'details',
                  element: <TemplateDetails />,
                },
                {
                  id: AwxRoute.JobTemplateTeamAccess,
                  path: 'team-access',
                  element: <TemplateTeamAccess />,
                },
                {
                  id: AwxRoute.JobTemplateUserAccess,
                  path: 'user-access',
                  element: <TemplateUserAccess />,
                },
                {
                  id: AwxRoute.JobTemplateJobs,
                  path: 'job',
                  element: <TemplateJobs resourceType="job_templates" />,
                },
                {
                  id: AwxRoute.JobTemplateNotifications,
                  path: 'notifications',
                  element: <ResourceNotifications resourceType="job_templates" />,
                },
                {
                  id: AwxRoute.JobTemplateSurvey,
                  path: 'survey',
                  element: <TemplateSurvey resourceType="job_templates" />,
                },
                {
                  id: AwxRoute.AddJobTemplateSurvey,
                  path: 'survey/add',
                  element: <AddTemplateSurveyForm resourceType="job_templates" />,
                },
                {
                  id: AwxRoute.EditJobTemplateSurvey,
                  path: 'survey/edit',
                  element: <EditTemplateSurveyForm resourceType="job_templates" />,
                },
                {
                  id: AwxRoute.JobTemplateSchedules,
                  path: 'schedules',
                  element: (
                    <SchedulesList
                      createSchedulePageId={AwxRoute.JobTemplateScheduleCreate}
                      resourceType="job-template"
                      sublistEndpoint={awxAPI`/job_templates`}
                    />
                  ),
                },
                {
                  path: '',
                  element: <Navigate to="details" replace />,
                },
              ],
            },
            {
              id: AwxRoute.JobTemplateAddTeams,
              path: ':id/team-access/add',
              element: <JobTemplateAddTeams />,
            },
            {
              id: AwxRoute.JobTemplateAddUsers,
              path: ':id/user-access/add',
              element: <JobTemplateAddUsers />,
            },
            {
              id: AwxRoute.TemplateLaunchWizard,
              path: ':id/launch',
              element: <LaunchTemplate jobType="job_templates" />,
            },
          ],
        },
        {
          path: 'workflow-job-template',
          children: [
            {
              id: AwxRoute.CreateWorkflowJobTemplate,
              path: 'create',
              element: <CreateWorkflowJobTemplate />,
            },
            {
              id: AwxRoute.EditWorkflowJobTemplate,
              path: ':id/edit',
              element: <EditWorkflowJobTemplate />,
            },
            {
              id: AwxRoute.WorkflowJobTemplateScheduleCreate,
              path: ':id/schedules/create',
              element: <ScheduleAddWizard resourceEndPoint={awxAPI`/workflow_job_templates/`} />,
            },
            {
              id: AwxRoute.WorkflowJobTemplateScheduleEdit,
              path: ':id/schedules/:schedule_id/edit',
              element: <ScheduleEditWizard resourceEndPoint={awxAPI`/workflow_job_templates/`} />,
            },
            {
              id: AwxRoute.WorkflowJobTemplateSchedulePage,
              path: ':id/schedules/:schedule_id',
              element: (
                <SchedulePage
                  resourceEndPoint={awxAPI`/workflow_job_templates/`}
                  initialBreadCrumbs={[
                    { label: t('Templates'), to: AwxRoute.Templates },
                    { id: 'data', to: AwxRoute.WorkflowJobTemplatePage },
                    {
                      label: t('Schedules'),
                      id: 'schedules',
                      to: AwxRoute.WorkflowJobTemplateSchedules,
                    },
                  ]}
                  backTab={{
                    label: t('Back to Schedules'),
                    page: AwxRoute.WorkflowJobTemplateSchedules,
                    persistentFilterKey: 'workflow_job_template-schedules',
                  }}
                  tabs={[
                    {
                      label: t('Details'),
                      page: AwxRoute.WorkflowJobTemplateScheduleDetails,
                    },
                  ]}
                />
              ),
              children: [
                {
                  id: AwxRoute.WorkflowJobTemplateScheduleDetails,
                  path: 'details',
                  element: <ScheduleDetails />,
                },
              ],
            },
            {
              id: AwxRoute.WorkflowVisualizer,
              path: ':id/visualizer',
              element: <WorkflowVisualizer />,
            },
            {
              id: AwxRoute.WorkflowJobTemplatePage,
              path: ':id',
              element: <WorkflowJobTemplatePage />,
              children: [
                {
                  id: AwxRoute.WorkflowJobTemplateDetails,
                  path: 'details',
                  element: <WorkflowJobTemplateDetails />,
                },
                {
                  id: AwxRoute.WorkflowJobTemplateTeamAccess,
                  path: 'team-access',
                  element: <WorkflowJobTemplateTeamAccess />,
                },
                {
                  id: AwxRoute.WorkflowJobTemplateUserAccess,
                  path: 'user-access',
                  element: <WorkflowJobTemplateUserAccess />,
                },
                {
                  id: AwxRoute.WorkflowJobTemplateJobs,
                  path: 'workflow-jobs',
                  element: <TemplateJobs resourceType="workflow_job_templates" />,
                },
                {
                  id: AwxRoute.WorkflowJobTemplateSurvey,
                  path: 'survey',
                  element: <TemplateSurvey resourceType="workflow_job_templates" />,
                },
                {
                  id: AwxRoute.AddWorkflowJobTemplateSurvey,
                  path: 'survey/add',
                  element: <AddTemplateSurveyForm resourceType="workflow_job_templates" />,
                },
                {
                  id: AwxRoute.EditWorkflowJobTemplateSurvey,
                  path: 'survey/edit',
                  element: <EditTemplateSurveyForm resourceType="workflow_job_templates" />,
                },
                {
                  id: AwxRoute.WorkflowJobTemplateSchedules,
                  path: 'schedules',
                  element: (
                    <SchedulesList
                      createSchedulePageId={AwxRoute.WorkflowJobTemplateScheduleCreate}
                      resourceType="workflow-job-template"
                      sublistEndpoint={awxAPI`/workflow_job_templates`}
                    />
                  ),
                },
                {
                  id: AwxRoute.WorkflowJobTemplateNotifications,
                  path: 'notifications',
                  element: <ResourceNotifications resourceType="workflow_job_templates" />,
                },
                {
                  path: '',
                  element: <Navigate to="details" replace />,
                },
              ],
            },
            {
              id: AwxRoute.WorkflowJobTemplateAddTeams,
              path: ':id/team-access/add',
              element: <WorkflowJobTemplateAddTeams />,
            },
            {
              id: AwxRoute.WorkflowJobTemplateAddUsers,
              path: ':id/user-access/add',
              element: <WorkflowJobTemplateAddUsers />,
            },
            {
              id: AwxRoute.WorkflowJobTemplateLaunchWizard,
              path: ':id/launch',
              element: <LaunchTemplate jobType="workflow_job_templates" />,
            },
          ],
        },
        {
          path: 'ee-build-template',
          children: [
            {
              id: AwxRoute.CreateQuayImageBuildTemplate,
              path: 'create',
              element: <CreateQuayImageBuildTemplate />,
            },
            {
              id: AwxRoute.EditQuayImageBuildTemplate,
              path: ':id/edit',
              element: <EditQuayImageBuildTemplate />,
            },
            {
              id: AwxRoute.QuayImageBuildTemplateScheduleCreate,
              path: ':id/schedules/create',
              element: (
                <ScheduleAddWizard
                  resourceEndPoint={awxAPI`/quay/execution-environment-images/templates/`}
                />
              ),
            },
            {
              id: AwxRoute.QuayImageBuildTemplateScheduleEdit,
              path: ':id/schedules/:schedule_id/edit',
              element: (
                <ScheduleEditWizard
                  resourceEndPoint={awxAPI`/quay/execution-environment-images/templates/`}
                />
              ),
            },
            {
              id: AwxRoute.QuayImageBuildTemplateSchedulePage,
              path: ':id/schedules/:schedule_id',
              element: (
                <SchedulePage
                  resourceEndPoint={awxAPI`/quay/execution-environment-images/templates/`}
                  initialBreadCrumbs={[
                    { label: t('Templates'), to: AwxRoute.Templates },
                    { id: 'data', to: AwxRoute.QuayImageBuildTemplatePage },
                    {
                      label: t('Schedules'),
                      id: 'schedules',
                      to: AwxRoute.QuayImageBuildTemplateSchedules,
                    },
                  ]}
                  backTab={{
                    label: t('Back to Schedules'),
                    page: AwxRoute.QuayImageBuildTemplateSchedules,
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
              children: [
                {
                  id: AwxRoute.QuayImageBuildTemplateScheduleDetails,
                  path: 'details',
                  element: <ScheduleDetails />,
                },
              ],
            },
            {
              id: AwxRoute.QuayImageBuildTemplatePage,
              path: ':id',
              element: <QuayImageBuildTemplatePage />,
              children: [
                {
                  id: AwxRoute.QuayImageBuildTemplateDetails,
                  path: 'details',
                  element: <QuayImageBuildTemplateDetails />,
                },
                {
                  id: AwxRoute.QuayImageBuildTemplateTeamAccess,
                  path: 'team-access',
                  element: <QuayImageBuildTemplateTeamAccess />,
                },
                {
                  id: AwxRoute.QuayImageBuildTemplateUserAccess,
                  path: 'user-access',
                  element: <QuayImageBuildTemplateUserAccess />,
                },
                {
                  id: AwxRoute.QuayImageBuildTemplateSchedules,
                  path: 'schedules',
                  element: (
                    <SchedulesList
                      createSchedulePageId={AwxRoute.QuayImageBuildTemplateScheduleCreate}
                      resourceType="quay-image-build-template"
                      sublistEndpoint={awxAPI`/quay/execution-environment-images/templates`}
                    />
                  ),
                },
                {
                  id: AwxRoute.QuayImageBuildTemplateJobs,
                  path: 'jobs',
                  element: <QuayImageBuildTemplateJobs />,
                },
                {
                  id: AwxRoute.QuayImageBuildTemplateNotifications,
                  path: 'notifications',
                  element: <ResourceNotifications resourceType="quay_image_build_templates" />,
                },
                {
                  id: AwxRoute.QuayImageBuildTemplateTags,
                  path: 'tags',
                  element: <QuayImageBuildTemplateTags />,
                },
                {
                  path: '',
                  element: <Navigate to="details" replace />,
                },
              ],
            },
            {
              id: AwxRoute.QuayImageBuildTemplateAddTeams,
              path: ':id/team-access/add',
              element: <QuayImageBuildTemplateAddTeams />,
            },
            {
              id: AwxRoute.QuayImageBuildTemplateAddUsers,
              path: ':id/user-access/add',
              element: <QuayImageBuildTemplateAddUsers />,
            },
          ],
        },
        {
          id: AwxRoute.Templates,
          path: '',
          element: <Templates />,
        },
      ],
    }),
    [t]
  );
  return templateRoutes;
}
