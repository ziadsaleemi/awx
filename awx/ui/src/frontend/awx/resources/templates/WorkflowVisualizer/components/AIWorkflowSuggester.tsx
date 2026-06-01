import {
  Alert,
  Badge,
  Button,
  CodeBlock,
  CodeBlockCode,
  FormGroup,
  Modal,
  ModalVariant,
  Spinner,
  Stack,
  StackItem,
  Text,
  TextArea,
  TextContent,
  TextVariants,
} from '@patternfly/react-core';
import { LabelPosition, NodeShape, useVisualizationController } from '@patternfly/react-topology';
import { MagicIcon } from '@patternfly/react-icons';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AwxItemsResponse } from '../../../../common/AwxItemsResponse';
import { useAIAssistantEnabled } from '../../../../common/AIAssistant';
import { awxAPI } from '../../../../common/api/awx-utils';
import { postRequest, requestGet } from '../../../../../common/crud/Data';
import { NODE_DIAMETER, RESOURCE_TYPE, START_NODE_ID } from '../constants';
import { useCreateEdge } from '../hooks';
import { ControllerState, EdgeStatus, PromptFormValues, UnifiedJobType } from '../types';

interface AIChatResponse {
  message: { role: string; content: string };
}

type AIWorkflowPlanNodeType =
  | UnifiedJobType
  | 'job_template'
  | 'workflow_job_template'
  | 'approval'
  | 'terraform'
  | 'terraform_job_template'
  | 'project'
  | 'inventory_source'
  | 'eda'
  | 'eda_rulebook'
  | 'ai'
  | 'ai_task';

interface AIWorkflowPlanNode {
  id?: string;
  name: string;
  type: AIWorkflowPlanNodeType;
  description?: string;
  template_id?: number;
  template_name?: string;
  after?: string | string[];
  run?: 'success' | 'failure' | 'always' | 'root';
  approval_timeout?: number;
  convergence?: 'any' | 'all';
}

interface AIWorkflowPlanEdge {
  source: string;
  target: string;
  status?: 'success' | 'failure' | 'always';
}

interface AIWorkflowPlan {
  name?: string;
  summary?: string;
  nodes: AIWorkflowPlanNode[];
  edges?: AIWorkflowPlanEdge[];
  warnings?: string[];
}

interface UnifiedJobTemplateSummary {
  id: number;
  name: string;
  description?: string;
  type?: string;
  unified_job_type?: UnifiedJobType;
}

interface ResolvedWorkflowPlanNode {
  planNode: AIWorkflowPlanNode;
  key: string;
  nodeType: UnifiedJobType | 'eda_rulebook' | 'ai_task' | null;
  template?: UnifiedJobTemplateSummary;
  valid: boolean;
  error?: string;
}

interface ResolvedWorkflowPlanEdge {
  source: string;
  target: string;
  status: EdgeStatus;
  valid: boolean;
  error?: string;
}

interface ResolvedWorkflowPlan {
  plan: AIWorkflowPlan;
  nodes: ResolvedWorkflowPlanNode[];
  edges: ResolvedWorkflowPlanEdge[];
  canApply: boolean;
  errors: string[];
}

const SYSTEM_PROMPT = `You are an AWX workflow automation architect.
Return ONLY JSON. No markdown fences. No prose.
Schema:
{
  "name": "short plan name",
  "summary": "one sentence",
  "nodes": [
    {
      "id": "stable lowercase id",
      "name": "node label",
      "type": "job|workflow_job|terraform_job|project_update|inventory_update|system_job|workflow_approval|eda_rulebook|ai_task",
      "template_id": 123,
      "template_name": "exact existing AWX template name when template_id is unknown",
      "description": "what this node does",
      "after": "previous-node-id",
      "run": "success|failure|always|root",
      "approval_timeout": 0,
      "convergence": "any|all"
    }
  ],
  "edges": [
    { "source": "node-id", "target": "node-id", "status": "success|failure|always" }
  ],
  "warnings": []
}
Use only available AWX template ids/names from context for executable nodes.
Use workflow_approval for human gates.
Use eda_rulebook or ai_task only when user explicitly asks for event-driven or runtime AI behavior; these are preview-only until AWX persistence supports them.
List at most 8 nodes.`;

