export interface CatalogItem {
  id: number;
  type: 'catalog_item';
  url: string;
  name: string;
  description: string;
  icon_url: string;
  organization: number | null;
  provision_workflow: number | null;
  deprovision_workflow: number | null;
  extra_vars_schema: Record<string, unknown> | null;
  created: string;
  modified: string;
  summary_fields: {
    organization?: { id: number; name: string };
    provision_workflow?: { id: number; name: string };
    deprovision_workflow?: { id: number; name: string };
    user_capabilities: {
      edit: boolean;
      delete: boolean;
      use: boolean;
    };
  };
  related: {
    deployments: string;
    deploy: string;
    provision_workflow?: string;
    deprovision_workflow?: string;
  };
}
