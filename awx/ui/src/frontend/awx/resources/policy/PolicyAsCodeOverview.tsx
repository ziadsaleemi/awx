import {
  Alert,
  CardBody,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Flex,
  FlexItem,
  Gallery,
  GalleryItem,
  Label,
  Spinner,
  Stack,
  StackItem,
  Text,
  TextContent,
  TextVariants,
  Title,
} from '@patternfly/react-core';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  OutlinedClockIcon,
  SecurityIcon,
  SyncAltIcon,
  TimesCircleIcon,
} from '@patternfly/react-icons';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useGetPageUrl } from '../../../../framework';
import { PageDashboard } from '../../../../framework/PageDashboard/PageDashboard';
import { PageDashboardCard } from '../../../../framework/PageDashboard/PageDashboardCard';
import { useGet } from '../../../common/crud/useGet';
import { awxAPI } from '../../common/api/awx-utils';
import { AwxRoute } from '../../main/AwxRoutes';

interface OPAPolicySummary {
  id: string;
  path: string;
  description?: string;
}

interface OPAStatusResponse {
  enabled: boolean;
  server_url: string;
  policies: OPAPolicySummary[];
  policy_bundle: {
    configured: boolean;
    size: number;
    line_count?: number;
    sha256?: string;
  };
}

interface GatekeeperOverviewResponse {
  configured: boolean;
  message?: string;
  contexts: {
    name: string;
    selected: boolean;
    configured: boolean;
  }[];
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
    filtered_violations: number;
    configs: number;
  };
  errors: unknown[];
}

interface ActivityStreamEntry {
  id?: number;
  timestamp?: string;
  operation?: string | null;
  object1?: string | null;
  object2?: string | null;
  object_type?: string;
  changes?: string;
}

interface ActivityStreamList {
  count: number;
  results: ActivityStreamEntry[];
}

function formatBytes(bytes?: number) {
  if (!bytes) return '0 bytes';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} bytes`;
}

function formatTimestamp(value?: string) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function activityLabel(entry: ActivityStreamEntry) {
  const target = entry.object2 || entry.object1 || entry.object_type || 'policy object';
  return `${entry.operation || 'change'} ${target}`;
}

function activitySearchText(entry: ActivityStreamEntry) {
  return `${entry.object1 ?? ''} ${entry.object2 ?? ''} ${entry.object_type ?? ''} ${
    entry.changes ?? ''
  }`.toLowerCase();
}

function mergePolicyActivity(
  opaResults: ActivityStreamEntry[] = [],
  gatekeeperResults: ActivityStreamEntry[] = []
) {
  const seen = new Set<number | string>();
  return [...opaResults, ...gatekeeperResults]
    .filter((entry, index) => {
      const text = activitySearchText(entry);
      if (!text.includes('opa') && !text.includes('gatekeeper')) return false;
      const key = entry.id ?? `${entry.timestamp ?? ''}-${entry.operation ?? ''}-${index}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const left = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const right = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return right - left;
    })
    .slice(0, 5);
}

function StatusLabel(props: {
  enabled: boolean;
  enabledText: string;
  disabledText: string;
  warning?: boolean;
}) {
  if (props.enabled) {
    return (
      <Label color={props.warning ? 'orange' : 'green'} icon={<CheckCircleIcon />}>
        {props.enabledText}
      </Label>
    );
  }
  return (
    <Label color="grey" icon={<TimesCircleIcon />}>
      {props.disabledText}
    </Label>
  );
}

