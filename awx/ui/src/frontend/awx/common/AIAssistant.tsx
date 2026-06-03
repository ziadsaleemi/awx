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

type AssistantBusyState = 'chat' | 'plan' | 'apply' | null;

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
