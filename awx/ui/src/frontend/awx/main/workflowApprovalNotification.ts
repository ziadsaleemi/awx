import { WorkflowApproval } from '../interfaces/WorkflowApproval';
import { AwxRoute } from './AwxRoutes';

export type GetPageUrl = (
  id: string,
  options?: {
    params?: Record<string, string | number | undefined>;
    query?: Record<string, string | string[] | number | number[] | undefined>;
  }
) => string;

export function getWorkflowApprovalNotificationUrl(
  getPageUrl: GetPageUrl,
  workflowApproval: WorkflowApproval
) {
  return getPageUrl(AwxRoute.WorkflowApprovals, {
    query: {
      id: workflowApproval.id.toString(),
      status: 'pending',
    },
  });
}
