import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  ClipboardCopy,
  CodeBlock,
  CodeBlockCode,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  FormGroup,
  FormSelect,
  FormSelectOption,
  Label,
  PageSection,
  Spinner,
  Stack,
  StackItem,
  TextArea,
} from '@patternfly/react-core';
import { CheckCircleIcon, SyncAltIcon, TimesCircleIcon } from '@patternfly/react-icons';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { postRequest } from '../../../common/crud/Data';
import { useGet } from '../../../common/crud/useGet';
import { awxAPI } from '../../common/api/awx-utils';

interface OPAPolicy {
  id: string;
  path: string;
  description: string;
  input_example?: Record<string, unknown>;
}

interface OPAStatusResponse {
  enabled: boolean;
  server_url: string;
  policies: OPAPolicy[];
  policy_bundle: {
    configured: boolean;
    size: number;
    line_count?: number;
    sha256?: string;
    sync_endpoint?: string;
  };
}

interface OPAEvalResponse {
  result: unknown;
  allowed: boolean;
  opa_response: unknown;
  detail?: string;
}

interface OPASyncResponse {
  changed: boolean;
  policy_id: string;
  size: number;
  line_count: number;
  sha256: string;
  opa_response: unknown;
}

const fallbackInput = {
  action: 'launch',
  source: 'api',
  user: { id: 1, username: 'admin', is_superuser: true },
  template: { id: 1, name: 'Deploy App', type: 'jobtemplate' },
};

function formatInput(policy?: OPAPolicy) {
  return JSON.stringify(policy?.input_example ?? fallbackInput, null, 2);
}

