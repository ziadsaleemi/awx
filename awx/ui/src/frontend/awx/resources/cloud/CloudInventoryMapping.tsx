import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CodeBlock,
  CodeBlockCode,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Label,
  PageSection,
  Spinner,
  Stack,
  StackItem,
  Title,
} from '@patternfly/react-core';
import { MagicIcon, PlusCircleIcon } from '@patternfly/react-icons';
import { useGetPageUrl } from '../../../../framework';
import { AwxRoute } from '../../main/AwxRoutes';
import { isRequestError } from '../../../common/crud/RequestError';
import { CloudInventorySuggestionResponse, suggestCloudInventory } from './cloudConnectionStore';
import { countGeneratedInventoryHosts } from '../inventories/GeneratedInventory';

interface CloudInventoryMappingProps {
  providerId: string;
  providerLabel: string;
  organizationId?: number | null;
  connectionId?: string | number | null;
  isDisabled?: boolean;
}

function countVariables(suggestion: CloudInventorySuggestionResponse) {
  const plan = suggestion.suggestion;
  return (
    Object.keys(plan.variables ?? {}).length +
    (plan.groups ?? []).reduce(
      (count, group) => count + Object.keys(group.variables ?? {}).length,
      0
    )
  );
}

function formatResourceCounts(counts: Record<string, number>) {
  return Object.entries(counts)
    .map(([kind, count]) => `${kind}: ${count}`)
    .join(', ');
}

export function CloudInventoryMapping(props: CloudInventoryMappingProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const getPageUrl = useGetPageUrl();
  const [suggestion, setSuggestion] = useState<CloudInventorySuggestionResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createInventory = () => {
    if (!suggestion) return;
    navigate(getPageUrl(AwxRoute.CreateInventory), {
      state: {
        cloudInventorySuggestion: suggestion.suggestion,
        cloudInventoryName: t('{{provider}} cloud inventory', {
          provider: props.providerLabel,
        }),
        cloudInventoryDescription: t('Generated from {{provider}} cloud provider state.', {
          provider: props.providerLabel,
        }),
      },
    });
  };

  const suggestInventory = async () => {
    setIsLoading(true);
    setError(null);
    try {
      setSuggestion(
        await suggestCloudInventory(props.providerId, {
          organizationId: props.organizationId,
          connectionId: props.connectionId,
        })
      );
    } catch (err) {
      const detail =
        isRequestError(err) && err.details
          ? err.details
          : err instanceof Error
            ? err.message
            : String(err);
      setError(detail);
    } finally {
      setIsLoading(false);
    }
  };

  const hostCount = suggestion ? countGeneratedInventoryHosts(suggestion.suggestion) : 0;
  const groupCount = suggestion?.suggestion.groups.length ?? 0;
  const variableCount = suggestion ? countVariables(suggestion) : 0;

  return (
    <PageSection style={{ padding: '1.5rem' }}>
      <Card>
        <CardBody>
          <Stack hasGutter>
            <StackItem>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <Title headingLevel="h3" size="lg">
                    {t('Inventory mapping')}
                  </Title>
                  {suggestion && (
                    <div style={{ marginTop: 6 }}>
                      <Label color={suggestion.ai_used ? 'purple' : 'blue'} isCompact>
                        {suggestion.ai_used ? t('AI refined') : t('Rule-based fallback')}
                      </Label>
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Button
                    variant="primary"
                    icon={isLoading ? <Spinner size="sm" /> : <MagicIcon />}
                    onClick={() => void suggestInventory()}
                    isDisabled={props.isDisabled || isLoading}
                    data-cy="cloud-inventory-suggest"
                  >
                    {isLoading ? t('Suggesting') : t('Suggest inventory')}
                  </Button>
                  {suggestion && (
                    <Button
                      variant="secondary"
                      icon={<PlusCircleIcon />}
                      onClick={createInventory}
                      data-cy="cloud-inventory-create"
                    >
                      {t('Create inventory')}
                    </Button>
                  )}
                </div>
              </div>
            </StackItem>

            {error && (
              <StackItem>
                <Alert isInline variant="danger" title={t('Unable to suggest inventory')}>
                  {error}
                </Alert>
              </StackItem>
            )}

            {suggestion && (
              <>
                <StackItem>
                  <DescriptionList isHorizontal isCompact>
                    <DescriptionListGroup>
                      <DescriptionListTerm>{t('Groups')}</DescriptionListTerm>
                      <DescriptionListDescription>
                        <Label color="blue">{groupCount}</Label>
                      </DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                      <DescriptionListTerm>{t('Hosts')}</DescriptionListTerm>
                      <DescriptionListDescription>
                        <Label color="green">{hostCount}</Label>
                      </DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                      <DescriptionListTerm>{t('Variables')}</DescriptionListTerm>
                      <DescriptionListDescription>
                        <Label color="purple">{variableCount}</Label>
                      </DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                      <DescriptionListTerm>{t('Resources')}</DescriptionListTerm>
                      <DescriptionListDescription>
                        <span style={{ fontSize: '0.85rem' }}>
                          {formatResourceCounts(suggestion.resource_counts)}
                        </span>
                      </DescriptionListDescription>
                    </DescriptionListGroup>
                  </DescriptionList>
                </StackItem>
                <StackItem>
                  <CodeBlock>
                    <CodeBlockCode
                      style={{
                        maxHeight: 420,
                        overflow: 'auto',
                        whiteSpace: 'pre',
                      }}
                    >
                      {suggestion.suggestion.source}
                    </CodeBlockCode>
                  </CodeBlock>
                </StackItem>
              </>
            )}
          </Stack>
        </CardBody>
      </Card>
    </PageSection>
  );
}
