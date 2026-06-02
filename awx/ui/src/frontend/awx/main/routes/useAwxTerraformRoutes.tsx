import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { PageNavigationItem } from '../../../../framework';
import { TerraformTemplates } from '../../resources/terraform/TerraformTemplates';
import { TerraformTemplatePage } from '../../resources/terraform/TerraformTemplatePage';
import { TerraformTemplateDetails } from '../../resources/terraform/TerraformTemplateDetails';
import { TerraformTemplateJobs } from '../../resources/terraform/TerraformTemplateJobs';
import {
  CreateTerraformTemplate,
  EditTerraformTemplate,
} from '../../resources/terraform/TerraformTemplateForm';
import { TerraformTemplateLaunch } from '../../resources/terraform/TerraformTemplateLaunch';
import { TerraformJobPage } from '../../resources/terraform/TerraformJobPage';
import { TerraformJobOutput } from '../../resources/terraform/TerraformJobOutput';
import { TerraformJobDetails } from '../../resources/terraform/TerraformJobDetails';
import { TerraformTemplateTeamAccess } from '../../resources/terraform/TerraformTemplateTeamAccess';
import { TerraformTemplateUserAccess } from '../../resources/terraform/TerraformTemplateUserAccess';
import { TerraformTemplateAddTeams } from '../../resources/terraform/TerraformTemplateAddTeams';
import { TerraformTemplateAddUsers } from '../../resources/terraform/TerraformTemplateAddUsers';
import { ResourceNotifications } from '../../resources/notifications/ResourceNotifications';
import { TemplateSurvey } from '../../resources/templates/TemplatePage/TemplateSurvey';
import {
  AddTemplateSurveyForm,
  EditTemplateSurveyForm,
} from '../../resources/templates/TemplatePage/TemplateSurveyForm';
import { SchedulesList } from '../../views/schedules/SchedulesList';
import { ScheduleAddWizard } from '../../views/schedules/wizard/ScheduleAddWizard';
import { ScheduleEditWizard } from '../../views/schedules/wizard/ScheduleEditWizard';
import { SchedulePage } from '../../views/schedules/SchedulePage/SchedulePage';
import { ScheduleDetails } from '../../views/schedules/SchedulePage/ScheduleDetails';
import { awxAPI } from '../../common/api/awx-utils';
import { AwxRoute } from '../AwxRoutes';

export function useAwxTerraformRoutes() {
  const { t } = useTranslation();

  const terraformRoutes = useMemo<PageNavigationItem>(
    () => ({
      id: AwxRoute.TerraformTemplates,
      label: t('Terraform Templates'),
      path: 'terraform-templates',
      hidden: true,
      children: [
        // Individual Terraform job pages (reached via job history links)
        {
          id: AwxRoute.TerraformJobPage,
          path: 'jobs/:job_id',
          element: <TerraformJobPage />,
          children: [
            {
              id: AwxRoute.TerraformJobOutput,
              path: 'output',
              element: <TerraformJobOutput />,
            },
            {
              id: AwxRoute.TerraformJobDetails,
              path: 'details',
              element: <TerraformJobDetails />,
            },
            { path: '', element: <Navigate to="output" replace /> },
          ],
        },
        // Schedule sub-routes (must be outside TerraformTemplatePage to avoid URL conflicts)
        {
          id: AwxRoute.TerraformTemplateScheduleCreate,
          path: ':id/schedules/create',
          element: <ScheduleAddWizard resourceEndPoint={awxAPI`/terraform_job_templates/`} />,
        },
        {
          id: AwxRoute.TerraformTemplateScheduleEdit,
          path: ':id/schedules/:schedule_id/edit',
          element: <ScheduleEditWizard resourceEndPoint={awxAPI`/terraform_job_templates/`} />,
        },
        {
          id: AwxRoute.TerraformTemplateSchedulePage,
          path: ':id/schedules/:schedule_id',
          element: (
            <SchedulePage
              resourceEndPoint={awxAPI`/terraform_job_templates/`}
              initialBreadCrumbs={[
                { label: t('Templates'), to: AwxRoute.Templates },
                { id: 'data', to: AwxRoute.TerraformTemplatePage },
                { label: t('Schedules'), id: 'schedules', to: AwxRoute.TerraformTemplateSchedules },
              ]}
              backTab={{
                label: t('Back to Schedules'),
                page: AwxRoute.TerraformTemplateSchedules,
                persistentFilterKey: 'terraform-schedules',
              }}
              tabs={[
                {
                  label: t('Details'),
                  page: AwxRoute.TerraformTemplateScheduleDetails,
                },
              ]}
            />
          ),
          children: [
            {
              id: AwxRoute.TerraformTemplateScheduleDetails,
              path: 'details',
              element: <ScheduleDetails />,
            },
          ],
        },
        // Template detail page with tabs
        {
          id: AwxRoute.TerraformTemplatePage,
          path: ':id',
          element: <TerraformTemplatePage />,
          children: [
            {
              id: AwxRoute.TerraformTemplateDetails,
              path: 'details',
              element: <TerraformTemplateDetails />,
            },
            {
              id: AwxRoute.TerraformTemplateTeamAccess,
              path: 'team-access',
              element: <TerraformTemplateTeamAccess />,
            },
            {
              id: AwxRoute.TerraformTemplateUserAccess,
              path: 'user-access',
              element: <TerraformTemplateUserAccess />,
            },
            {
              id: AwxRoute.TerraformTemplateNotifications,
              path: 'notifications',
              element: <ResourceNotifications resourceType="terraform_job_templates" />,
            },
            {
              id: AwxRoute.TerraformTemplateJobs,
              path: 'jobs',
              element: <TerraformTemplateJobs />,
            },
            {
              id: AwxRoute.TerraformTemplateSchedules,
              path: 'schedules',
              element: (
                <SchedulesList
                  createSchedulePageId={AwxRoute.TerraformTemplateScheduleCreate}
                  resourceType="terraform-job-template"
                  sublistEndpoint={awxAPI`/terraform_job_templates`}
                />
              ),
            },
            {
              id: AwxRoute.TerraformTemplateSurvey,
              path: 'survey',
              element: <TemplateSurvey resourceType="terraform_job_templates" />,
            },
            {
              id: AwxRoute.AddTerraformTemplateSurvey,
              path: 'survey/add',
              element: <AddTemplateSurveyForm resourceType="terraform_job_templates" />,
            },
            {
              id: AwxRoute.EditTerraformTemplateSurvey,
              path: 'survey/edit',
              element: <EditTemplateSurveyForm resourceType="terraform_job_templates" />,
            },
            { path: '', element: <Navigate to="details" replace /> },
          ],
        },
        // Add team / user access routes
        {
          id: AwxRoute.TerraformTemplateAddTeams,
          path: ':id/team-access/add',
          element: <TerraformTemplateAddTeams />,
        },
        {
          id: AwxRoute.TerraformTemplateAddUsers,
          path: ':id/user-access/add',
          element: <TerraformTemplateAddUsers />,
        },
        {
          id: AwxRoute.TerraformTemplateLaunch,
          path: ':id/launch',
          element: <TerraformTemplateLaunch />,
        },
        {
          id: AwxRoute.EditTerraformTemplate,
          path: ':id/edit',
          element: <EditTerraformTemplate />,
        },
        {
          id: AwxRoute.CreateTerraformTemplate,
          path: 'create',
          element: <CreateTerraformTemplate />,
        },
        { path: '', element: <TerraformTemplates /> },
      ],
    }),
    [t]
  );

  return terraformRoutes;
}
