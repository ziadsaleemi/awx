import { preload } from 'swr';
import { requestGet } from '../../common/crud/Data';
import { awxAPI } from '../common/api/awx-utils';

interface AwxPrefetchOptions {
  includeAdminResources?: boolean;
}

async function prefetchJson(url: string) {
  return requestGet<unknown>(url);
}

export function getAwxPrefetchUrls(options: AwxPrefetchOptions = {}) {
  const urls = [
    awxAPI`/dashboard/`,
    awxAPI`/dashboard/graphs/jobs/?job_type=all&period=month`,
    awxAPI`/config/`,
    awxAPI`/unified_jobs/?page_size=1`,
    awxAPI`/job_templates/?page_size=1`,
    awxAPI`/workflow_job_templates/?page_size=1`,
    awxAPI`/schedules/?page_size=1`,
    awxAPI`/projects/?page_size=1`,
    awxAPI`/terraform_job_templates/?page_size=1`,
    awxAPI`/catalog_items/?page_size=1`,
    awxAPI`/catalog_deployments/?page_size=1`,
    awxAPI`/inventories/?page_size=1`,
    awxAPI`/constructed_inventories/?page_size=1`,
    awxAPI`/inventory_sources/?page_size=1`,
    awxAPI`/groups/?page_size=1`,
    awxAPI`/hosts/?page_size=1`,
    awxAPI`/instance_groups/?page_size=1`,
    awxAPI`/instances/?page_size=1`,
    awxAPI`/instances/?page_size=50`,
    awxAPI`/execution_environments/?page_size=1`,
    awxAPI`/workflow_approvals/?page_size=1`,
    awxAPI`/activity_stream/?page_size=1`,
    awxAPI`/organizations/?page_size=1`,
    awxAPI`/teams/?page_size=1`,
    awxAPI`/users/?page_size=1`,
    awxAPI`/credentials/?page_size=1`,
    awxAPI`/credential_types/?page_size=1`,
  ];

  if (options.includeAdminResources) {
    urls.push(
      awxAPI`/notification_templates/?page_size=1`,
      awxAPI`/system_job_templates/?page_size=1`,
      awxAPI`/system_jobs/?page_size=1`,
      awxAPI`/catalog_cloud/connections/?page_size=1`
    );
  }

  return urls;
}

export function prefetchAwxUrls(options: AwxPrefetchOptions = {}) {
  for (const url of getAwxPrefetchUrls(options)) {
    void preload(url, prefetchJson).catch(() => {
      // Prefetch is only an optimization. The page-level request will surface real errors.
    });
  }
}
