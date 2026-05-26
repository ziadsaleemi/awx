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
import { AwxRoute } from '../AwxRoutes';

export function useAwxTerraformRoutes() {
  const { t } = useTranslation();

  const terraformRoutes = useMemo<PageNavigationItem>(
    () => ({
      id: AwxRoute.TerraformTemplates,
      label: t('Terraform Templates'),
      path: 'terraform-templates',
      children: [
        // Individual Terraform job pages (reached via job history links)
        {
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
        // Template detail / edit pages
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
              id: AwxRoute.TerraformTemplateJobs,
              path: 'jobs',
              element: <TerraformTemplateJobs />,
            },
            { path: '', element: <Navigate to="details" replace /> },
          ],
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
