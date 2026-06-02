import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  CodeBlock,
  CodeBlockCode,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Grid,
  GridItem,
  Label,
  PageSection,
  SearchInput,
  Spinner,
  Stack,
  StackItem,
} from '@patternfly/react-core';
import {
  CheckCircleIcon,
  DownloadIcon,
  ExclamationTriangleIcon,
  SyncAltIcon,
  TimesCircleIcon,
} from '@patternfly/react-icons';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGet } from '../../../common/crud/useGet';
import { AwxError } from '../../common/AwxError';
import { awxAPI } from '../../common/api/awx-utils';

type UnknownRecord = Record<string, unknown>;

interface GatekeeperPolicyManagerResponse {
  configured: boolean;
  message?: string;
  cluster: {
    server_url: string;
    context: string;
    verify_ssl: boolean;
  };
  api_versions?: {
    constraint_templates?: string;
    constraints?: string[];
    configs?: string;
  };
  counts: {
    constraint_templates: number;
    constraints: number;
    violations: number;
    configs: number;
  };
  constraint_templates: GatekeeperConstraintTemplate[];
  constraints: GatekeeperConstraint[];
  violations: GatekeeperViolation[];
  configs: GatekeeperConfig[];
  errors: GatekeeperError[];
}

interface GatekeeperConstraintTemplate {
  name: string;
  kind: string;
  api_version: string;
  created: boolean;
  observed_generation?: number;
  constraint_count: number;
  errors: unknown[];
  targets: {
    target: string;
    rego: string;
    libs: unknown[];
  }[];
  constraints: {
    kind: string;
    name: string;
  }[];
}

interface GatekeeperConstraint {
  kind: string;
  name: string;
  api_version: string;
  enforcement_action: string;
  match: UnknownRecord;
  parameters: UnknownRecord;
  total_violations: number;
  audit_timestamp: string;
  violations: unknown[];
}

interface GatekeeperViolation {
  constraint_kind: string;
  constraint_name: string;
  enforcement_action: string;
  message: string;
  resource_kind: string;
  resource_namespace: string;
  resource_name: string;
  resource_group: string;
  resource_version: string;
}

interface GatekeeperConfig {
  name: string;
  api_version: string;
  sync_only_count: number;
  sync_only: unknown[];
  match: unknown[];
  readiness_stats_enabled?: boolean;
}

interface GatekeeperError {
  resource: string;
  status_code?: number;
  detail: unknown;
  version?: string;
}

function EnforcementLabel(props: { action: string }) {
  const action = props.action || 'deny';
  const color = action === 'deny' ? 'red' : action === 'dryrun' ? 'orange' : 'grey';
  return <Label color={color}>{action}</Label>;
}

function StatusLabel(props: { ok: boolean; okText: string; failText: string }) {
  return props.ok ? (
    <Label color="green" icon={<CheckCircleIcon />}>
      {props.okText}
    </Label>
  ) : (
    <Label color="red" icon={<TimesCircleIcon />}>
      {props.failText}
    </Label>
  );
}

function jsonPreview(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

function downloadReport(data: GatekeeperPolicyManagerResponse) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'gatekeeper-policy-report.json';
  anchor.click();
  URL.revokeObjectURL(url);
}

