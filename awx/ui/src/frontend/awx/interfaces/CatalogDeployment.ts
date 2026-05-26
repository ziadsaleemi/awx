export type CatalogDeploymentStatus =
  | 'pending'
  | 'provisioning'
  | 'active'
  | 'deprovisioning'
  | 'failed'
  | 'destroyed';

export interface CatalogDeployment {
  id: number;
  type: 'catalog_deployment';
  url: string;
  name: string;
  description: string;
  status: CatalogDeploymentStatus;
  catalog_item: number | null;
  owner: number | null;
  provision_job: number | null;
  terraform_provision_job: number | null;
  deprovision_job: number | null;
  last_failed_workflow_job: number | null;
  extra_vars: Record<string, unknown> | null;
  last_deprovision_vars: Record<string, unknown> | null;
  provisioning_history: Array<{
    action: string;
    status: string;
    created: string;
    finished?: string;
    job_id?: number | null;
    job_type?: string | null;
    details?: Record<string, unknown>;
  }>;
  created: string;
  modified: string;
  summary_fields: {
    catalog_item?: { id: number; name: string };
    owner?: { id: number; username: string };
    organization?: { id: number; name: string };
    user_capabilities: {
      delete: boolean;
      retry: boolean;
    };
  };
  related: {
    catalog_item?: string;
    provision_job?: string;
    terraform_provision_job?: string;
    deprovision_job?: string;
    deprovision: string;
    retry: string;
  };
}
