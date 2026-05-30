/**
 * G5a — AI Workflow Suggestions Panel
 *
 * Adds an AI button to the WorkflowVisualizer toolbar.
 * When clicked, opens a panel where users can describe what they want to
 * automate in plain text; the AI suggests a workflow node structure.
 *
 * The generated suggestion shows a readable list of proposed nodes and
 * their dependencies which the operator can use as a guide to build the
 * workflow manually, or apply automatically (future work).
 */

import {
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
import { MagicIcon } from '@patternfly/react-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { postRequest } from '../../../../../common/crud/Data';
import { awxAPI } from '../../../../common/api/awx-utils';
import { useAIAssistantEnabled } from '../../../../common/AIAssistant';

interface AIChatResponse {
  message: { role: string; content: string };
}

const SYSTEM_PROMPT = `You are an AWX workflow automation architect.
The user will describe a multi-step automation task in plain text.
Generate a structured workflow plan as a numbered list of steps, where each step includes:
  1. Node name (what AWX job template to use, e.g. "Deploy Application")
  2. Node type (job, approval, inventory_update, project_update, or workflow)
  3. Success/failure path description
  4. Any conditions (run-on-success/run-on-failure/run-always)

Format each node as:
  Step N: <Name> [type=<type>]
    Description: <what this node does>
    Runs: on success of Step N-1 (or "always" / "on failure of Step X")

Keep suggestions practical for AWX. List at most 8 steps.
Do not use markdown headings or code blocks. Plain text with the step format above.`;

export function AIWorkflowSuggester() {
  const { t } = useTranslation();
  const { enabled: aiEnabled } = useAIAssistantEnabled();
  const [isOpen, setIsOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [suggestion, setSuggestion] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!aiEnabled) return null;

  const handleGenerate = async () => {
    if (!description.trim()) return;
    setIsLoading(true);
    setError(null);
    setSuggestion('');
    try {
      const resp = await postRequest<AIChatResponse, { messages: { role: string; content: string }[]; system_override: string }>(
        awxAPI`/ai/chat/`,
        {
          messages: [{ role: 'user', content: description.trim() }],
          system_override: SYSTEM_PROMPT,
        }
      );
      setSuggestion(resp.message.content);
    } catch {
      setError(t('Failed to generate workflow suggestion. Please try again.'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setIsOpen(false);
    setDescription('');
    setSuggestion('');
    setError(null);
  };

  return (
    <>
      <Button
        variant="secondary"
        icon={<MagicIcon />}
        onClick={() => setIsOpen(true)}
        size="sm"
      >
        {t('AI Suggest')}
      </Button>

      <Modal
        variant={ModalVariant.medium}
        title={t('AI Workflow Suggestion')}
        isOpen={isOpen}
        onClose={handleClose}
        actions={[
          <Button
            key="generate"
            variant="primary"
            onClick={() => void handleGenerate()}
            isDisabled={!description.trim() || isLoading}
          >
            {isLoading ? <Spinner size="sm" /> : t('Suggest workflow')}
          </Button>,
          <Button key="close" variant="link" onClick={handleClose}>
            {t('Close')}
          </Button>,
        ]}
      >
        <Stack hasGutter>
          <StackItem>
            <TextContent>
              <Text component={TextVariants.p}>
                {t('Describe the automation workflow you want to build. The AI will suggest a node structure based on your description.')}
              </Text>
              <Text component={TextVariants.small} style={{ fontStyle: 'italic', color: 'var(--pf-v5-global--Color--200)' }}>
                {t('Example: "Deploy a new application version: update inventory, run tests, deploy to staging, require approval, then deploy to production"')}
              </Text>
            </TextContent>
          </StackItem>

          <StackItem>
            <FormGroup label={t('What do you want to automate?')} fieldId="ai-workflow-description" isRequired>
              <TextArea
                id="ai-workflow-description"
                aria-label={t('Workflow description')}
                value={description}
                onChange={(_e, v) => setDescription(v)}
                rows={4}
                placeholder={t('Describe your multi-step automation goal…')}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void handleGenerate();
                }}
              />
            </FormGroup>
          </StackItem>

          {error && (
            <StackItem>
              <Text style={{ color: 'var(--pf-v5-global--danger-color--100)' }}>{error}</Text>
            </StackItem>
          )}

          {isLoading && (
            <StackItem>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Spinner size="md" />
                <span>{t('Thinking…')}</span>
              </div>
            </StackItem>
          )}

          {suggestion && (
            <StackItem>
              <TextContent style={{ marginBottom: 6 }}>
                <Text component={TextVariants.h4}>{t('Suggested workflow structure')}</Text>
              </TextContent>
              <CodeBlock>
                <CodeBlockCode style={{ whiteSpace: 'pre-wrap' }}>{suggestion}</CodeBlockCode>
              </CodeBlock>
              <TextContent style={{ marginTop: 8 }}>
                <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)' }}>
                  {t('Use this as a guide to add nodes in the visualizer using the "Add node" button above.')}
                </Text>
              </TextContent>
            </StackItem>
          )}
        </Stack>
      </Modal>
    </>
  );
}
