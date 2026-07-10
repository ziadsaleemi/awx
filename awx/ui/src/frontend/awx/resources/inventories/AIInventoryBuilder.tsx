/**
 * G4a — AI Natural-Language Inventory Builder
 *
 * A modal wizard where the user describes their infrastructure in plain text.
 * The AI generates a structured Capstan inventory plan with groups, hosts, and
 * variables as a preview before saving.
 *
 * The button is hidden when AI is not enabled.
 */

import {
  Button,
  CodeBlock,
  CodeBlockCode,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  FormGroup,
  Label,
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
import { useFormContext } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { postRequest } from '../../../common/crud/Data';
import { awxAPI } from '../../common/api/awx-utils';
import { useAIAssistantEnabled } from '../../common/AIAssistant';
import {
  GeneratedInventoryPlan,
  countGeneratedInventoryHosts,
  parseGeneratedInventory,
} from './GeneratedInventory';

interface AIChatResponse {
  message: { role: string; content: string };
  model: string;
  provider: string;
}

interface AIInventoryBuilderProps {
  /** Form field name to set when the generated plan is accepted. */
  fieldName?: string;
}

const SYSTEM_PROMPT = `You are a Capstan/Ansible inventory generation expert.
The user will describe their infrastructure in plain text.
Generate a valid Capstan static inventory in INI format (Ansible inventory INI syntax) with:
  - Logical group names in square brackets
  - Hosts under each group
  - A [all:vars] section with common variables if applicable
  - Per-host variables using host=value syntax when needed
Output ONLY the raw INI content. No explanations, no markdown fences, no prose before or after.
Example output:
[webservers]
web1.example.com ansible_user=ec2-user
web2.example.com ansible_user=ec2-user

[databases]
db1.example.com ansible_user=postgres

[all:vars]
ansible_ssh_private_key_file=~/.ssh/id_rsa`;

function stripFences(text: string): string {
  return text
    .replace(/^```(?:ini|yaml|ansible)?\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
}

export function AIInventoryBuilder({
  fieldName = 'aiGeneratedInventory',
}: AIInventoryBuilderProps) {
  const { t } = useTranslation();
  const { enabled: aiEnabled } = useAIAssistantEnabled();
  const { setValue } = useFormContext();
  const [isOpen, setIsOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [generated, setGenerated] = useState('');
  const [generatedPlan, setGeneratedPlan] = useState<GeneratedInventoryPlan | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!aiEnabled) return null;

  const handleGenerate = async () => {
    if (!description.trim()) return;
    setIsLoading(true);
    setError(null);
    setGenerated('');
    setGeneratedPlan(null);
    try {
      const resp = await postRequest<
        AIChatResponse,
        { messages: { role: string; content: string }[]; system_override: string }
      >(awxAPI`/ai/chat/`, {
        messages: [{ role: 'user', content: description.trim() }],
        system_override: SYSTEM_PROMPT,
      });
      const source = stripFences(resp.message.content);
      const plan = parseGeneratedInventory(source);
      if (countGeneratedInventoryHosts(plan) === 0 && plan.groups.length === 0) {
        setError(t('The generated inventory did not include any groups or hosts.'));
        return;
      }
      setGenerated(source);
      setGeneratedPlan(plan);
    } catch (e) {
      setError(t('Failed to generate inventory. Please try again.'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleInsert = () => {
    if (!generatedPlan) return;
    setValue(fieldName, generatedPlan, { shouldDirty: true });
    setIsOpen(false);
    setDescription('');
    setGenerated('');
    setGeneratedPlan(null);
    setError(null);
  };

  const handleClose = () => {
    setIsOpen(false);
    setDescription('');
    setGenerated('');
    setGeneratedPlan(null);
    setError(null);
  };

  return (
    <>
      <Button
        variant="plain"
        aria-label={t('AI Inventory Builder')}
        title={t('Generate inventory with AI')}
        onClick={() => setIsOpen(true)}
        style={{ padding: '0 6px' }}
      >
        <MagicIcon />
        <span style={{ marginLeft: 4, fontSize: 12 }}>{t('AI')}</span>
      </Button>

      <Modal
        variant={ModalVariant.medium}
        title={t('AI Inventory Builder')}
        isOpen={isOpen}
        onClose={handleClose}
        actions={[
          generatedPlan ? (
            <Button key="insert" variant="primary" onClick={handleInsert}>
              {t('Use generated inventory')}
            </Button>
          ) : (
            <Button
              key="generate"
              variant="primary"
              onClick={() => void handleGenerate()}
              isDisabled={!description.trim() || isLoading}
            >
              {isLoading ? <Spinner size="sm" /> : t('Generate')}
            </Button>
          ),
          <Button key="cancel" variant="link" onClick={handleClose}>
            {t('Cancel')}
          </Button>,
        ]}
      >
        <Stack hasGutter>
          <StackItem>
            <TextContent>
              <Text component={TextVariants.p}>
                {t('Describe your infrastructure in plain text. For example:')}
              </Text>
              <Text
                component={TextVariants.small}
                style={{ fontStyle: 'italic', color: 'var(--pf-v5-global--Color--200)' }}
              >
                {t(
                  '"3 web servers (web1-web3.prod.example.com) and 1 Postgres database (db1.prod.example.com), all accessible via ec2-user"'
                )}
              </Text>
            </TextContent>
          </StackItem>

          <StackItem>
            <FormGroup
              label={t('Infrastructure description')}
              fieldId="ai-inventory-description"
              isRequired
            >
              <TextArea
                id="ai-inventory-description"
                aria-label={t('Infrastructure description')}
                value={description}
                onChange={(_e, v) => setDescription(v)}
                rows={5}
                placeholder={t('Describe your hosts, groups, and environment…')}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    void handleGenerate();
                  }
                }}
              />
            </FormGroup>
          </StackItem>

          {error && (
            <StackItem>
              <TextContent>
                <Text
                  component={TextVariants.p}
                  style={{ color: 'var(--pf-v5-global--danger-color--100)' }}
                >
                  {error}
                </Text>
              </TextContent>
            </StackItem>
          )}

          {isLoading && (
            <StackItem>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Spinner size="md" />
                <span>{t('Generating inventory…')}</span>
              </div>
            </StackItem>
          )}

          {generated && (
            <StackItem>
              {generatedPlan && (
                <DescriptionList
                  isHorizontal
                  isCompact
                  style={{ marginBottom: 'var(--pf-v5-global--spacer--sm)' }}
                >
                  <DescriptionListGroup>
                    <DescriptionListTerm>{t('Groups')}</DescriptionListTerm>
                    <DescriptionListDescription>
                      <Label color="blue">{generatedPlan.groups.length}</Label>
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                  <DescriptionListGroup>
                    <DescriptionListTerm>{t('Hosts')}</DescriptionListTerm>
                    <DescriptionListDescription>
                      <Label color="green">{countGeneratedInventoryHosts(generatedPlan)}</Label>
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                  <DescriptionListGroup>
                    <DescriptionListTerm>{t('Variables')}</DescriptionListTerm>
                    <DescriptionListDescription>
                      <Label color="purple">
                        {Object.keys(generatedPlan.variables).length +
                          generatedPlan.groups.reduce(
                            (count, group) => count + Object.keys(group.variables).length,
                            0
                          )}
                      </Label>
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                </DescriptionList>
              )}
              <TextContent style={{ marginBottom: 6 }}>
                <Text component={TextVariants.h4}>{t('Generated inventory (INI format)')}</Text>
              </TextContent>
              <CodeBlock>
                <CodeBlockCode>{generated}</CodeBlockCode>
              </CodeBlock>
            </StackItem>
          )}
        </Stack>
      </Modal>
    </>
  );
}
