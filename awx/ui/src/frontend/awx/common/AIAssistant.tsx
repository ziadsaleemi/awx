import {
  ActionGroup,
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
import remarkGfm from 'remark-gfm';
import styled from 'styled-components';
import { postRequest, requestGet } from '../../common/crud/Data';
import { awxAPI } from './api/awx-utils';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    const userMsg: ChatMessage = { role: 'user', content: trimmed };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);
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
      const msg = err instanceof Error ? err.message : t('An unexpected error occurred.');
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, t]);

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
        width: 'min(420px, calc(100vw - 24px))',
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
          {messages.length === 0 && !loading && (
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
                <AssistantMarkdown className="pf-v5-c-content">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                </AssistantMarkdown>
              ) : (
                msg.content
              )}
            </div>
          ))}

          {loading && (
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
            isDisabled={loading}
            style={{ fontSize: 14 }}
          />
          <ActionGroup style={{ margin: 0 }}>
            <Button
              variant="primary"
              isDisabled={!input.trim() || loading}
              onClick={() => void sendMessage()}
              isLoading={loading}
            >
              {t('Send')}
            </Button>
            {messages.length > 0 && (
              <Button
                variant="link"
                onClick={() => {
                  setMessages([]);
                  setError(null);
                }}
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
