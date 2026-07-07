import { SummaryFieldCredential, SummaryFieldRecentJob } from './summary-fields/summary-fields';

export type QuayImageBuildRuntime = 'podman' | 'docker';

export interface QuayImageBuildTemplate {
  id: number;
  type: 'quay_image_build_template';
  url: string;
  launch_url?: string;
  name: string;
  description: string;
  created: string;
  modified: string;
  created_by?: string;
  project:
    | number
    | {
        id: number;
        name: string;
        organization?: { id: number; name: string } | null;
      }
    | null;
  namespace: string;
  repository: string;
  repository_path?: string;
  tag: string;
  image?: string;
  runtime: QuayImageBuildRuntime;
  definition_file: string;
  context?: string;
  context_path?: string;
  execution_environment?: number | null;
  last_job_run?: string | null;
  last_job_failed?: boolean;
  next_job_run?: string | null;
  status?: string;
  latest_build?: {
    id: number;
    status: string;
    image: string;
    created: string;
    modified: string;
    log?: string;
    unified_job?: {
      id: number;
      url: string;
      status: string;
    } | null;
  } | null;
  summary_fields: {
    organization?: { id: number; name: string };
    project?: { id: number; name: string; scm_type?: string };
    execution_environment?: { id: number; name: string };
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
    repository?: {
      namespace: string;
      repository: string;
      repository_path: string;
      tag: string;
    };
    resolved_environment?: { id: number; name: string; description: string; image: string };
    user_capabilities: {
      edit: boolean;
      delete: boolean;
      start: boolean;
      schedule?: boolean;
      copy?: boolean;
    };
    credentials?: SummaryFieldCredential[];
    created_by?: { id: number; username: string };
    modified_by?: { id: number; username: string };
  };
  related: {
    launch?: string;
    jobs?: string;
    schedules?: string;
    notification_templates_started?: string;
    notification_templates_error?: string;
    notification_templates_success?: string;
    object_roles?: string;
    instance_groups?: string;
    project?: string;
    execution_environment?: string;
  };
}
