import { CatalogDeployment } from '../../interfaces/CatalogDeployment';
import { AwxRoute } from '../../main/AwxRoutes';

type PageRouteParams = Record<string, string | number | undefined>;

export interface CatalogJobRoute {
  route: AwxRoute;
  params: PageRouteParams;
}

export function workflowJobOutputRoute(
  jobId: number | string | null | undefined
): CatalogJobRoute | undefined {
  if (!jobId) return undefined;
  return {
    route: AwxRoute.JobOutput,
    params: { job_type: 'workflow', id: String(jobId) },
  };
}

export function terraformJobOutputRoute(
  jobId: number | string | null | undefined
): CatalogJobRoute | undefined {
  if (!jobId) return undefined;
  return {
    route: AwxRoute.TerraformJobOutput,
    params: { job_id: String(jobId) },
  };
}

function normalizeHistoryJobType(jobType: string | null | undefined) {
  if (!jobType) return undefined;
  const normalized = jobType.replace(/[_-]/g, '').toLowerCase();
  if (normalized === 'terraformjob') return 'terraform';
  if (normalized === 'workflowjob') return 'workflow';
  return undefined;
}

export function historyJobOutputRoute(
  entry: CatalogDeployment['provisioning_history'][number]
): CatalogJobRoute | undefined {
  const jobKind = normalizeHistoryJobType(entry.job_type);
  if (jobKind === 'terraform') {
    return terraformJobOutputRoute(entry.job_id);
  }
  if (jobKind === 'workflow') {
    return workflowJobOutputRoute(entry.job_id);
  }
  return undefined;
}

export function isWorkflowHistoryJob(entry: CatalogDeployment['provisioning_history'][number]) {
  return normalizeHistoryJobType(entry.job_type) === 'workflow';
}