function MetricTile(props: { label: string; value: string | number; detail?: string }) {
  return (
    <div
      data-cy="policy-metric-tile"
      style={{
        border: '1px solid var(--pf-v5-global--BorderColor--100)',
        minHeight: 120,
        minWidth: 0,
        padding: 16,
        width: '100%',
      }}
    >
      <Stack hasGutter>
        <StackItem>
          <Title
            headingLevel="h3"
            size="2xl"
            style={{
              lineHeight: 1.15,
              overflowWrap: 'anywhere',
              wordBreak: 'break-word',
            }}
          >
            {props.value}
          </Title>
        </StackItem>
        <StackItem>
          <TextContent>
            <Text component={TextVariants.small}>{props.label}</Text>
            {props.detail ? (
              <Text
                component={TextVariants.small}
                style={{ opacity: 0.75, overflowWrap: 'anywhere', wordBreak: 'break-word' }}
              >
                {props.detail}
              </Text>
            ) : null}
          </TextContent>
        </StackItem>
      </Stack>
    </div>
  );
}

function QuickLink(props: { to: string; label: string; description: string }) {
  return (
    <GalleryItem>
      <Stack hasGutter>
        <StackItem>
          <Link to={props.to}>{props.label}</Link>
        </StackItem>
        <StackItem>
          <TextContent>
            <Text component={TextVariants.small}>{props.description}</Text>
          </TextContent>
        </StackItem>
      </Stack>
    </GalleryItem>
  );
}

