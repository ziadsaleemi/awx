import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Checkbox,
  CodeBlock,
  CodeBlockCode,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  FormGroup,
  Label,
  PageSection,
  Spinner,
  Stack,
  StackItem,
  TextInput,
} from '@patternfly/react-core';
import {
  CheckCircleIcon,
  DownloadIcon,
  SyncAltIcon,
  TimesCircleIcon,
} from '@patternfly/react-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useGetPageUrl } from '../../../../framework';
import { postRequest } from '../../../common/crud/Data';
import { awxAPI } from '../../common/api/awx-utils';
import { AwxRoute } from '../../main/AwxRoutes';

interface ExternalAutomationCheck {
  ok: boolean;
  status: string;
  count?: number;
  allowed?: boolean;
  health_status_code?: number;
  context?: string;
  counts?: {
    constraint_templates?: number;
    constraints?: number;
    violations?: number;
    configs?: number;
    nodes?: number;
    vms?: number;
    containers?: number;
    templates?: number;
    running_vms?: number;
  };
  connection_name?: string;
  expected_vms_found?: number;
  expected_vm_names?: string[];
  expected_vms?: {
    name: string;
    found: boolean;
    status?: string;
    node?: string;
    type?: string;
    vmid?: number;
  }[];
  deny_smoke?: {
    ok: boolean;
    status: string;
    allowed?: boolean;
  };
  policy_sync?: {
    requested?: boolean;
    ok?: boolean;
    status?: string;
    policy_id?: string;
  };
}

interface ExternalAutomationCheckResponse {
  ok: boolean;
  checks: {
    eda?: ExternalAutomationCheck;
    opa?: ExternalAutomationCheck;
    gatekeeper?: ExternalAutomationCheck;
    proxmox?: ExternalAutomationCheck;
  };
  audit?: {
    activity_stream_id: number;
    activity_stream_url: string;
  };
}

interface ExternalAutomationCheckRequest {
  include_eda: boolean;
  include_opa: boolean;
  sync_opa_policy: boolean;
  opa_policy_id: string;
  opa_deny_smoke: boolean;
  start_eda_activation: boolean;
  include_gatekeeper: boolean;
  gatekeeper_context: string;
  include_proxmox?: boolean;
  proxmox_connection_id?: string;
  proxmox_expected_vms?: string[];
}

interface PolicySmokeSelection {
  includeOpa: boolean;
  includeGatekeeper: boolean;
  includeProxmox: boolean;
}

interface ExternalAutomationEvidenceReport {
  generated_at: string;
  surface: string;
  request: ExternalAutomationCheckRequest | null;
  result: ExternalAutomationCheckResponse;
}

