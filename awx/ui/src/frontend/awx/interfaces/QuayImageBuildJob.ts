import { JobSummaryFields } from './summary-fields/summary-fields';

export type QuayImageBuildJobStatus =
  | 'new'
  | 'pending'
  | 'waiting'
  | 'running'
  | 'successful'
  | 'failed'
  | 'error'
  | 'canceled';

export interface QuayImageBuildJob {
  id: number;
  type: 'quay_image_build_job';
  url: string;
  name: string;
  description: string;
  created: string;
  modified: string;
  started: string | null;
  finished: string | null;
  elapsed: number;
  status: QuayImageBuildJobStatus;
  failed: boolean;
  quay_image_build_template: number | null;
  project: number | null;
  namespace: string;
  repository: string;
  tag: string;
  image: string;
  registry: string;
  runtime: 'podman' | 'docker';
  definition_file: string;
  context_path: string;
  scm_revision: string;
  progress: number;
  command_summary: { label?: string; command?: string; cmd?: string }[];
  result_stdout: string;
  summary_fields: JobSummaryFields;
  related: {
    quay_image_build_template?: string;
    project?: string;
    quay_image_build?: string;
    cancel?: string;
    stdout?: string;
  };
}
