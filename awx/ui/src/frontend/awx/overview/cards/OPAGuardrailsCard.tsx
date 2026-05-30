/**
 * G6b — OPA Policy Management Dashboard Card
 *
 * Shows current OPA guardrail status: enabled/disabled, server URL,
 * and the list of active policies with their paths.
 *
 * Also shows an interactive policy tester where admins can paste
 * a JSON input and evaluate a policy immediately.
 */

import {
  Alert,
  Button,
  CardBody,
  ClipboardCopy,
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
import { CheckCircleIcon, SecurityIcon, TimesCircleIcon } from '@patternfly/react-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { PageDashboardCard } from '../../../../framework/PageDashboard/PageDashboardCard';
import { postRequest, requestGet } from '../../../common/crud/Data';
import { awxAPI } from '../../common/api/awx-utils';

interface OPAPolicy {
  id: string;
  path: string;
  description: string;
}

interface OPAStatusResponse {
  enabled: boolean;
  server_url: string;
  policies: OPAPolicy[];
}

interface OPAEvalResponse {
  result: unknown;
  allowed: boolean;
  opa_response: unknown;
  detail?: string;
}

function useOPAStatus() {
  return useSWR<OPAStatusResponse>(
    awxAPI`/opa/policies/`,
    (url: string) =>
      requestGet<OPAStatusResponse>(url).catch(() => ({
        enabled: false,
        server_url: '',
        policies: [],
      }))
  );
}

export function OPAGuardrailsCard() {
  const { t } = useTranslation();
  const { data, isLoading } = useOPAStatus();
  const [testerOpen, setTesterOpen] = useState(false);
  const [policyPath, setPolicyPath] = useState('awx/job_launch/allow');
  const [inputJson, setInputJson] = useState('{\n  "user": {"username": "admin", "is_superuser": true},\n  "template": {"id": 1, "name": "Deploy App"}\n}');
  const [evalResult, setEvalResult] = useState<OPAEvalResponse | null>(null);
  const [evalLoading, setEvalLoading] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);

  const handleEvaluate = async () => {
    setEvalLoading(true);
    setEvalError(null);
    setEvalResult(null);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(inputJson);
      } catch {
        setEvalError(t('Invalid JSON in input field.'));
        return;
      }
      const resp = await postRequest<OPAEvalResponse, { policy_path: string; input: unknown }>(
        awxAPI`/opa/evaluate/`,
        { policy_path: policyPath, input: parsed }
      );
      setEvalResult(resp);
    } catch {
      setEvalError(t('Policy evaluation failed. Check server connectivity.'));
    } finally {
      setEvalLoading(false);
    }
  };

  return (
    <>
      <PageDashboardCard
        title={t('OPA Guardrails')}
        width="md"
        height="sm"
        headerControls={
          <Button
            variant="plain"
            aria-label={t('Test a policy')}
            title={t('Open policy tester')}
            onClick={() => setTesterOpen(true)}
          >
            <SecurityIcon />
          </Button>
        }
      >
        <CardBody>
          {isLoading ? (
            <Spinner size="lg" />
          ) : (
            <Stack hasGutter>
              <StackItem>
                <DescriptionList isCompact isHorizontal>
                  <DescriptionListGroup>
                    <DescriptionListTerm>{t('Status')}</DescriptionListTerm>
                    <DescriptionListDescription>
                      {data?.enabled ? (
                        <Label color="green" icon={<CheckCircleIcon />}>{t('Enabled')}</Label>
                      ) : (
                        <Label color="grey" icon={<TimesCircleIcon />}>{t('Disabled')}</Label>
                      )}
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                  {data?.server_url && (
                    <DescriptionListGroup>
                      <DescriptionListTerm>{t('OPA Server')}</DescriptionListTerm>
                      <DescriptionListDescription>
                        <ClipboardCopy isReadOnly isInline hoverTip={t('Copy')} clickTip={t('Copied')}>
                          {data.server_url}
                        </ClipboardCopy>
                      </DescriptionListDescription>
                    </DescriptionListGroup>
                  )}
                  <DescriptionListGroup>
                    <DescriptionListTerm>{t('Active policies')}</DescriptionListTerm>
                    <DescriptionListDescription>{data?.policies.length ?? 0}</DescriptionListDescription>
                  </DescriptionListGroup>
                </DescriptionList>
              </StackItem>

              {!data?.enabled && (
                <StackItem>
                  <TextContent>
                    <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)' }}>
                      {t('Set OPA_ENABLED=True and OPA_SERVER_URL in AWX settings to enforce policy guardrails on all actions.')}
                    </Text>
                  </TextContent>
                </StackItem>
              )}

              {data?.enabled && data.policies.length > 0 && (
                <StackItem>
                  <table style={{ width: '100%', fontSize: 12 }}>
                    <tbody>
                      {data.policies.map((p) => (
                        <tr key={p.id}>
                          <td style={{ padding: '2px 8px 2px 0', fontWeight: 600 }}>{p.id}</td>
                          <td style={{ color: 'var(--pf-v5-global--Color--200)', fontFamily: 'monospace', fontSize: 11 }}>{p.path}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </StackItem>
              )}
            </Stack>
          )}
        </CardBody>
      </PageDashboardCard>

      {/* Policy Tester Modal */}
      <Modal
        variant={ModalVariant.medium}
        title={t('OPA Policy Tester')}
        isOpen={testerOpen}
        onClose={() => setTesterOpen(false)}
        actions={[
          <Button
            key="evaluate"
            variant="primary"
            onClick={() => void handleEvaluate()}
            isDisabled={evalLoading}
          >
            {evalLoading ? <Spinner size="sm" /> : t('Evaluate')}
          </Button>,
          <Button key="close" variant="link" onClick={() => setTesterOpen(false)}>
            {t('Close')}
          </Button>,
        ]}
      >
        <Stack hasGutter>
          <StackItem>
            <FormGroup label={t('Policy path')} fieldId="opa-policy-path">
              <TextArea
                id="opa-policy-path"
                rows={1}
                value={policyPath}
                onChange={(_e, v) => setPolicyPath(v)}
                aria-label={t('Policy path')}
              />
            </FormGroup>
          </StackItem>
          <StackItem>
            <FormGroup label={t('Input JSON')} fieldId="opa-input-json">
              <TextArea
                id="opa-input-json"
                rows={6}
                value={inputJson}
                onChange={(_e, v) => setInputJson(v)}
                aria-label={t('Input JSON')}
                style={{ fontFamily: 'monospace', fontSize: 12 }}
              />
            </FormGroup>
          </StackItem>

          {evalError && (
            <StackItem>
              <Alert variant="danger" isInline title={evalError} />
            </StackItem>
          )}

          {evalResult && (
            <StackItem>
              <Alert
                variant={evalResult.allowed ? 'success' : 'danger'}
                isInline
                title={evalResult.allowed ? t('Decision: ALLOW') : t('Decision: DENY')}
                style={{ marginBottom: 8 }}
              />
              <TextContent style={{ marginBottom: 4 }}>
                <Text component={TextVariants.h4}>{t('Full OPA response')}</Text>
              </TextContent>
              <CodeBlock>
                <CodeBlockCode>{JSON.stringify(evalResult.opa_response ?? evalResult, null, 2)}</CodeBlockCode>
              </CodeBlock>
            </StackItem>
          )}
        </Stack>
      </Modal>
    </>
  );
}
