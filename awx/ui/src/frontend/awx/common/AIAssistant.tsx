import {
  ActionGroup,
  Alert,
  Badge,
  Button,
  Icon,
  Spinner,
  Text,
  TextArea,
  TextContent,
  TextVariants,
} from '@patternfly/react-core';
import { RobotIcon, TimesIcon } from '@patternfly/react-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import { Link } from 'react-router-dom';
import remarkGfm from 'remark-gfm';
import styled from 'styled-components';
import { useGetPageUrl } from '../../../framework';
import { postRequest, requestGet } from '../../common/crud/Data';
import { AwxRoute } from '../main/AwxRoutes';
import { awxAPI } from './api/awx-utils';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export const AI_ASSISTANT_CONTEXT_EVENT = 'awx-ai-assistant-context';

export interface AIAssistantContextPayload {
  prompt?: string;
  source?: string;
  page_kind?: string;
  page_label?: string;
  resource_id?: string;
  [key: string]: unknown;
}

interface AISettingsResponse {
  enabled: boolean;
  provider: string;
  model: string;
  configured: boolean;
}

interface AIChatResponse {
  message: ChatMessage;
  model: string;
  provider: string;
}

interface AIResourceOperation {
  id: string;
  operation: string;
  resource_type: string;
  valid: boolean;
  errors: Record<string, unknown>;
  warnings?: string[];
  data?: Record<string, unknown>;
  validated_data?: Record<string, unknown>;
  preview?: Record<string, unknown>;
  object_id?: number;
  object?: Record<string, unknown>;
}

interface AIResourceDetailLink {
  route: AwxRoute;
  params: Record<string, string | number | undefined>;
  label: string;
}

interface AIResourcePreviewSummary {
  label: string;
  value: string;
}

interface AIResourceActionResponse {
  mode: 'preview' | 'apply';
  generated: boolean;
  plan: {
    name?: string;
    description?: string;
    operations: Record<string, unknown>[];
  };
  rollback_plan?: {
    name?: string;
    description?: string;
    operations: Record<string, unknown>[];
  };
  operations: AIResourceOperation[];
  can_apply: boolean;
  audit?: {
    activity_stream_id?: number;
  };
}

type AssistantBusyState = 'chat' | 'plan' | 'apply' | 'rollback' | null;

const AssistantMarkdown = styled.div`
  p,
  ul,
  ol,
  pre,
  blockquote {
    margin-block-start: 0;
    margin-block-end: 0.5rem;
  }

  p:last-child,
  ul:last-child,
  ol:last-child,
  pre:last-child,
  blockquote:last-child {
    margin-block-end: 0;
  }

  ul,
  ol {
    padding-inline-start: 1.25rem;
  }

  code {
    background: var(--pf-v5-global--BackgroundColor--300);
    border-radius: 3px;
    padding: 1px 4px;
  }

  pre {
    background: var(--pf-v5-global--BackgroundColor--300);
    border-radius: 4px;
    overflow-x: auto;
    padding: 8px;
    white-space: pre-wrap;
  }

  pre code {
    background: transparent;
    padding: 0;
  }

  a {
    color: var(--pf-v5-global--link--Color);
  }
`;

function messageFromError(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  return fallback;
}

export function openAIAssistantWithContext(context: AIAssistantContextPayload) {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<AIAssistantContextPayload>(AI_ASSISTANT_CONTEXT_EVENT, { detail: context })
  );
}

function buildRouteContext(context?: Record<string, unknown> | null) {
  if (typeof window === 'undefined') {
    return context ?? {};
  }
  return {
    ...(context ?? {}),
    path: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
    title: document.title,
  };
}

function formatLabel(value: string) {
  return value.replaceAll('_', ' ');
}

function valueAsNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function valueAsString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function valueAsStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function previewRows(value: unknown) {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> => typeof item === 'object' && item !== null
      )
    : [];
}

