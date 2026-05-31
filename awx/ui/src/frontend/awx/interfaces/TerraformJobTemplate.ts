import { SummaryFieldCredential, SummaryFieldRecentJob } from './summary-fields/summary-fields';

export interface TerraformJobTemplate {
  id: number;
  type: 'terraform_job_template';
  url: string;
  name: string;
  description: string;
  created: string;
  modified: string;

  project: number | null;
  terraform_dir: string;
  extra_vars: string;
  verbosity: 0 | 1 | 2 | 3 | 4;
  terraform_operation: 'apply' | 'plan' | 'destroy';

  target_inventory: number | null;
  target_group: string;

  allow_simultaneous: boolean;
  timeout: number;

  ask_variables_on_launch: boolean;
  ask_inventory_on_launch: boolean;
  ask_terraform_operation_on_launch: boolean;

  survey_enabled: boolean;

  last_job_run: string | null;
  last_job_failed: boolean;
  next_job_run: string | null;
  status: string;

  summary_fields: {
    organization?: { id: number; name: string };
    project?: { id: number; name: string; scm_type: string };
    inventory?: { id: number; name: string; kind: string };
    execution_environment?: { id: number; name: string };
    target_inventory?: { id: number; name: string; kind: string };
    recent_jobs?: SummaryFieldRecentJob[];
    labels?: { count: number; results: { id: number; name: string }[] };
    last_job?: {
      id: number;
      name: string;
      description: string;
      finished: string | null;
      status: string;
      failed: boolean;
    };
    resolved_environment?: { id: number; name: string; description: string; image: string };
    user_capabilities: {
      edit: boolean;
      delete: boolean;
      start: boolean;
      copy: boolean;
    };
    credentials?: SummaryFieldCredential[];
    created_by?: { id: number; username: string };
    modified_by?: { id: number; username: string };
  };
  related: {
    launch: string;
    jobs: string;
    survey_spec: string;
  };
}
