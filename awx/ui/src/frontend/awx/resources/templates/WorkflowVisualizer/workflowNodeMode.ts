import type { WorkflowNode } from '../../../interfaces/WorkflowNode';
import { RESOURCE_TYPE } from './constants';

export type WorkflowCanvasMode = 'all' | 'deterministic' | 'event_driven' | 'ai';

export type WorkflowModeCounts = Record<WorkflowCanvasMode, number>;

export function getWorkflowNodeMode(
  resource?: Partial<WorkflowNode>
): Exclude<WorkflowCanvasMode, 'all'> {
  const nodeType =
    resource?.node_type || resource?.summary_fields?.unified_job_template?.unified_job_type;

  if (nodeType === RESOURCE_TYPE.eda_rulebook) {
    return 'event_driven';
  }
  if (nodeType === RESOURCE_TYPE.ai_task) {
    return 'ai';
  }
  return 'deterministic';
}

export function createEmptyWorkflowModeCounts(): WorkflowModeCounts {
  return {
    all: 0,
    deterministic: 0,
    event_driven: 0,
    ai: 0,
  };
}