export function PolicyAsCodeOverview(props: {
  canManagePolicy: boolean;
  opaEnabled: boolean;
  gatekeeperEnabled: boolean;
}) {
  const { t } = useTranslation();
  const getPageUrl = useGetPageUrl();
  const opaStatus = useGet<OPAStatusResponse>(
    props.opaEnabled ? awxAPI`/opa/policies/` : undefined
  );
  const gatekeeperStatus = useGet<GatekeeperOverviewResponse>(
    props.gatekeeperEnabled ? awxAPI`/opa/gatekeeper/` : undefined
  );
  const opaActivity = useGet<ActivityStreamList>(
    props.canManagePolicy
      ? awxAPI`/activity_stream/?page_size=6&order_by=-timestamp&search=opa`
      : undefined
  );
  const gatekeeperActivity = useGet<ActivityStreamList>(
    props.canManagePolicy
      ? awxAPI`/activity_stream/?page_size=6&order_by=-timestamp&search=gatekeeper`
      : undefined
  );
  const activity = useMemo(
    () =>
      mergePolicyActivity(opaActivity.data?.results ?? [], gatekeeperActivity.data?.results ?? []),
    [gatekeeperActivity.data?.results, opaActivity.data?.results]
  );
  const pageUrl = (route: AwxRoute, fallback: string) => getPageUrl(route) || fallback;
  const opaConfigured = Boolean(opaStatus.data?.enabled);
  const gatekeeperConfigured = Boolean(gatekeeperStatus.data?.configured);
  const gatekeeperCounts = gatekeeperStatus.data?.counts;
  const selectedContext =
    gatekeeperStatus.data?.contexts.find((context) => context.selected)?.name ||
    gatekeeperStatus.data?.cluster.context ||
    t('Default');
  const gatekeeperWarningCount =
    (gatekeeperStatus.data?.errors.length ?? 0) + (gatekeeperCounts?.violations ?? 0);

  return (
    <PageDashboard sectionStyle={{ padding: 16 }}>
      <PageDashboardCard
        id="policy-control-plane"
        title={t('Policy control plane')}
        subtitle={t('OPA guardrails, Gatekeeper inventory, governed changes, and audit evidence')}
        width="full"
        height="sm"
        headerControls={
          <Flex
            spaceItems={{ default: 'spaceItemsSm' }}
            alignItems={{ default: 'alignItemsCenter' }}
          >
            <FlexItem>
              <StatusLabel
                enabled={opaConfigured}
                enabledText={t('OPA enabled')}
                disabledText={props.opaEnabled ? t('OPA not configured') : t('OPA disabled')}
              />
            </FlexItem>
            <FlexItem>
              <StatusLabel
                enabled={gatekeeperConfigured}
                enabledText={t('Gatekeeper connected')}
                disabledText={
                  props.gatekeeperEnabled
                    ? t('Gatekeeper not configured')
                    : t('Gatekeeper disabled')
                }
                warning={gatekeeperWarningCount > 0}
              />
            </FlexItem>
          </Flex>
        }
      >
        <CardBody>
          <div
            style={{
              display: 'grid',
              gap: 16,
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))',
              maxWidth: '100%',
            }}
          >
            <MetricTile
              label={t('OPA decision paths')}
              value={opaStatus.data?.policies.length ?? 0}
              detail={
                opaStatus.isLoading
                  ? t('Loading')
                  : opaStatus.error
                    ? t('Unavailable')
                    : opaStatus.data?.server_url || t('No server')
              }
            />
            <MetricTile
              label={t('Policy bundle')}
              value={
                opaStatus.data?.policy_bundle?.configured
                  ? formatBytes(opaStatus.data.policy_bundle.size)
                  : t('Not set')
              }
              detail={t('{{lines}} lines managed', {
                lines: opaStatus.data?.policy_bundle?.line_count ?? 0,
              })}
            />
            <MetricTile
              label={t('Gatekeeper context')}
              value={selectedContext}
              detail={
                gatekeeperStatus.isLoading
                  ? t('Loading')
                  : gatekeeperStatus.error
                    ? t('Unavailable')
                    : gatekeeperStatus.data?.cluster.server_url || t('No Kubernetes API')
              }
            />
            <MetricTile
              label={t('Violations')}
              value={gatekeeperCounts?.violations ?? 0}
              detail={t('{{count}} filtered in current view', {
                count: gatekeeperCounts?.filtered_violations ?? 0,
              })}
            />
            <MetricTile
              label={t('Config resources')}
              value={gatekeeperCounts?.configs ?? 0}
              detail={t('{{templates}} templates / {{constraints}} constraints', {
                templates: gatekeeperCounts?.constraint_templates ?? 0,
                constraints: gatekeeperCounts?.constraints ?? 0,
              })}
            />
          </div>
        </CardBody>
      </PageDashboardCard>

      <PageDashboardCard
        id="policy-opa-guardrails"
        title={t('OPA guardrails')}
        subtitle={t('Standalone policy decisions before AWX launches and AI actions')}
        width="half"
        height="sm"
        linkText={t('Open OPA')}
        to={pageUrl(AwxRoute.PolicyAsCodeOpaOverview, '/policy-as-code/opa/overview')}
      >
        <CardBody>
          {opaStatus.isLoading ? (
            <Spinner size="md" />
          ) : opaStatus.error ? (
            <Alert variant="warning" isInline title={t('Could not load OPA policy status.')} />
          ) : (
            <DescriptionList isHorizontal isCompact>
              <DescriptionListGroup>
                <DescriptionListTerm>{t('Server')}</DescriptionListTerm>
                <DescriptionListDescription>
                  {opaStatus.data?.server_url || t('Not configured')}
                </DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>{t('Enforcement')}</DescriptionListTerm>
                <DescriptionListDescription>
                  <StatusLabel
                    enabled={opaConfigured}
                    enabledText={t('Enabled')}
                    disabledText={t('Disabled')}
                  />
                </DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>{t('Decision paths')}</DescriptionListTerm>
                <DescriptionListDescription>
                  {opaStatus.data?.policies
                    .slice(0, 4)
                    .map((policy) => policy.path)
                    .join(', ') || t('No registered paths')}
                </DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>{t('Settings')}</DescriptionListTerm>
                <DescriptionListDescription>
                  <Link to={pageUrl(AwxRoute.SettingsOpa, '/settings/opa')}>
                    {t('Open OPA settings')}
                  </Link>
                </DescriptionListDescription>
              </DescriptionListGroup>
            </DescriptionList>
          )}
        </CardBody>
      </PageDashboardCard>

      <PageDashboardCard
        id="policy-gatekeeper-posture"
        title={t('Gatekeeper posture')}
        subtitle={t('Kubernetes admission policies visible to AWX')}
        width="half"
        height="sm"
        linkText={t('Open Gatekeeper')}
        to={pageUrl(AwxRoute.PolicyAsCodeGatekeeperOverview, '/policy-as-code/gatekeeper/overview')}
      >
        <CardBody>
          {gatekeeperStatus.isLoading ? (
            <Spinner size="md" />
          ) : gatekeeperStatus.error ? (
            <Alert variant="warning" isInline title={t('Could not load Gatekeeper status.')} />
          ) : (
            <DescriptionList isHorizontal isCompact>
              <DescriptionListGroup>
                <DescriptionListTerm>{t('Kubernetes API')}</DescriptionListTerm>
                <DescriptionListDescription>
                  {gatekeeperStatus.data?.cluster.server_url || t('Not configured')}
                </DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>{t('Templates')}</DescriptionListTerm>
                <DescriptionListDescription>
                  {gatekeeperCounts?.constraint_templates ?? 0}
                </DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>{t('Constraints')}</DescriptionListTerm>
                <DescriptionListDescription>
                  {gatekeeperCounts?.constraints ?? 0}
                </DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>{t('Read errors')}</DescriptionListTerm>
                <DescriptionListDescription>
                  {gatekeeperStatus.data?.errors.length ?? 0}
                </DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>{t('Settings')}</DescriptionListTerm>
                <DescriptionListDescription>
                  <Link to={pageUrl(AwxRoute.SettingsGatekeeper, '/settings/gatekeeper')}>
                    {t('Open Gatekeeper settings')}
                  </Link>
                </DescriptionListDescription>
              </DescriptionListGroup>
            </DescriptionList>
          )}
        </CardBody>
      </PageDashboardCard>

      <PageDashboardCard
        id="policy-governed-change-paths"
        title={t('Governed change paths')}
        subtitle={t('Where policy changes are previewed, applied, remediated, and audited')}
        width="half"
        height="sm"
      >
        <CardBody>
          <Gallery hasGutter minWidths={{ default: '220px' }}>
            <QuickLink
              to={pageUrl(
                AwxRoute.PolicyAsCodeGatekeeperChanges,
                '/policy-as-code/gatekeeper/changes'
              )}
              label={t('Gatekeeper governed changes')}
              description={t(
                'Author, project-sync, preview, dry-run, apply, delete, and rollback manifests.'
              )}
            />
            <QuickLink
              to={pageUrl(
                AwxRoute.PolicyAsCodeGatekeeperViolations,
                '/policy-as-code/gatekeeper/violations'
              )}
              label={t('Violation remediation')}
              description={t(
                'Review policy violations and generate AI-assisted safe remediation patches.'
              )}
            />
            <QuickLink
              to={pageUrl(AwxRoute.PolicyAsCodeOpaTester, '/policy-as-code/opa/tester')}
              label={t('Policy tester')}
              description={t(
                'Send sample inputs to live OPA decision paths before enabling rollout changes.'
              )}
            />
            <QuickLink
              to={pageUrl(AwxRoute.PolicyAsCodeOpaProjectSync, '/policy-as-code/opa/project-sync')}
              label={t('OPA project sync')}
              description={t('Pull Rego modules from AWX Project checkouts and sync them to OPA.')}
            />
            <QuickLink
              to={pageUrl(AwxRoute.ActivityStream, '/activity-stream')}
              label={t('Activity Stream')}
              description={t(
                'Audit policy module saves, Gatekeeper writes, rollbacks, and smoke evidence.'
              )}
            />
          </Gallery>
        </CardBody>
      </PageDashboardCard>

      <PageDashboardCard
        id="policy-resource-review"
        title={t('Resource review')}
        subtitle={t('Live Gatekeeper objects pulled from the configured Kubernetes context')}
        width="half"
        height="sm"
      >
        <CardBody>
          <Gallery hasGutter minWidths={{ default: '180px' }}>
            <QuickLink
              to={pageUrl(
                AwxRoute.PolicyAsCodeGatekeeperTemplates,
                '/policy-as-code/gatekeeper/templates'
              )}
              label={t('ConstraintTemplates')}
              description={t(
                'Review CRD-backed template schemas, target Rego, status, and constraints.'
              )}
            />
            <QuickLink
              to={pageUrl(
                AwxRoute.PolicyAsCodeGatekeeperConstraints,
                '/policy-as-code/gatekeeper/constraints'
              )}
              label={t('Constraints')}
              description={t(
                'Inspect enforcement actions, match rules, parameters, and violation counts.'
              )}
            />
            <QuickLink
              to={pageUrl(
                AwxRoute.PolicyAsCodeGatekeeperConfigs,
                '/policy-as-code/gatekeeper/configurations'
              )}
              label={t('Configurations')}
              description={t(
                'Check synced data and Gatekeeper config resources used by constraints.'
              )}
            />
            <QuickLink
              to={pageUrl(
                AwxRoute.PolicyAsCodeGatekeeperOverview,
                '/policy-as-code/gatekeeper/overview'
              )}
              label={t('Gatekeeper overview')}
              description={t(
                'Refresh cluster status, download a JSON report, and see API version coverage.'
              )}
            />
          </Gallery>
        </CardBody>
      </PageDashboardCard>

      <PageDashboardCard
        id="policy-recent-activity"
        title={t('Recent policy activity')}
        subtitle={t('Policy and Gatekeeper audit evidence from Activity Stream')}
        width="full"
        height="xs"
        linkText={t('View all activity')}
        to={pageUrl(AwxRoute.ActivityStream, '/activity-stream')}
      >
        <CardBody>
          {opaActivity.isLoading || gatekeeperActivity.isLoading ? (
            <Spinner size="md" />
          ) : opaActivity.error && gatekeeperActivity.error ? (
            <Alert variant="warning" isInline title={t('Could not load recent policy activity.')} />
          ) : activity.length ? (
            <Gallery hasGutter minWidths={{ default: '260px' }}>
              {activity.map((entry) => (
                <GalleryItem key={entry.id ?? `${entry.timestamp}-${entry.operation}`}>
                  <Flex
                    spaceItems={{ default: 'spaceItemsSm' }}
                    alignItems={{ default: 'alignItemsFlexStart' }}
                    flexWrap={{ default: 'nowrap' }}
                  >
                    <FlexItem>
                      {entry.operation === 'delete' ? (
                        <ExclamationTriangleIcon color="var(--pf-v5-global--danger-color--100)" />
                      ) : entry.operation === 'update' ? (
                        <SyncAltIcon color="var(--pf-v5-global--info-color--100)" />
                      ) : (
                        <SecurityIcon color="var(--pf-v5-global--success-color--100)" />
                      )}
                    </FlexItem>
                    <FlexItem grow={{ default: 'grow' }}>
                      <Stack>
                        <StackItem>
                          {entry.id ? (
                            <Link
                              to={
                                pageUrl(AwxRoute.ActivityStream, '/activity-stream') +
                                `?id=${entry.id}`
                              }
                            >
                              {activityLabel(entry)}
                            </Link>
                          ) : (
                            activityLabel(entry)
                          )}
                        </StackItem>
                        <StackItem>
                          <TextContent>
                            <Text component={TextVariants.small} style={{ opacity: 0.75 }}>
                              <OutlinedClockIcon /> {formatTimestamp(entry.timestamp)}
                            </Text>
                          </TextContent>
                        </StackItem>
                      </Stack>
                    </FlexItem>
                  </Flex>
                </GalleryItem>
              ))}
            </Gallery>
          ) : (
            <TextContent>
              <Text component={TextVariants.p}>
                {t('No recent OPA or Gatekeeper Activity Stream entries were found.')}
              </Text>
            </TextContent>
          )}
        </CardBody>
      </PageDashboardCard>
    </PageDashboard>
  );
}