const typeAliases: Record<string, UnifiedJobType | 'eda_rulebook' | 'ai_task'> = {
  approval: RESOURCE_TYPE.workflow_approval,
  ai: 'ai_task',
  ai_task: 'ai_task',
  eda: 'eda_rulebook',
  eda_rulebook: 'eda_rulebook',
  inventory_source: RESOURCE_TYPE.inventory_update,
  inventory_update: RESOURCE_TYPE.inventory_update,
  job: RESOURCE_TYPE.job,
  job_template: RESOURCE_TYPE.job,
  project: RESOURCE_TYPE.project_update,
  project_update: RESOURCE_TYPE.project_update,
  system_job: RESOURCE_TYPE.system_job,
  terraform: RESOURCE_TYPE.terraform_job,
  terraform_job: RESOURCE_TYPE.terraform_job,
  terraform_job_template: RESOURCE_TYPE.terraform_job,
  workflow: RESOURCE_TYPE.workflow_job,
  workflow_job: RESOURCE_TYPE.workflow_job,
  workflow_job_template: RESOURCE_TYPE.workflow_job,
  workflow_approval: RESOURCE_TYPE.workflow_approval,
};

const templateTypeMap: Record<string, UnifiedJobType> = {
  inventory_source: RESOURCE_TYPE.inventory_update,
  job_template: RESOURCE_TYPE.job,
  project: RESOURCE_TYPE.project_update,
  system_job_template: RESOURCE_TYPE.system_job,
  terraform_job_template: RESOURCE_TYPE.terraform_job,
  workflow_job_template: RESOURCE_TYPE.workflow_job,
};

function normalizeNodeType(type: AIWorkflowPlanNodeType | string | undefined) {
  return typeAliases[String(type ?? '').toLowerCase()] ?? null;
}

function inferTemplateNodeType(template: UnifiedJobTemplateSummary): UnifiedJobType | null {
  if (template.unified_job_type) return template.unified_job_type;
  return templateTypeMap[String(template.type ?? '').toLowerCase()] ?? null;
}

function normalizeKey(value: string | undefined, fallback: string) {
  return (value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
}

function normalizeEdgeStatus(status: string | undefined, fallback: string | undefined) {
  const value = String(status || fallback || 'success').toLowerCase();
  if (value === 'failure' || value === 'fail' || value === 'danger') return EdgeStatus.danger;
  if (value === 'always' || value === 'info' || value === 'root') return EdgeStatus.info;
  return EdgeStatus.success;
}

function extractWorkflowPlan(raw: string): AIWorkflowPlan {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced?.[1] ?? raw;
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('AI response did not include a JSON workflow plan.');
  }

  const parsed = JSON.parse(source.slice(start, end + 1)) as AIWorkflowPlan;
  if (!Array.isArray(parsed.nodes) || parsed.nodes.length === 0) {
    throw new Error('AI workflow plan must include at least one node.');
  }

  return {
    ...parsed,
    nodes: parsed.nodes.slice(0, 8),
    edges: Array.isArray(parsed.edges) ? parsed.edges : undefined,
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
  };
}

