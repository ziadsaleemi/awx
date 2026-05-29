export interface CatalogItem {
  id: number;
  type: 'catalog_item';
  url: string;
  name: string;
  description: string;
  icon_url: string;
  icon_data: string;
  name_template: string;
  dynamic_name_field: string;
  dynamic_field_templates: Record<string, string> | null;
  deploy_disabled_fields: string[] | null;
  deploy_hidden_fields: string[] | null;
  organization: number | null;
  provision_workflow: number | null;
  terraform_job_template: number | null;
  deprovision_workflow: number | null;
  override_workflow_limit: boolean;
  extra_vars_schema: Record<string, unknown> | null;
  cloud_backends: Record<string, number> | null;
  provider_workflows: Record<string, number> | null;
  provider_deprovision_workflows: Record<string, number> | null;
  available_providers: string[] | null;
  provider_field_configs: Record<
    string,
    {
      disabled_fields: string[];
      hidden_fields: string[];
      field_templates: Record<string, string>;
      dynamic_field_sources: Record<string, string>;
      target_inventory?: number | null;
      target_group?: string;
    }
  > | null;
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
    provider_workflow_surveys?: Record<string, string>;
  };
}