export function OPAPolicyManagementPanel() {
  const { t } = useTranslation();
  const { data, isLoading, error } = useGet<OPAStatusResponse>(awxAPI`/opa/policies/`);
  const policies = useMemo(() => data?.policies ?? [], [data?.policies]);
  const [policyPath, setPolicyPath] = useState('awx/job_launch/allow');
  const [inputJson, setInputJson] = useState(() => JSON.stringify(fallbackInput, null, 2));
  const [evalResult, setEvalResult] = useState<OPAEvalResponse | null>(null);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [evalLoading, setEvalLoading] = useState(false);
  const [syncResult, setSyncResult] = useState<OPASyncResponse | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);

  useEffect(() => {
    if (!policies.length) return;
    if (!policies.some((policy) => policy.path === policyPath)) {
      setPolicyPath(policies[0].path);
      setInputJson(formatInput(policies[0]));
    }
  }, [policies, policyPath]);

  const selectPolicy = (path: string) => {
    const policy = policies.find((item) => item.path === path);
    setPolicyPath(path);
    setInputJson(formatInput(policy));
    setEvalResult(null);
    setEvalError(null);
  };

  const handleEvaluate = async () => {
    setEvalLoading(true);
    setEvalError(null);
    setEvalResult(null);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(inputJson);
      } catch {
        setEvalError(t('Input JSON is invalid.'));
        return;
      }
      const response = await postRequest<OPAEvalResponse, { policy_path: string; input: unknown }>(
        awxAPI`/opa/evaluate/`,
        { policy_path: policyPath, input: parsed }
      );
      setEvalResult(response);
    } catch {
      setEvalError(t('Policy evaluation failed. Check OPA settings and server connectivity.'));
    } finally {
      setEvalLoading(false);
    }
  };

  const handleSync = async () => {
    setSyncLoading(true);
    setSyncError(null);
    setSyncResult(null);
    try {
      const response = await postRequest<OPASyncResponse, { policy_id: string }>(
        awxAPI`/opa/policies/sync/`,
        { policy_id: 'awx/managed' }
      );
      setSyncResult(response);
    } catch {
      setSyncError(t('Policy bundle sync failed. Check OPA settings and server connectivity.'));
    } finally {
      setSyncLoading(false);
    }
  };

  return (
    <PageSection isWidthLimited data-cy="opa-policy-management">
      <Stack hasGutter>
        <StackItem>
          <Card isFlat>
            <CardHeader>
              <CardTitle>{t('OPA Status')}</CardTitle>
            </CardHeader>
            <CardBody>
              {isLoading ? (
                <Spinner size="md" />
              ) : error ? (
                <Alert variant="danger" isInline title={t('Could not load OPA policy status.')} />
              ) : (
                <Stack hasGutter>
                  <StackItem>
                    <DescriptionList isHorizontal isCompact>
                      <DescriptionListGroup>
                        <DescriptionListTerm>{t('Enforcement')}</DescriptionListTerm>
                        <DescriptionListDescription>
                          {data?.enabled ? (
                            <Label color="green" icon={<CheckCircleIcon />}>
                              {t('Enabled')}
                            </Label>
                          ) : (
                            <Label color="grey" icon={<TimesCircleIcon />}>
                              {t('Disabled')}
                            </Label>
                          )}
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                      <DescriptionListGroup>
                        <DescriptionListTerm>{t('OPA server')}</DescriptionListTerm>
                        <DescriptionListDescription>
                          {data?.server_url ? (
                            <ClipboardCopy isReadOnly hoverTip={t('Copy')} clickTip={t('Copied')}>
                              {data.server_url}
                            </ClipboardCopy>
                          ) : (
                            t('Not configured')
                          )}
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                      <DescriptionListGroup>
                        <DescriptionListTerm>{t('Managed policy bundle')}</DescriptionListTerm>
                        <DescriptionListDescription>
                          {data?.policy_bundle?.configured
                            ? t('{{bytes}} bytes / {{lines}} lines configured', {
                                bytes: data.policy_bundle.size,
                                lines: data.policy_bundle.line_count ?? 0,
                              })
                            : t('No bundle text configured')}
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                      {data?.policy_bundle?.sha256 ? (
                        <DescriptionListGroup>
                          <DescriptionListTerm>{t('Bundle checksum')}</DescriptionListTerm>
                          <DescriptionListDescription>
                            <ClipboardCopy isReadOnly hoverTip={t('Copy')} clickTip={t('Copied')}>
                              {data.policy_bundle.sha256}
                            </ClipboardCopy>
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                      ) : null}
                      <DescriptionListGroup>
                        <DescriptionListTerm>{t('Decision paths')}</DescriptionListTerm>
                        <DescriptionListDescription>{policies.length}</DescriptionListDescription>
                      </DescriptionListGroup>
                    </DescriptionList>
                  </StackItem>
                  <StackItem>
                    <Button
                      variant="secondary"
                      icon={<SyncAltIcon />}
                      onClick={() => void handleSync()}
                      isLoading={syncLoading}
                      isDisabled={syncLoading || !data?.enabled || !data?.policy_bundle?.configured}
                    >
                      {t('Sync policy bundle to OPA')}
                    </Button>
                  </StackItem>
                  {syncError ? (
                    <StackItem>
                      <Alert variant="danger" isInline title={syncError} />
                    </StackItem>
                  ) : null}
                  {syncResult ? (
                    <StackItem>
                      <Alert
                        variant="success"
                        isInline
                        title={t('Policy bundle synced to {{policyId}}.', {
                          policyId: syncResult.policy_id,
                        })}
                      />
                    </StackItem>
                  ) : null}
                </Stack>
              )}
            </CardBody>
          </Card>
        </StackItem>
        <StackItem>
          <Card isFlat>
            <CardHeader>
              <CardTitle>{t('Policy Tester')}</CardTitle>
            </CardHeader>
            <CardBody>
              <Stack hasGutter>
                <StackItem>
                  <FormGroup label={t('Decision path')} fieldId="opa-policy-path">
                    <FormSelect
                      id="opa-policy-path"
                      value={policyPath}
                      onChange={(_event, value) => selectPolicy(String(value))}
                      isDisabled={isLoading || policies.length === 0}
                    >
                      {policies.map((policy) => (
                        <FormSelectOption
                          key={policy.path}
                          value={policy.path}
                          label={`${policy.id} - ${policy.path}`}
                        />
                      ))}
                    </FormSelect>
                  </FormGroup>
                </StackItem>
                <StackItem>
                  <FormGroup label={t('Input JSON')} fieldId="opa-input-json">
                    <TextArea
                      id="opa-input-json"
                      value={inputJson}
                      rows={10}
                      onChange={(_event, value) => setInputJson(value)}
                      aria-label={t('Input JSON')}
                      style={{ fontFamily: 'monospace' }}
                    />
                  </FormGroup>
                </StackItem>
                <StackItem>
                  <Button
                    variant="primary"
                    onClick={() => void handleEvaluate()}
                    isLoading={evalLoading}
                    isDisabled={evalLoading || !policyPath}
                  >
                    {t('Evaluate')}
                  </Button>
                </StackItem>
                {evalError ? (
                  <StackItem>
                    <Alert variant="danger" isInline title={evalError} />
                  </StackItem>
                ) : null}
                {evalResult ? (
                  <StackItem>
                    <Alert
                      variant={evalResult.allowed ? 'success' : 'danger'}
                      isInline
                      title={evalResult.allowed ? t('Decision: Allow') : t('Decision: Deny')}
                      style={{ marginBottom: 12 }}
                    />
                    <CodeBlock>
                      <CodeBlockCode>
                        {JSON.stringify(evalResult.opa_response ?? evalResult, null, 2)}
                      </CodeBlockCode>
                    </CodeBlock>
                  </StackItem>
                ) : null}
              </Stack>
            </CardBody>
          </Card>
        </StackItem>
      </Stack>
    </PageSection>
  );
}