function previewCount(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function previewNameSummary(rows: Record<string, unknown>[]) {
  const names = rows
    .map((row) => valueAsString(row.name))
    .filter((name): name is string => Boolean(name))
    .slice(0, 3);
  return names.length ? ` (${names.join(', ')})` : '';
}

function previewCountSummary(preview: Record<string, unknown>, countKey: string, rowsKey: string) {
  const rows = previewRows(preview[rowsKey]);
  return `${previewCount(preview[countKey], rows.length)}${previewNameSummary(rows)}`;
}

function inventoryKindToPath(kind?: string, resourceType?: string) {
  if (kind === 'smart' || resourceType === 'smart_inventory') return 'smart_inventory';
  if (kind === 'constructed' || resourceType === 'constructed_inventory') {
    return 'constructed_inventory';
  }
  return 'inventory';
}

function getAIResourceDetailLink(operation: AIResourceOperation): AIResourceDetailLink | null {
  const object = operation.object ?? {};
  const id = operation.object_id ?? valueAsNumber(object.id);
  if (!id || operation.operation === 'delete') return null;

  const name = valueAsString(object.name);
  const label = name ? `View ${name}` : 'View resource';

  if (
    operation.resource_type === 'inventory' ||
    operation.resource_type === 'smart_inventory' ||
    operation.resource_type === 'constructed_inventory'
  ) {
    return {
      route: AwxRoute.InventoryDetails,
      params: {
        id,
        inventory_type: inventoryKindToPath(valueAsString(object.kind), operation.resource_type),
      },
      label,
    };
  }

  if (operation.resource_type === 'project') {
    return { route: AwxRoute.ProjectDetails, params: { id }, label };
  }

  if (operation.resource_type === 'job_template') {
    return { route: AwxRoute.JobTemplateDetails, params: { id }, label };
  }

  if (operation.resource_type === 'workflow_job_template') {
    return { route: AwxRoute.WorkflowJobTemplateDetails, params: { id }, label };
  }

  if (operation.resource_type === 'host') {
    return { route: AwxRoute.HostDetails, params: { id }, label };
  }

  if (operation.resource_type === 'catalog_item') {
    return { route: AwxRoute.CatalogItemDetails, params: { id }, label };
  }

  return null;
}

function getAIResourceLaunchLink(operation: AIResourceOperation): AIResourceDetailLink | null {
  const object = operation.object ?? {};
  const id = operation.object_id ?? valueAsNumber(object.id);
  if (!id || operation.operation === 'delete') return null;

  if (operation.resource_type === 'job_template') {
    return {
      route: AwxRoute.TemplateLaunchWizard,
      params: { id },
      label: 'Launch job template',
    };
  }

  if (operation.resource_type === 'workflow_job_template') {
    return {
      route: AwxRoute.WorkflowJobTemplateLaunchWizard,
      params: { id },
      label: 'Launch workflow template',
    };
  }

  return null;
}

function getAIResourcePreviewSummary(operation: AIResourceOperation): AIResourcePreviewSummary[] {
  const preview = operation.preview;
  if (!preview) return [];

  if (preview.type === 'smart_inventory') {
    return [
      {
        label: 'Matched hosts',
        value: previewCountSummary(preview, 'matched_hosts_count', 'matched_hosts'),
      },
      {
        label: 'Matched groups',
        value: previewCountSummary(preview, 'matched_groups_count', 'matched_groups'),
      },
    ];
  }

  if (preview.type === 'constructed_inventory') {
    const sourceVarsKeys = valueAsStringArray(preview.source_vars_keys);
    return [
      {
        label: 'Input inventories',
        value: previewCountSummary(preview, 'input_inventories_count', 'input_inventories'),
      },
      {
        label: 'Source hosts',
        value: previewCountSummary(preview, 'source_hosts_count', 'source_hosts'),
      },
      {
        label: 'Source groups',
        value: previewCountSummary(preview, 'source_groups_count', 'source_groups'),
      },
      ...(sourceVarsKeys.length
        ? [
            {
              label: 'Source vars keys',
              value: sourceVarsKeys.join(', '),
            },
          ]
        : []),
    ];
  }

  return [];
}

function errorSummary(errors: Record<string, unknown>) {
  return Object.entries(errors)
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return `${key}: ${value.join(', ')}`;
      }
      if (typeof value === 'object' && value !== null) {
        return `${key}: ${JSON.stringify(value)}`;
      }
      return `${key}: ${String(value)}`;
    })
    .join('\n');
}

