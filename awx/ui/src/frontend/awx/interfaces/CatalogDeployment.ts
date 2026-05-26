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
  deprovision_job: number | null;
  extra_vars: Record<string, unknown> | null;
  created: string;
  modified: string;
  summary_fields: {
    catalog_item?: { id: number; name: string };
    owner?: { id: number; username: string };
    user_capabilities: {
      delete: boolean;
    };
  };
  related: {
    catalog_item?: string;
    provision_job?: string;
    deprovision_job?: string;
    deprovision: string;
  };
}
