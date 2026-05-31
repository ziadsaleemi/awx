/**
 * AICodeAssistant — inline AI suggestion widget for extra-vars and tfvars editors.
 *
 * Usage (as additionalControls on a PageFormDataEditor or PageFormTextArea):
 *
 *   <PageFormDataEditor
 *     name="extra_vars"
 *     ...
 *     additionalControls={
 *       <>
 *         <PageFormCheckbox ... />
 *         <AICodeAssistant fieldName="extra_vars" format="yaml" context="Ansible extra-vars" />
 *       </>
 *     }
 *   />
 */

import {
  Button,
  CodeBlock,
  CodeBlockCode,
  FormHelperText,
  FormGroup,
  HelperText,
  HelperTextItem,
  Modal,
  ModalVariant,
  Spinner,
  TextArea,
} from '@patternfly/react-core';
import { MagicIcon } from '@patternfly/react-icons';
import { useCallback, useState } from 'react';
import { FieldPath, FieldValues, useFormContext } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { postRequest } from '../../common/crud/Data';
import { awxAPI } from './api/awx-utils';
import { useAIAssistantEnabled } from './AIAssistant';

interface AIChatResponse {
  message: { role: string; content: string };
  model: string;
  provider: string;
}

interface AICodeAssistantProps<TFieldValues extends FieldValues = FieldValues> {
  /** The react-hook-form field name to populate with the generated content */
  fieldName: FieldPath<TFieldValues>;
  /** Expected output format — shown as a hint in the UI and injected into the prompt */
  format?: 'yaml' | 'json' | 'tfvars' | 'text';
  /** Short description of what this field is (e.g. "Ansible extra-vars YAML", "Terraform tfvars") */
  context?: string;
}

export function AICodeAssistant<TFieldValues extends FieldValues = FieldValues>({
  fieldName,
  format = 'yaml',
  context,
}: AICodeAssistantProps<TFieldValues>) {
  const { t } = useTranslation();
  const { enabled } = useAIAssistantEnabled();
  const { setValue } = useFormContext<TFieldValues>();

  const [isOpen, setIsOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [generated, setGenerated] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formatLabel = {
    yaml: 'YAML',
    json: 'JSON',
    tfvars: 'Terraform tfvars',
    text: 'text',
  }[format];

  const fieldContext = context ?? `${formatLabel} variables`;

  const systemInstruction = `You are an AWX automation assistant. The user wants to generate ${fieldContext}. 
Respond ONLY with the raw ${formatLabel} content — no markdown fences, no explanations, no surrounding text. 
Just the ${formatLabel} code itself.`;

  const generate = useCallback(async () => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError(null);
    setGenerated('');
    try {
      const resp = await postRequest<
        AIChatResponse,
        { messages: { role: string; content: string }[]; system_override?: string }
      >(awxAPI`/ai/chat/`, {
        messages: [{ role: 'user', content: prompt.trim() }],
        system_override: systemInstruction,
      });
      // Strip markdown code fences if the model included them
      const raw = resp.message.content
        .replace(/^```[a-z]*\n?/i, '')
        .replace(/\n?```$/i, '')
        .trim();
      setGenerated(raw);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('An unexpected error occurred.'));
    } finally {
      setLoading(false);
    }
  }, [loading, prompt, systemInstruction, t]);

  const handleInsert = useCallback(() => {
    setValue(fieldName, generated as Parameters<typeof setValue>[1], { shouldDirty: true });
    setIsOpen(false);
    setPrompt('');
    setGenerated('');
    setError(null);
  }, [fieldName, generated, setValue]);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setPrompt('');
    setGenerated('');
    setError(null);
  }, []);

  if (!enabled) return null;

  return (
    <>
      <Button
        variant="plain"
        aria-label={t('Generate with AI')}
        title={t('Generate with AI')}
        onClick={() => setIsOpen(true)}
        style={{ padding: '0 4px', color: 'var(--pf-v5-global--primary-color--100)' }}
        data-cy="ai-code-assistant-trigger"
      >
        <MagicIcon />
        <span style={{ marginLeft: 4, fontSize: 12, fontWeight: 500 }}>{t('AI')}</span>
      </Button>

      <Modal
        variant={ModalVariant.medium}
        title={t('Generate {{format}} with AI', { format: formatLabel })}
        isOpen={isOpen}
        onClose={handleClose}
        description={t('Describe what you need and the AI will generate the {{context}}.', {
          context: fieldContext,
        })}
        actions={[
          <Button
            key="insert"
            variant="primary"
            isDisabled={!generated || loading}
            onClick={handleInsert}
          >
            {t('Insert into field')}
          </Button>,
          <Button
            key="regenerate"
            variant="secondary"
            isDisabled={!prompt.trim() || loading}
            isLoading={loading}
            onClick={() => void generate()}
          >
            {loading ? t('Generating…') : t('Generate')}
          </Button>,
          <Button key="cancel" variant="link" onClick={handleClose}>
            {t('Cancel')}
          </Button>,
        ]}
      >
        <FormGroup label={t('Describe what you need')} fieldId="ai-prompt">
          <TextArea
            id="ai-prompt"
            aria-label={t('AI prompt')}
            placeholder={t('Describe the variables or content you want generated…')}
            value={prompt}
            onChange={(_e, val) => setPrompt(val)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                void generate();
              }
            }}
            rows={3}
            resizeOrientation="vertical"
            isDisabled={loading}
          />
          <FormHelperText>
            <HelperText>
              <HelperTextItem>
                {t(
                  'E.g. "Variables for deploying a Python 3.11 web app on port 8080 with debug disabled"'
                )}
              </HelperTextItem>
            </HelperText>
          </FormHelperText>
        </FormGroup>

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16 }}>
            <Spinner size="md" />
            <span style={{ fontSize: 14 }}>{t('Generating…')}</span>
          </div>
        )}

        {error && (
          <div
            style={{
              marginTop: 12,
              padding: '8px 12px',
              background: 'var(--pf-v5-global--danger-color--100)',
              color: '#fff',
              borderRadius: 4,
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        {generated && !loading && (
          <div style={{ marginTop: 16 }}>
            <p style={{ marginBottom: 6, fontSize: 13, fontWeight: 500 }}>
              {t('Generated {{format}}:', { format: formatLabel })}
            </p>
            <CodeBlock>
              <CodeBlockCode style={{ maxHeight: 280, overflowY: 'auto', fontSize: 13 }}>
                {generated}
              </CodeBlockCode>
            </CodeBlock>
          </div>
        )}
      </Modal>
    </>
  );
}