export function useAIAssistantEnabled() {
  const [enabled, setEnabled] = useState(false);
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    requestGet<AISettingsResponse>(awxAPI`/ai/settings/`)
      .then((data) => {
        setEnabled(data.enabled);
        setConfigured(data.configured);
      })
      .catch(() => {
        // silently fail — AI is not available
      });
  }, []);

  return { enabled, configured };
}

interface AIAssistantPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AIAssistantPanel({ isOpen, onClose }: AIAssistantPanelProps) {
  const { t } = useTranslation();
  const getPageUrl = useGetPageUrl();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState<AssistantBusyState>(null);
  const [error, setError] = useState<string | null>(null);
  const [resourcePlan, setResourcePlan] = useState<AIResourceActionResponse | null>(null);
  const [context, setContext] = useState<Record<string, unknown> | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy, resourcePlan]);

  useEffect(() => {
    const handleContextOpen = (event: Event) => {
      const detail = (event as CustomEvent<AIAssistantContextPayload>).detail ?? {};
      const { prompt, ...nextContext } = detail;
      setContext(nextContext);
      setError(null);
      setResourcePlan(null);
      if (typeof prompt === 'string') {
        setInput(prompt);
      }
    };

    window.addEventListener(AI_ASSISTANT_CONTEXT_EVENT, handleContextOpen);
    return () => window.removeEventListener(AI_ASSISTANT_CONTEXT_EVENT, handleContextOpen);
  }, []);

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || busy) return;

    const userMsg: ChatMessage = { role: 'user', content: trimmed };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput('');
    setBusy('chat');
    setError(null);

    try {
      const resp = await postRequest<AIChatResponse, { messages: ChatMessage[] }>(
        awxAPI`/ai/chat/`,
        {
          messages: nextMessages,
        }
      );
      setMessages((prev) => [...prev, resp.message]);
    } catch (err: unknown) {
      setError(messageFromError(err, t('An unexpected error occurred.')));
    } finally {
      setBusy(null);
    }
  }, [busy, input, messages, t]);

  const planResourceChanges = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || busy) return;

    setInput('');
    setBusy('plan');
    setError(null);
    setResourcePlan(null);

    try {
      const resp = await postRequest<
        AIResourceActionResponse,
        { mode: 'preview'; prompt: string; context: Record<string, unknown> }
      >(awxAPI`/ai/resource_actions/`, {
        mode: 'preview',
        prompt: trimmed,
        context: buildRouteContext(context),
      });
      setResourcePlan(resp);
    } catch (err: unknown) {
      setError(messageFromError(err, t('Failed to plan resource changes.')));
    } finally {
      setBusy(null);
    }
  }, [busy, context, input, t]);

  const applyResourcePlan = useCallback(async () => {
    if (!resourcePlan || !resourcePlan.can_apply || busy) return;

    setBusy('apply');
    setError(null);

    try {
      const resp = await postRequest<
        AIResourceActionResponse,
        {
          mode: 'apply';
          plan: AIResourceActionResponse['plan'];
          context: Record<string, unknown>;
        }
      >(awxAPI`/ai/resource_actions/`, {
        mode: 'apply',
        plan: resourcePlan.plan,
        context: buildRouteContext(context),
      });
      setResourcePlan(resp);
    } catch (err: unknown) {
      setError(messageFromError(err, t('Failed to apply resource changes.')));
    } finally {
      setBusy(null);
    }
  }, [busy, context, resourcePlan, t]);

  const applyRollbackPlan = useCallback(async () => {
    if (!resourcePlan?.rollback_plan?.operations?.length || busy) {
      return;
    }

    setBusy('rollback');
    setError(null);

    try {
      const resp = await postRequest<
        AIResourceActionResponse,
        {
          mode: 'apply';
          plan: NonNullable<AIResourceActionResponse['rollback_plan']>;
          context: Record<string, unknown>;
        }
      >(awxAPI`/ai/resource_actions/`, {
        mode: 'apply',
        plan: resourcePlan.rollback_plan,
        context: buildRouteContext({
          ...(context ?? {}),
          source: 'ai_assistant_rollback',
          rollback_for_activity_stream_id: resourcePlan.audit?.activity_stream_id,
        }),
      });
      setResourcePlan(resp);
    } catch (err: unknown) {
      setError(messageFromError(err, t('Failed to apply rollback plan.')));
    } finally {
      setBusy(null);
    }
  }, [busy, context, resourcePlan, t]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void sendMessage();
      }
    },
    [sendMessage]
  );

  if (!isOpen) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-label={t('AI Assistant')}
      aria-modal="false"
      style={{
        position: 'fixed',
        top: 72,
        right: 0,
        bottom: 0,
        width: 'min(640px, calc(100vw - 24px))',
        zIndex: 600,
        backgroundColor: 'var(--pf-v5-global--BackgroundColor--100)',
        borderLeft: '1px solid var(--pf-v5-global--BorderColor--100)',
        boxShadow: 'var(--pf-v5-global--BoxShadow--lg)',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          padding: '16px',
          gap: '12px',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <TextContent>
            <Text component={TextVariants.h3} style={{ margin: 0 }}>
              <Icon style={{ marginRight: 8 }}>
                <RobotIcon />
              </Icon>
              {t('AI Assistant')}
            </Text>
          </TextContent>
          <Button variant="plain" aria-label={t('Close AI Assistant')} onClick={onClose}>
            <TimesIcon />
          </Button>
        </div>

        {/* Message history */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          {messages.length === 0 && !busy && !resourcePlan && (
            <TextContent style={{ color: 'var(--pf-v5-global--Color--200)', marginTop: 16 }}>
              <Text component={TextVariants.small}>
                {t(
                  'Ask anything about AWX — job templates, inventories, Terraform, catalog items, and more.'
                )}
              </Text>
            </TextContent>
          )}

          {messages.map((msg, idx) => (
            <div
              key={idx}
              data-cy={`ai-assistant-message-${msg.role}`}
              style={{
                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                background:
                  msg.role === 'user'
                    ? 'var(--pf-v5-global--primary-color--100)'
                    : 'var(--pf-v5-global--BackgroundColor--200)',
                color: msg.role === 'user' ? '#fff' : 'inherit',
                borderRadius: 8,
                padding: '8px 12px',
                whiteSpace: msg.role === 'user' ? 'pre-wrap' : 'normal',
                wordBreak: 'break-word',
                fontSize: 14,
              }}
            >
              {msg.role === 'assistant' ? (
                <AssistantMarkdown className="pf-v5-c-content" data-cy="ai-assistant-markdown">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                </AssistantMarkdown>
              ) : (
                msg.content
              )}
            </div>
          ))}

          {resourcePlan && (
            <div
              style={{
                alignSelf: 'stretch',
                border: '1px solid var(--pf-v5-global--BorderColor--100)',
                borderRadius: 6,
                background: 'var(--pf-v5-global--BackgroundColor--200)',
                padding: 12,
              }}
              data-cy="ai-resource-plan"
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  marginBottom: 10,
                }}
              >
                <TextContent>
                  <Text component={TextVariants.h4} style={{ margin: 0 }}>
                    {resourcePlan.plan.name || t('Resource plan')}
                  </Text>
                  {resourcePlan.plan.description ? (
                    <Text component={TextVariants.small}>{resourcePlan.plan.description}</Text>
                  ) : null}
                </TextContent>
                <Badge
                  isRead
                  style={{
                    background:
                      resourcePlan.mode === 'apply'
                        ? 'var(--pf-v5-global--success-color--100)'
                        : undefined,
                    color: resourcePlan.mode === 'apply' ? '#fff' : undefined,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {resourcePlan.mode === 'apply' ? t('Applied') : t('Preview')}
                </Badge>
              </div>

              {resourcePlan.audit?.activity_stream_id ? (
                <div style={{ marginBottom: 10 }}>
                  <Link
                    to={getPageUrl(AwxRoute.ActivityStream, {
                      query: { id: resourcePlan.audit.activity_stream_id },
                    })}
                    data-cy="ai-resource-audit-link"
                  >
                    {t('View Activity Stream #{{id}}', {
                      id: resourcePlan.audit.activity_stream_id,
                    })}
                  </Link>
                </div>
              ) : null}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {resourcePlan.operations.map((operation) => (
                  <div key={operation.id}>
                    <div
                      key={operation.id}
                      style={{
                        border: '1px solid var(--pf-v5-global--BorderColor--100)',
                        borderRadius: 4,
                        background: 'var(--pf-v5-global--BackgroundColor--100)',
                        padding: 10,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                          marginBottom: operation.valid ? 6 : 8,
                        }}
                      >
                        <Text component={TextVariants.small} style={{ fontWeight: 600 }}>
                          {formatLabel(operation.operation)} {formatLabel(operation.resource_type)}
                          {operation.object_id ? ` #${operation.object_id}` : ''}
                        </Text>
                        <Badge isRead>{operation.valid ? t('Valid') : t('Blocked')}</Badge>
                      </div>
                      {operation.valid ? (
                        <>
                          {(() => {
                            const detailLink = getAIResourceDetailLink(operation);
                            if (!detailLink) return null;
                            return (
                              <Text
                                component={TextVariants.small}
                                style={{ display: 'block', marginBottom: 6 }}
                              >
                                <Link
                                  to={getPageUrl(detailLink.route, {
                                    params: detailLink.params,
                                  })}
                                  data-cy={`ai-resource-object-link-${operation.id}`}
                                >
                                  {detailLink.label}
                                </Link>
                              </Text>
                            );
                          })()}
                          {(() => {
                            const launchLink = getAIResourceLaunchLink(operation);
                            if (!launchLink) return null;
                            return (
                              <Text
                                component={TextVariants.small}
                                style={{ display: 'block', marginBottom: 6 }}
                              >
                                <Link
                                  to={getPageUrl(launchLink.route, {
                                    params: launchLink.params,
                                  })}
                                  data-cy={`ai-resource-launch-link-${operation.id}`}
                                >
                                  {t(launchLink.label)}
                                </Link>
                              </Text>
                            );
                          })()}
                          <pre
                            style={{
                              margin: 0,
                              maxHeight: 160,
                              overflow: 'auto',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                              fontSize: 12,
                              background: 'var(--pf-v5-global--BackgroundColor--300)',
                              padding: 8,
                              borderRadius: 4,
                            }}
                          >
                            {JSON.stringify(
                              operation.object ?? operation.validated_data ?? operation.data,
                              null,
                              2
                            )}
                          </pre>
                          {operation.preview ? (
                            <>
                              <Text
                                component={TextVariants.small}
                                style={{ display: 'block', fontWeight: 600, marginTop: 8 }}
                              >
                                {t('Preview details')}
                              </Text>
                              {getAIResourcePreviewSummary(operation).length ? (
                                <div
                                  data-cy={`ai-resource-preview-summary-${operation.id}`}
                                  style={{ margin: '4px 0 0' }}
                                >
                                  {getAIResourcePreviewSummary(operation).map((summary) => (
                                    <Text
                                      key={summary.label}
                                      component={TextVariants.small}
                                      style={{ display: 'block' }}
                                    >
                                      {t(summary.label)}: {summary.value}
                                    </Text>
                                  ))}
                                </div>
                              ) : null}
                              <pre
                                style={{
                                  margin: '4px 0 0',
                                  maxHeight: 180,
                                  overflow: 'auto',
                                  whiteSpace: 'pre-wrap',
                                  wordBreak: 'break-word',
                                  fontSize: 12,
                                  background: 'var(--pf-v5-global--BackgroundColor--300)',
                                  padding: 8,
                                  borderRadius: 4,
                                }}
                              >
                                {JSON.stringify(operation.preview, null, 2)}
                              </pre>
                            </>
                          ) : null}
                        </>
                      ) : (
                        <Alert isInline variant="danger" title={t('Operation cannot be applied')}>
                          <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                            {errorSummary(operation.errors)}
                          </pre>
                        </Alert>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {resourcePlan.rollback_plan?.operations?.length ? (
                <div
                  style={{
                    border: '1px solid var(--pf-v5-global--BorderColor--100)',
                    borderRadius: 4,
                    background: 'var(--pf-v5-global--BackgroundColor--100)',
                    padding: 10,
                    marginTop: 10,
                  }}
                  data-cy="ai-resource-rollback-plan"
                >
                  <Text
                    component={TextVariants.small}
                    style={{ display: 'block', fontWeight: 600 }}
                  >
                    {t('Rollback plan')}
                  </Text>
                  {resourcePlan.rollback_plan.description ? (
                    <Text component={TextVariants.small} style={{ display: 'block', marginTop: 2 }}>
                      {resourcePlan.rollback_plan.description}
                    </Text>
                  ) : null}
                  <pre
                    style={{
                      margin: '6px 0 0',
                      maxHeight: 180,
                      overflow: 'auto',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      fontSize: 12,
                      background: 'var(--pf-v5-global--BackgroundColor--300)',
                      padding: 8,
                      borderRadius: 4,
                    }}
                  >
                    {JSON.stringify(resourcePlan.rollback_plan, null, 2)}
                  </pre>
                </div>
              ) : null}

              <ActionGroup style={{ marginTop: 12, marginBottom: 0 }}>
                {resourcePlan.mode === 'preview' ? (
                  <Button
                    variant="primary"
                    onClick={() => void applyResourcePlan()}
                    isDisabled={!resourcePlan.can_apply || busy !== null}
                    isLoading={busy === 'apply'}
                    data-cy="ai-resource-plan-apply"
                  >
                    {t('Apply changes')}
                  </Button>
                ) : null}
                {resourcePlan.rollback_plan?.operations?.length ? (
                  <Button
                    variant="danger"
                    onClick={() => void applyRollbackPlan()}
                    isDisabled={busy !== null}
                    isLoading={busy === 'rollback'}
                    data-cy="ai-resource-plan-rollback"
                  >
                    {t('Apply rollback')}
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
                  onClick={() => setResourcePlan(null)}
                  isDisabled={busy !== null}
                >
                  {t('Dismiss')}
                </Button>
              </ActionGroup>
            </div>
          )}

          {busy && (
            <div style={{ alignSelf: 'flex-start', padding: '8px 12px' }}>
              <Spinner size="md" />
            </div>
          )}

          {error && (
            <div
              style={{
                alignSelf: 'flex-start',
                maxWidth: '85%',
                background: 'var(--pf-v5-global--danger-color--100)',
                color: '#fff',
                borderRadius: 8,
                padding: '8px 12px',
                fontSize: 14,
              }}
            >
              {error}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input area */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <TextArea
            aria-label={t('Message')}
            placeholder={t('Type a message… (Enter to send, Shift+Enter for new line)')}
            value={input}
            onChange={(_e, val) => setInput(val)}
            onKeyDown={handleKeyDown}
            rows={3}
            resizeOrientation="vertical"
            isDisabled={busy !== null}
            style={{ fontSize: 14 }}
          />
          <ActionGroup style={{ margin: 0 }}>
            <Button
              variant="primary"
              isDisabled={!input.trim() || busy !== null}
              onClick={() => void sendMessage()}
              isLoading={busy === 'chat'}
            >
              {t('Send')}
            </Button>
            <Button
              variant="secondary"
              isDisabled={!input.trim() || busy !== null}
              onClick={() => void planResourceChanges()}
              isLoading={busy === 'plan'}
              data-cy="ai-resource-plan-button"
            >
              {t('Plan changes')}
            </Button>
            {messages.length > 0 && (
              <Button
                variant="link"
                onClick={() => {
                  setMessages([]);
                  setError(null);
                  setResourcePlan(null);
                }}
                isDisabled={busy !== null}
              >
                {t('Clear chat')}
              </Button>
            )}
          </ActionGroup>
        </div>
      </div>
    </div>
  );
}

interface AIAssistantButtonProps {
  onClick: () => void;
  isActive: boolean;
}

export function AIAssistantButton({ onClick, isActive }: AIAssistantButtonProps) {
  const { t } = useTranslation();
  return (
    <Button
      variant="plain"
      aria-label={t('AI Assistant')}
      title={t('AI Assistant')}
      onClick={onClick}
      style={{ color: isActive ? 'var(--pf-v5-global--primary-color--100)' : undefined }}
      data-cy="masthead-ai-assistant"
    >
      <RobotIcon />
    </Button>
  );
}