function resolveWorkflowPlan(
  plan: AIWorkflowPlan,
  templates: UnifiedJobTemplateSummary[]
): ResolvedWorkflowPlan {
  const nodeKeys = new Map<AIWorkflowPlanNode, string>();
  const keySet = new Set<string>();

  const nodes = plan.nodes.map((planNode, index) => {
    let key = normalizeKey(planNode.id, `step-${index + 1}`);
    while (keySet.has(key)) key = `${key}-${index + 1}`;
    keySet.add(key);
    nodeKeys.set(planNode, key);

    const nodeType = normalizeNodeType(planNode.type);
    if (!nodeType) {
      return {
        planNode,
        key,
        nodeType,
        valid: false,
        error: `Unknown node type: ${planNode.type}`,
      };
    }

    if (nodeType === 'eda_rulebook' || nodeType === 'ai_task') {
      return {
        planNode,
        key,
        nodeType,
        valid: false,
        error: `${nodeType} nodes are preview-only until AWX workflow persistence supports them.`,
      };
    }

    if (nodeType === RESOURCE_TYPE.workflow_approval) {
      return { planNode, key, nodeType, valid: true };
    }

    const template = templates.find((candidate) => {
      const candidateType = inferTemplateNodeType(candidate);
      if (candidateType !== nodeType) return false;
      if (planNode.template_id && candidate.id === planNode.template_id) return true;
      if (planNode.template_name) {
        return candidate.name.toLowerCase() === planNode.template_name.toLowerCase();
      }
      return candidate.name.toLowerCase() === planNode.name.toLowerCase();
    });

    if (!template) {
      return {
        planNode,
        key,
        nodeType,
        valid: false,
        error: `No matching ${nodeType} template found for "${planNode.template_name || planNode.name}".`,
      };
    }

    return { planNode, key, nodeType, template, valid: true };
  });

  const validKeys = new Set(nodes.map((node) => node.key));
  const edges =
    plan.edges && plan.edges.length > 0
      ? plan.edges.map((edge) => ({
          source: normalizeKey(edge.source, ''),
          target: normalizeKey(edge.target, ''),
          status: normalizeEdgeStatus(edge.status, undefined),
          valid:
            validKeys.has(normalizeKey(edge.source, '')) &&
            validKeys.has(normalizeKey(edge.target, '')),
          error: 'Edge references an unknown node.',
        }))
      : nodes.flatMap((node, index) => {
          const after = node.planNode.after;
          const parents = Array.isArray(after) ? after : after ? [after] : [];
          if (node.planNode.run === 'root') return [];
          if (parents.length === 0 && index > 0) {
            parents.push(nodes[index - 1].key);
          }
          return parents.map((parent) => {
            const source = normalizeKey(parent, '');
            return {
              source,
              target: node.key,
              status: normalizeEdgeStatus(undefined, node.planNode.run),
              valid: validKeys.has(source),
              error: 'Edge references an unknown parent node.',
            };
          });
        });

  const normalizedEdges = edges
    .filter((edge) => edge.source && edge.target && edge.source !== edge.target)
    .map((edge) => ({ ...edge, error: edge.valid ? undefined : edge.error }));
  const errors = [
    ...nodes.flatMap((node) => (node.error ? [node.error] : [])),
    ...normalizedEdges.flatMap((edge) => (edge.error ? [edge.error] : [])),
  ];

  return {
    plan,
    nodes,
    edges: normalizedEdges,
    canApply: errors.length === 0 && nodes.length > 0,
    errors,
  };
}

function createEmptyPromptValues(): PromptFormValues {
  return {
    credentials: [],
    diff_mode: false,
    execution_environment: null,
    extra_vars: '',
    forks: 0,
    instance_groups: [],
    inventory: null,
    job_slice_count: 1,
    job_tags: [],
    job_type: '',
    labels: [],
    limit: '',
    scm_branch: '',
    skip_tags: [],
    timeout: 0,
    verbosity: 0,
  };
}

