export interface CatalogItem {
  id: number;
  type: 'catalog_item';
  url: string;
  name: string;
  description: string;
  icon_url: string;
  icon_data: string;
  organization: number | null;
  provision_workflow: number | null;
  terraform_job_template: number | null;
  deprovision_workflow: number | null;
  override_workflow_limit: boolean;
  extra_vars_schema: Record<string, unknown> | null;
  created: string;
  modified: string;
  summary_fields: {
    organization?: { id: number; name: string };
    provision_workflow?: { id: number; name: string };
    terraform_job_template?: { id: number; name: string };
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
    deploy_survey: string;
    provision_workflow?: string;
    terraform_job_template?: string;
    deprovision_workflow?: string;
  };
}