function violationText(violation: GatekeeperViolation) {
  return [
    violation.constraint_kind,
    violation.constraint_name,
    violation.enforcement_action,
    violation.message,
    violation.resource_kind,
    violation.resource_namespace,
    violation.resource_name,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function GatekeeperPolicyManager() {
  const { t } = useTranslation();
  const [violationFilter, setViolationFilter] = useState('');
  const { data, isLoading, error, refresh } = useGet<GatekeeperPolicyManagerResponse>(
    awxAPI`/opa/gatekeeper/`
  );
  const normalizedViolationFilter = violationFilter.trim().toLowerCase();
  const violations = useMemo(() => {
    if (!data?.violations) return [];
    if (!normalizedViolationFilter) return data.violations;
    return data.violations.filter((violation) =>
      violationText(violation).includes(normalizedViolationFilter)
    );
  }, [data?.violations, normalizedViolationFilter]);

  if (error) return <AwxError error={error} handleRefresh={refresh} />;

  return (
    <PageSection isWidthLimited data-cy="gatekeeper-policy-manager">
      {isLoading || !data ? (
        <Spinner size="md" />
      ) : (
        <Stack hasGutter>
          {!data.configured ? (
            <StackItem>
              <Alert
                isInline
                variant="warning"
                title={t('Gatekeeper Kubernetes API is not configured.')}
              >
                {data.message}
              </Alert>
            </StackItem>
          ) : null}
          {data.errors.length > 0 ? (
            <StackItem>
              <Alert
                isInline
                variant="warning"
                title={t('{{count}} Gatekeeper resource reads returned errors.', {
                  count: data.errors.length,
                })}
              />
            </StackItem>
          ) : null}
          <StackItem>
            <Button
              variant="secondary"
              icon={<SyncAltIcon />}
              onClick={() => void refresh()}
              isDisabled={isLoading}
            >
              {t('Refresh')}
            </Button>{' '}
            <Button
              variant="secondary"
              icon={<DownloadIcon />}
              onClick={() => downloadReport(data)}
              isDisabled={!data.configured}
            >
              {t('Download report')}
            </Button>
          </StackItem>
          <StackItem>
            <Grid hasGutter>
              <GridItem span={6}>
                <Card isFlat>
                  <CardHeader>
                    <CardTitle>{t('Cluster')}</CardTitle>
                  </CardHeader>
                  <CardBody>
                    <DescriptionList isHorizontal isCompact>
                      <DescriptionListGroup>
                        <DescriptionListTerm>{t('Kubernetes API')}</DescriptionListTerm>
                        <DescriptionListDescription>
                          {data.cluster.server_url || t('Not configured')}
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                      <DescriptionListGroup>
                        <DescriptionListTerm>{t('Context')}</DescriptionListTerm>
                        <DescriptionListDescription>
                          {data.cluster.context || t('Default')}
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                      <DescriptionListGroup>
                        <DescriptionListTerm>{t('TLS verify')}</DescriptionListTerm>
                        <DescriptionListDescription>
                          {data.cluster.verify_ssl ? t('Enabled') : t('Disabled')}
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                    </DescriptionList>
                  </CardBody>
                </Card>
              </GridItem>
              <GridItem span={6}>
                <Card isFlat>
                  <CardHeader>
                    <CardTitle>{t('Inventory')}</CardTitle>
                  </CardHeader>
                  <CardBody>
                    <DescriptionList isHorizontal isCompact>
                      <DescriptionListGroup>
                        <DescriptionListTerm>{t('ConstraintTemplates')}</DescriptionListTerm>
                        <DescriptionListDescription>
                          {data.counts.constraint_templates}
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                      <DescriptionListGroup>
                        <DescriptionListTerm>{t('Constraints')}</DescriptionListTerm>
                        <DescriptionListDescription>
                          {data.counts.constraints}
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                      <DescriptionListGroup>
                        <DescriptionListTerm>{t('Violations')}</DescriptionListTerm>
                        <DescriptionListDescription>
                          {data.counts.violations}
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                      <DescriptionListGroup>
                        <DescriptionListTerm>{t('Config CRDs')}</DescriptionListTerm>
                        <DescriptionListDescription>
                          {data.counts.configs}
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                    </DescriptionList>
                  </CardBody>
                </Card>
              </GridItem>
            </Grid>
          </StackItem>
          <StackItem>
            <Card isFlat>
              <CardHeader>
                <CardTitle>{t('ConstraintTemplates')}</CardTitle>
              </CardHeader>
              <CardBody>
                <Stack hasGutter>
                  {data.constraint_templates.length === 0 ? (
                    <StackItem>{t('No ConstraintTemplates found.')}</StackItem>
                  ) : null}
                  {data.constraint_templates.map((template) => (
                    <StackItem key={template.name}>
                      <DescriptionList isHorizontal isCompact>
                        <DescriptionListGroup>
                          <DescriptionListTerm>{template.name}</DescriptionListTerm>
                          <DescriptionListDescription>
                            <StatusLabel
                              ok={template.created}
                              okText={template.kind || t('Created')}
                              failText={t('Not created')}
                            />{' '}
                            <Label color="blue">
                              {t('{{count}} constraints', { count: template.constraint_count })}
                            </Label>
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                          <DescriptionListTerm>{t('Targets')}</DescriptionListTerm>
                          <DescriptionListDescription>
                            {template.targets
                              .map((target) => target.target || t('Unknown'))
                              .join(', ') || t('None')}
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                      </DescriptionList>
                    </StackItem>
                  ))}
                </Stack>
              </CardBody>
            </Card>
          </StackItem>
          <StackItem>
            <Card isFlat>
              <CardHeader>
                <CardTitle>{t('Constraints')}</CardTitle>
              </CardHeader>
              <CardBody>
                <Stack hasGutter>
                  {data.constraints.length === 0 ? (
                    <StackItem>{t('No Constraints found.')}</StackItem>
                  ) : null}
                  {data.constraints.map((constraint) => (
                    <StackItem key={`${constraint.kind}/${constraint.name}`}>
                      <DescriptionList isHorizontal isCompact>
                        <DescriptionListGroup>
                          <DescriptionListTerm>
                            {constraint.kind}/{constraint.name}
                          </DescriptionListTerm>
                          <DescriptionListDescription>
                            <EnforcementLabel action={constraint.enforcement_action} />{' '}
                            <Label
                              color={constraint.total_violations > 0 ? 'red' : 'green'}
                              icon={
                                constraint.total_violations > 0 ? (
                                  <ExclamationTriangleIcon />
                                ) : (
                                  <CheckCircleIcon />
                                )
                              }
                            >
                              {t('{{count}} violations', { count: constraint.total_violations })}
                            </Label>
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                          <DescriptionListTerm>{t('Audit')}</DescriptionListTerm>
                          <DescriptionListDescription>
                            {constraint.audit_timestamp || t('Not reported')}
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                      </DescriptionList>
                    </StackItem>
                  ))}
                </Stack>
              </CardBody>
            </Card>
          </StackItem>
          <StackItem>
            <Card isFlat>
              <CardHeader>
                <CardTitle>{t('Violations')}</CardTitle>
              </CardHeader>
              <CardBody>
                <Stack hasGutter>
                  <StackItem>
                    <SearchInput
                      placeholder={t('Search violations')}
                      value={violationFilter}
                      onChange={(_event, value) => setViolationFilter(value)}
                      onClear={() => setViolationFilter('')}
                    />
                  </StackItem>
                  {violations.length === 0 ? (
                    <StackItem>{t('No violations found.')}</StackItem>
                  ) : null}
                  {violations.slice(0, 50).map((violation, index) => (
                    <StackItem
                      key={`${violation.constraint_kind}/${violation.constraint_name}/${index}`}
                    >
                      <DescriptionList isHorizontal isCompact>
                        <DescriptionListGroup>
                          <DescriptionListTerm>
                            {violation.resource_namespace
                              ? `${violation.resource_namespace}/${violation.resource_name}`
                              : violation.resource_name || t('Unknown resource')}
                          </DescriptionListTerm>
                          <DescriptionListDescription>
                            <EnforcementLabel action={violation.enforcement_action} />{' '}
                            {violation.resource_kind}
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                          <DescriptionListTerm>
                            {violation.constraint_kind}/{violation.constraint_name}
                          </DescriptionListTerm>
                          <DescriptionListDescription>
                            {violation.message}
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                      </DescriptionList>
                    </StackItem>
                  ))}
                </Stack>
              </CardBody>
            </Card>
          </StackItem>
          <StackItem>
            <Card isFlat>
              <CardHeader>
                <CardTitle>{t('Config CRDs')}</CardTitle>
              </CardHeader>
              <CardBody>
                <Stack hasGutter>
                  {data.configs.length === 0 ? (
                    <StackItem>{t('No Config CRDs found.')}</StackItem>
                  ) : null}
                  {data.configs.map((config) => (
                    <StackItem key={config.name}>
                      <DescriptionList isHorizontal isCompact>
                        <DescriptionListGroup>
                          <DescriptionListTerm>{config.name}</DescriptionListTerm>
                          <DescriptionListDescription>
                            {t('{{count}} synced kinds', { count: config.sync_only_count })}
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                          <DescriptionListTerm>{t('Readiness stats')}</DescriptionListTerm>
                          <DescriptionListDescription>
                            {config.readiness_stats_enabled ? t('Enabled') : t('Disabled')}
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                      </DescriptionList>
                      <CodeBlock>
                        <CodeBlockCode>{jsonPreview(config.sync_only)}</CodeBlockCode>
                      </CodeBlock>
                    </StackItem>
                  ))}
                </Stack>
              </CardBody>
            </Card>
          </StackItem>
        </Stack>
      )}
    </PageSection>
  );
}