export function AIWorkflowSuggester() {
  const { t } = useTranslation();
  const { enabled: aiEnabled } = useAIAssistantEnabled();
  const controller = useVisualizationController();
  const createEdge = useCreateEdge();
  const [isOpen, setIsOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [resolvedPlan, setResolvedPlan] = useState<ResolvedWorkflowPlan | null>(null);
  const [rawSuggestion, setRawSuggestion] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [didApply, setDidApply] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const existingNodes = useMemo(
    () =>
      controller
        .getGraph()
        .getNodes()
        .filter((node) => node.isVisible() && node.getId() !== START_NODE_ID)
        .map((node) => node.getLabel()),
    [controller]
  );

  if (!aiEnabled) return null;

  const fetchTemplates = async () => {
    const response = await requestGet<AwxItemsResponse<UnifiedJobTemplateSummary>>(
      awxAPI`/unified_job_templates/?page_size=200&order_by=name`
    );
    return response.results;
  };

  const handleGenerate = async () => {
    if (!description.trim()) return;
    setIsLoading(true);
    setDidApply(false);
    setError(null);
    setResolvedPlan(null);
    setRawSuggestion('');
    try {
      const templates = await fetchTemplates();
      const templateContext = templates
        .map((template) => {
          const nodeType = inferTemplateNodeType(template);
          return `${template.id}: ${template.name} [${nodeType || template.type || 'unknown'}]`;
        })
        .join('\n');
      const state = controller.getState<ControllerState>();
      const resp = await postRequest<
        AIChatResponse,
        { messages: { role: string; content: string }[]; system_override: string }
      >(awxAPI`/ai/chat/`, {
        messages: [
          {
            role: 'user',
            content: [
              `Workflow template: ${state.workflowTemplate?.name || 'current workflow'}`,
              `Existing visualizer nodes: ${existingNodes.join(', ') || 'none'}`,
              `Available AWX templates:\n${templateContext || 'none'}`,
              `User request:\n${description.trim()}`,
            ].join('\n\n'),
          },
        ],
        system_override: SYSTEM_PROMPT,
      });
      setRawSuggestion(resp.message.content);
      setResolvedPlan(resolveWorkflowPlan(extractWorkflowPlan(resp.message.content), templates));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('Failed to generate workflow plan.');
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleApply = () => {
    if (!resolvedPlan?.canApply) return;

    const state = controller.getState<ControllerState>();
    const model = controller.toModel();
    const currentNodes = controller
      .getGraph()
      .getNodes()
      .filter((node) => node.getId() !== START_NODE_ID);
    const firstNewIndex = currentNodes.length + 1;
    const idMap = new Map<string, string>();

    model.nodes ??= [];
    model.edges ??= [];

    resolvedPlan.nodes.forEach((node, index) => {
      if (!node.valid || !node.nodeType) return;
      const nodeId = `${firstNewIndex + index}-ai-unsavedNode`;
      idMap.set(node.key, nodeId);
      const nodeName = node.planNode.name || node.template?.name || t('AI workflow node');
      const nodeDescription = node.planNode.description || node.template?.description || '';
      const nodeType = node.nodeType as UnifiedJobType;
      const isApproval = nodeType === RESOURCE_TYPE.workflow_approval;
      const nodeToCreate = {
        id: nodeId,
        type: 'node',
        label: nodeName,
        width: NODE_DIAMETER,
        height: NODE_DIAMETER,
        shape: NodeShape.circle,
        labelPosition: LabelPosition.bottom,
        data: {
          resource: {
            always_nodes: [],
            failure_nodes: [],
            success_nodes: [],
            identifier: nodeName,
            all_parents_must_converge: node.planNode.convergence === 'all',
            summary_fields: {
              unified_job_template: {
                id: isApproval ? -1 : Number(node.template?.id || 0),
                name: nodeName,
                description: nodeDescription,
                unified_job_type: nodeType,
                timeout: isApproval ? node.planNode.approval_timeout || 0 : undefined,
              },
            },
          },
          launch_data: createEmptyPromptValues(),
          survey_data: {},
        },
      };
      model.nodes?.push(nodeToCreate);
    });

    const targetsWithParents = new Set<string>();
    resolvedPlan.edges.forEach((edge) => {
      const source = idMap.get(edge.source);
      const target = idMap.get(edge.target);
      if (!source || !target) return;
      targetsWithParents.add(target);
      model.edges?.push(createEdge(source, target, edge.status));
    });

    idMap.forEach((nodeId) => {
      if (!targetsWithParents.has(nodeId)) {
        model.edges?.push(createEdge(START_NODE_ID, nodeId, EdgeStatus.info));
      }
    });

    controller.fromModel(model, true);
    idMap.forEach((nodeId) => controller.getNodeById(nodeId)?.setState({ modified: true }));
    controller.setState({ ...state, modified: true });
    controller.getGraph().layout();
    setDidApply(true);
  };

  const handleClose = () => {
    setIsOpen(false);
    setDescription('');
    setResolvedPlan(null);
    setRawSuggestion('');
    setDidApply(false);
    setError(null);
  };

  return (
    <>
      <Button
        variant="secondary"
        icon={<MagicIcon />}
        onClick={() => setIsOpen(true)}
        size="sm"
        data-cy="ai-workflow-suggest"
      >
        {t('AI Suggest')}
      </Button>

      <Modal
        variant={ModalVariant.large}
        title={t('AI Workflow Plan')}
        isOpen={isOpen}
        onClose={handleClose}
        actions={[
          <Button
            key="generate"
            variant="primary"
            onClick={() => void handleGenerate()}
            isDisabled={!description.trim() || isLoading}
            data-cy="ai-workflow-generate"
          >
            {isLoading ? <Spinner size="sm" /> : t('Preview plan')}
          </Button>,
          <Button
            key="apply"
            variant="secondary"
            onClick={handleApply}
            isDisabled={!resolvedPlan?.canApply || isLoading || didApply}
            data-cy="ai-workflow-apply"
          >
            {didApply ? t('Applied') : t('Apply to visualizer')}
          </Button>,
          <Button key="close" variant="link" onClick={handleClose}>
            {t('Close')}
          </Button>,
        ]}
      >
        <Stack hasGutter>
          <StackItem>
            <FormGroup
              label={t('What do you want to automate?')}
              fieldId="ai-workflow-description"
              isRequired
            >
              <TextArea
                id="ai-workflow-description"
                data-cy="ai-workflow-description"
                aria-label={t('Workflow description')}
                value={description}
                onChange={(_e, value) => setDescription(value)}
                rows={4}
                placeholder={t('Describe a multi-step AWX workflow goal…')}
                onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                    void handleGenerate();
                  }
                }}
              />
            </FormGroup>
          </StackItem>

          {error && (
            <StackItem>
              <Alert isInline variant="danger" title={error} />
            </StackItem>
          )}

          {didApply && (
            <StackItem>
              <Alert
                isInline
                variant="success"
                title={t('Plan added to the visualizer. Review the graph, then save the workflow.')}
              />
            </StackItem>
          )}

          {isLoading && (
            <StackItem>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Spinner size="md" />
                <span>{t('Planning workflow…')}</span>
              </div>
            </StackItem>
          )}

          {resolvedPlan && (
            <StackItem data-cy="ai-workflow-plan-preview">
              <TextContent style={{ marginBottom: 8 }}>
                <Text component={TextVariants.h4}>
                  {resolvedPlan.plan.name || t('Workflow plan')}
                </Text>
                {resolvedPlan.plan.summary && (
                  <Text component={TextVariants.p}>{resolvedPlan.plan.summary}</Text>
                )}
              </TextContent>
              <Stack hasGutter>
                {resolvedPlan.nodes.map((node) => (
                  <StackItem key={node.key}>
                    <div
                      style={{
                        border: '1px solid var(--pf-v5-global--BorderColor--100)',
                        borderRadius: 4,
                        padding: 10,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <Text component={TextVariants.small} style={{ fontWeight: 600 }}>
                          {node.planNode.name}
                        </Text>
                        <Badge isRead>{node.valid ? t('Ready') : t('Blocked')}</Badge>
                      </div>
                      <Text component={TextVariants.small}>
                        {node.nodeType || node.planNode.type}
                        {node.template ? ` · ${node.template.name} #${node.template.id}` : ''}
                      </Text>
                      {node.planNode.description && (
                        <Text component={TextVariants.small} style={{ display: 'block' }}>
                          {node.planNode.description}
                        </Text>
                      )}
                      {node.error && (
                        <Alert
                          isInline
                          variant="warning"
                          title={node.error}
                          style={{ marginTop: 8 }}
                        />
                      )}
                    </div>
                  </StackItem>
                ))}
              </Stack>
              {resolvedPlan.edges.length > 0 && (
                <TextContent style={{ marginTop: 10 }}>
                  <Text component={TextVariants.small}>
                    {t('{{count}} planned links', { count: resolvedPlan.edges.length })}
                  </Text>
                </TextContent>
              )}
              {resolvedPlan.errors.length > 0 && (
                <Alert
                  isInline
                  variant="warning"
                  title={t('Resolve blocked nodes before applying this plan.')}
                  style={{ marginTop: 10 }}
                />
              )}
              {rawSuggestion && (
                <CodeBlock style={{ marginTop: 10 }}>
                  <CodeBlockCode
                    style={{ maxHeight: 180, overflow: 'auto', whiteSpace: 'pre-wrap' }}
                  >
                    {rawSuggestion}
                  </CodeBlockCode>
                </CodeBlock>
              )}
            </StackItem>
          )}
        </Stack>
      </Modal>
    </>
  );
}