function downloadEvidenceReport(report: ExternalAutomationEvidenceReport) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `external-automation-smoke-${report.generated_at.replace(/[:.]/g, '-')}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function StatusLabel(props: { check?: ExternalAutomationCheck }) {
  const { t } = useTranslation();
  if (!props.check) {
    return (
      <Label color="grey" icon={<TimesCircleIcon />}>
        {t('Not checked')}
      </Label>
    );
  }
  return props.check.ok ? (
    <Label color="green" icon={<CheckCircleIcon />}>
      {props.check.status}
    </Label>
  ) : (
    <Label color="red" icon={<TimesCircleIcon />}>
      {props.check.status}
    </Label>
  );
}

export function ExternalAutomationSmokePanel(props?: {
  includeEda?: boolean;
  includeOpa?: boolean;
  includeGatekeeper?: boolean;
}) {
  const { t } = useTranslation();
  const getPageUrl = useGetPageUrl();
  const includeEda = props?.includeEda ?? true;
  const includeOpa = props?.includeOpa ?? true;
  const includeGatekeeper = props?.includeGatekeeper ?? false;
  const policySelectionEnabled = !includeEda && includeGatekeeper;
  const proxmoxProofEnabled = includeEda;
  const [policyCheckOpa, setPolicyCheckOpa] = useState(includeOpa);
  const [policyCheckGatekeeper, setPolicyCheckGatekeeper] = useState(includeGatekeeper);
  const [proxmoxCheck, setProxmoxCheck] = useState(false);
  const [result, setResult] = useState<ExternalAutomationCheckResponse | null>(null);
  const [lastRunChecks, setLastRunChecks] = useState<PolicySmokeSelection | null>(null);
  const [lastRunRequest, setLastRunRequest] = useState<ExternalAutomationCheckRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gatekeeperContext, setGatekeeperContext] = useState('');
  const [proxmoxConnectionId, setProxmoxConnectionId] = useState('');
  const [proxmoxExpectedVms, setProxmoxExpectedVms] = useState('');
  const [loading, setLoading] = useState(false);
  const selectedIncludeOpa = policySelectionEnabled ? policyCheckOpa : includeOpa;
  const selectedIncludeGatekeeper = policySelectionEnabled
    ? policyCheckGatekeeper
    : includeGatekeeper;
  const resultIncludeOpa = lastRunChecks?.includeOpa ?? selectedIncludeOpa;
  const resultIncludeGatekeeper = lastRunChecks?.includeGatekeeper ?? selectedIncludeGatekeeper;
  const resultIncludeProxmox = lastRunChecks?.includeProxmox ?? proxmoxCheck;
  const showOpaResult = Boolean(result?.checks.opa) || resultIncludeOpa;
  const showGatekeeperResult = Boolean(result?.checks.gatekeeper) || resultIncludeGatekeeper;
  const showProxmoxResult = Boolean(result?.checks.proxmox) || resultIncludeProxmox;
  const gatekeeperNotConfigured =
    result?.checks.gatekeeper?.ok === false && result.checks.gatekeeper.status === 'not_configured';

  const title = includeEda
    ? t('External Automation Smoke')
    : includeGatekeeper
      ? t('Policy Smoke')
      : t('OPA Smoke');
  const buttonLabel = includeEda
    ? t('Run EDA and OPA smoke')
    : selectedIncludeOpa && selectedIncludeGatekeeper
      ? t('Run OPA and Gatekeeper smoke')
      : selectedIncludeGatekeeper
        ? t('Run Gatekeeper smoke')
        : selectedIncludeOpa
          ? t('Run OPA smoke')
          : t('Run policy smoke');
  const passedTitle = includeEda
    ? t('External automation smoke passed.')
    : resultIncludeOpa && resultIncludeGatekeeper
      ? t('Policy smoke passed.')
      : resultIncludeGatekeeper
        ? t('Gatekeeper smoke passed.')
        : t('OPA smoke passed.');
  const failedTitle = includeEda
    ? t('External automation smoke failed.')
    : resultIncludeOpa && resultIncludeGatekeeper
      ? t('Policy smoke failed.')
      : resultIncludeGatekeeper
        ? t('Gatekeeper smoke failed.')
        : t('OPA smoke failed.');

  const runSmoke = async () => {
    const runChecks = {
      includeOpa: selectedIncludeOpa,
      includeGatekeeper: selectedIncludeGatekeeper,
      includeProxmox: proxmoxProofEnabled && proxmoxCheck,
    };

    if (!includeEda && !runChecks.includeOpa && !runChecks.includeGatekeeper) {
      setResult(null);
      setError(t('Select at least one policy check.'));
      return;
    }

    const requestPayload: ExternalAutomationCheckRequest = {
      include_eda: includeEda,
      include_opa: runChecks.includeOpa,
      sync_opa_policy: runChecks.includeOpa,
      opa_policy_id: 'awx/managed',
      opa_deny_smoke: runChecks.includeOpa,
      start_eda_activation: false,
      include_gatekeeper: runChecks.includeGatekeeper,
      gatekeeper_context: runChecks.includeGatekeeper ? gatekeeperContext.trim() : '',
    };

    if (proxmoxProofEnabled) {
      requestPayload.include_proxmox = runChecks.includeProxmox;
      requestPayload.proxmox_connection_id = proxmoxConnectionId.trim();
      requestPayload.proxmox_expected_vms = proxmoxExpectedVms
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean);
    }

    setLastRunChecks(runChecks);
    setLastRunRequest(requestPayload);
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const response = await postRequest<
        ExternalAutomationCheckResponse,
        ExternalAutomationCheckRequest
      >(awxAPI`/external_automation/check/`, requestPayload);
      setResult(response);
    } catch {
      setError(t('External automation smoke check failed. Check service settings and logs.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageSection data-cy="external-automation-smoke">
      <Card isFlat>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardBody>
          <Stack hasGutter>
            {policySelectionEnabled ? (
              <StackItem>
                <FormGroup label={t('Policy checks')} fieldId="external-automation-policy-checks">
                  <Checkbox
                    id="external-automation-check-opa"
                    label={t('OPA')}
                    isChecked={policyCheckOpa}
                    onChange={(_event, checked) => setPolicyCheckOpa(checked)}
                    isDisabled={loading}
                    data-cy="external-automation-check-opa"
                  />
                  <Checkbox
                    id="external-automation-check-gatekeeper"
                    label={t('Gatekeeper')}
                    isChecked={policyCheckGatekeeper}
                    onChange={(_event, checked) => setPolicyCheckGatekeeper(checked)}
                    isDisabled={loading}
                    data-cy="external-automation-check-gatekeeper"
                  />
                </FormGroup>
              </StackItem>
            ) : null}
            {selectedIncludeGatekeeper ? (
              <StackItem>
                <FormGroup
                  label={t('Gatekeeper context')}
                  fieldId="external-automation-gatekeeper-context"
                >
                  <TextInput
                    id="external-automation-gatekeeper-context"
                    value={gatekeeperContext}
                    onChange={(_event, value) => setGatekeeperContext(value)}
                    placeholder={t('Default context')}
                    isDisabled={loading}
                    data-cy="external-automation-gatekeeper-context"
                  />
                </FormGroup>
              </StackItem>
            ) : null}
            {proxmoxProofEnabled ? (
              <StackItem>
                <FormGroup label={t('Live proof')} fieldId="external-automation-live-proof">
                  <Checkbox
                    id="external-automation-check-proxmox"
                    label={t('Proxmox VE')}
                    isChecked={proxmoxCheck}
                    onChange={(_event, checked) => setProxmoxCheck(checked)}
                    isDisabled={loading}
                    data-cy="external-automation-check-proxmox"
                  />
                </FormGroup>
              </StackItem>
            ) : null}
            {proxmoxProofEnabled && proxmoxCheck ? (
              <>
                <StackItem>
                  <FormGroup
                    label={t('Proxmox connection ID')}
                    fieldId="external-automation-proxmox-connection-id"
                  >
                    <TextInput
                      id="external-automation-proxmox-connection-id"
                      value={proxmoxConnectionId}
                      onChange={(_event, value) => setProxmoxConnectionId(value)}
                      placeholder={t('First accessible Proxmox connection')}
                      isDisabled={loading}
                      data-cy="external-automation-proxmox-connection-id"
                    />
                  </FormGroup>
                </StackItem>
                <StackItem>
                  <FormGroup
                    label={t('Expected Proxmox VMs')}
                    fieldId="external-automation-proxmox-expected-vms"
                  >
                    <TextInput
                      id="external-automation-proxmox-expected-vms"
                      value={proxmoxExpectedVms}
                      onChange={(_event, value) => setProxmoxExpectedVms(value)}
                      placeholder={t('eda-server, opa-gatekeeper, gatekeeper-policy-manager')}
                      isDisabled={loading}
                      data-cy="external-automation-proxmox-expected-vms"
                    />
                  </FormGroup>
                </StackItem>
              </>
            ) : null}
            <StackItem>
              <Button
                variant="secondary"
                icon={<SyncAltIcon />}
                onClick={() => void runSmoke()}
                isLoading={loading}
                isDisabled={loading}
                data-cy="external-automation-smoke-run-button"
              >
                {buttonLabel}
              </Button>
            </StackItem>
            {loading ? (
              <StackItem>
                <Spinner size="md" />
              </StackItem>
            ) : null}
            {error ? (
              <StackItem>
                <Alert variant="danger" isInline title={error} />
              </StackItem>
            ) : null}
            {result ? (
              <>
                <StackItem>
                  <Alert
                    variant={result.ok ? 'success' : 'danger'}
                    isInline
                    title={result.ok ? passedTitle : failedTitle}
                  />
                </StackItem>
                {gatekeeperNotConfigured ? (
                  <StackItem>
                    <Alert
                      variant="warning"
                      isInline
                      title={t('Gatekeeper Kubernetes API is not configured.')}
                    >
                      <Link
                        to={getPageUrl(AwxRoute.SettingsPolicyAsCode)}
                        data-cy="external-automation-policy-settings-link"
                      >
                        {t('Open Policy Connections settings')}
                      </Link>
                    </Alert>
                  </StackItem>
                ) : null}
                <StackItem>
                  <DescriptionList isHorizontal isCompact>
                    {includeEda ? (
                      <>
                        <DescriptionListGroup>
                          <DescriptionListTerm>{t('EDA')}</DescriptionListTerm>
                          <DescriptionListDescription>
                            <StatusLabel check={result.checks.eda} />
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                          <DescriptionListTerm>{t('EDA activations')}</DescriptionListTerm>
                          <DescriptionListDescription>
                            {result.checks.eda?.count ?? t('Not checked')}
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                      </>
                    ) : null}
                    {showOpaResult ? (
                      <>
                        <DescriptionListGroup>
                          <DescriptionListTerm>{t('OPA')}</DescriptionListTerm>
                          <DescriptionListDescription>
                            <StatusLabel check={result.checks.opa} />
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                          <DescriptionListTerm>{t('OPA allow')}</DescriptionListTerm>
                          <DescriptionListDescription>
                            {result.checks.opa?.allowed === true ? t('Allowed') : t('Not allowed')}
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                          <DescriptionListTerm>{t('OPA deny smoke')}</DescriptionListTerm>
                          <DescriptionListDescription>
                            {result.checks.opa?.deny_smoke?.status ?? t('Not checked')}
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                          <DescriptionListTerm>{t('OPA policy sync')}</DescriptionListTerm>
                          <DescriptionListDescription>
                            {result.checks.opa?.policy_sync?.status ?? t('Not checked')}
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                      </>
                    ) : null}
                    {showGatekeeperResult ? (
                      <>
                        <DescriptionListGroup>
                          <DescriptionListTerm>{t('Gatekeeper')}</DescriptionListTerm>
                          <DescriptionListDescription>
                            <StatusLabel check={result.checks.gatekeeper} />
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                          <DescriptionListTerm>{t('Gatekeeper context')}</DescriptionListTerm>
                          <DescriptionListDescription>
                            {result.checks.gatekeeper?.context ?? t('Not checked')}
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                          <DescriptionListTerm>{t('Gatekeeper resources')}</DescriptionListTerm>
                          <DescriptionListDescription>
                            {result.checks.gatekeeper?.counts
                              ? t(
                                  '{{templates}} templates, {{constraints}} constraints, {{violations}} violations, {{configs}} configs',
                                  {
                                    templates:
                                      result.checks.gatekeeper.counts.constraint_templates ?? 0,
                                    constraints: result.checks.gatekeeper.counts.constraints ?? 0,
                                    violations: result.checks.gatekeeper.counts.violations ?? 0,
                                    configs: result.checks.gatekeeper.counts.configs ?? 0,
                                  }
                                )
                              : t('Not checked')}
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                      </>
                    ) : null}
                    {showProxmoxResult ? (
                      <>
                        <DescriptionListGroup>
                          <DescriptionListTerm>{t('Proxmox VE')}</DescriptionListTerm>
                          <DescriptionListDescription>
                            <StatusLabel check={result.checks.proxmox} />
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                          <DescriptionListTerm>{t('Proxmox connection')}</DescriptionListTerm>
                          <DescriptionListDescription>
                            {result.checks.proxmox?.connection_name ||
                              result.checks.proxmox?.status ||
                              t('Not checked')}
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                          <DescriptionListTerm>{t('Proxmox resources')}</DescriptionListTerm>
                          <DescriptionListDescription>
                            {result.checks.proxmox?.counts
                              ? t(
                                  '{{nodes}} nodes, {{vms}} VMs, {{running}} running, {{containers}} containers, {{templates}} templates',
                                  {
                                    nodes: result.checks.proxmox.counts.nodes ?? 0,
                                    vms: result.checks.proxmox.counts.vms ?? 0,
                                    running: result.checks.proxmox.counts.running_vms ?? 0,
                                    containers: result.checks.proxmox.counts.containers ?? 0,
                                    templates: result.checks.proxmox.counts.templates ?? 0,
                                  }
                                )
                              : t('Not checked')}
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                          <DescriptionListTerm>{t('Expected VMs')}</DescriptionListTerm>
                          <DescriptionListDescription>
                            {result.checks.proxmox?.expected_vm_names?.length
                              ? t('{{found}} of {{total}} found', {
                                  found: result.checks.proxmox.expected_vms_found ?? 0,
                                  total: result.checks.proxmox.expected_vm_names.length,
                                })
                              : t('No expected VMs provided')}
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                      </>
                    ) : null}
                    <DescriptionListGroup>
                      <DescriptionListTerm>{t('Activity Stream ID')}</DescriptionListTerm>
                      <DescriptionListDescription>
                        {result.audit?.activity_stream_id ? (
                          <Link
                            to={getPageUrl(AwxRoute.ActivityStream, {
                              query: { id: result.audit.activity_stream_id },
                            })}
                            data-cy="external-automation-audit-link"
                          >
                            {result.audit.activity_stream_id}
                          </Link>
                        ) : (
                          t('Not recorded')
                        )}
                      </DescriptionListDescription>
                    </DescriptionListGroup>
                  </DescriptionList>
                </StackItem>
                <StackItem>
                  <Button
                    variant="secondary"
                    icon={<DownloadIcon />}
                    onClick={() =>
                      downloadEvidenceReport({
                        generated_at: new Date().toISOString(),
                        surface: title,
                        request: lastRunRequest,
                        result,
                      })
                    }
                    data-cy="external-automation-evidence-download-button"
                  >
                    {t('Download evidence')}
                  </Button>
                </StackItem>
                <StackItem>
                  <CodeBlock>
                    <CodeBlockCode>{JSON.stringify(result, null, 2)}</CodeBlockCode>
                  </CodeBlock>
                </StackItem>
              </>
            ) : null}
          </Stack>
        </CardBody>
      </Card>
    </PageSection>
  );
}
