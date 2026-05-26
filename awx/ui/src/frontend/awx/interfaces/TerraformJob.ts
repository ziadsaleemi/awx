export interface TerraformJob {
  id: number;
  type: 'terraform_job';
  url: string;
  name: string;
  description: string;
  created: string;
  modified: string;
  started: string | null;
  finished: string | null;
  elapsed: number;

  project: number | null;
  terraform_dir: string;
  extra_vars: string;
  verbosity: 0 | 1 | 2 | 3 | 4;
  terraform_operation: 'apply' | 'plan' | 'destroy';

  target_inventory: number | null;
  target_group: string;
  timeout: number;

  status: 'new' | 'pending' | 'waiting' | 'running' | 'successful' | 'failed' | 'error' | 'canceled';
  failed: boolean;
  result_stdout: string;
  execution_node: string;
  artifacts?: Record<string, unknown>;

  summary_fields: {
    unified_job_template?: { id: number; name: string; description: string; unified_job_type: string };
    terraform_job_template?: { id: number; name: string; description: string };
    project?: { id: number; name: string; scm_type: string };
    target_inventory?: { id: number; name: string; kind: string };
    created_by?: { id: number; username: string };
    user_capabilities: {
      delete: boolean;
      start: boolean;
    };
  };
  related: {
    cancel: string;
    stdout: string;
  };
  host_status_counts?: Record<string, number>;
}
