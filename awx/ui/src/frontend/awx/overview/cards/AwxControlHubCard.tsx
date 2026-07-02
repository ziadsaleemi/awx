/* eslint-disable i18next/no-literal-string */
import {
  CardBody,
  Flex,
  FlexItem,
  Label,
  Stack,
  StackItem,
  Text,
  TextContent,
  TextVariants,
  Title,
} from '@patternfly/react-core';
import {
  AutomationIcon,
  BookIcon,
  CheckCircleIcon,
  CloudIcon,
  CubesIcon,
  RobotIcon,
  SecurityIcon,
  ServerIcon,
  ShieldAltIcon,
  TimesCircleIcon,
} from '@patternfly/react-icons';
import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import { PageDashboardCard } from '../../../../framework/PageDashboard/PageDashboardCard';
import { useGetPageUrl } from '../../../../framework/PageNavigation/useGetPageUrl';
import { requestGet } from '../../../common/crud/Data';
import { AwxItemsResponse } from '../../common/AwxItemsResponse';
import { awxAPI } from '../../common/api/awx-utils';
import { AwxRoute } from '../../main/AwxRoutes';
import { IAwxDashboardData } from '../AwxOverview';

interface EDAStatus {
  configured: boolean;
  status: string;
  controller_url: string;
}

interface AISettings {
  enabled: boolean;
  configured: boolean;
  provider: string;
  model: string;
  openai_codex_connected?: boolean;
}

interface OPAStatus {
  enabled: boolean;
  server_url: string;
  policies: { id: string; path: string }[];
  policy_bundle?: {
    configured: boolean;
    size: number;
    line_count?: number;
  };
}

interface GatekeeperStatus {
  configured: boolean;
  cluster?: {
    server_url: string;
    context: string;
  };
  counts?: {
    constraint_templates: number;
    constraints: number;
    violations: number;
    filtered_violations: number;
    configs: number;
  };
  errors?: unknown[];
}

interface GalaxyNGStatus {
  enabled: boolean;
  configured: boolean;
  status: string;
  server_url: string;
  controller_error: string;
  counts: {
    namespaces: number;
    collections: number;
    repositories: number;
    remotes: number;
    remote_registries: number;
    signature_keys: number;
    collection_approvals: number;
    tasks: number;
  };
}

interface QuayStatus {
  enabled: boolean;
  configured: boolean;
  status: string;
  server_url: string;
  namespace: string;
  controller_error: string;
  auth_configured: boolean;
  push_configured: boolean;
  counts: {
    repositories: number;
    tags: number;
  };
}

function useSafeGet<T>(url: string, fallback: T) {
  return useSWR<T>(url, (requestUrl: string) => requestGet<T>(requestUrl).catch(() => fallback));
}

function HubStatusLabel(props: {
  ok: boolean;
  enabledText: string;
  disabledText: string;
  enabledIcon?: ReactNode;
}) {
  return props.ok ? (
    <Label color="green" icon={props.enabledIcon ?? <CheckCircleIcon />}>
      {props.enabledText}
    </Label>
  ) : (
    <Label color="grey" icon={<TimesCircleIcon />}>
      {props.disabledText}
    </Label>
  );
}

function HubMetric(props: { label: string; value: ReactNode; detail?: ReactNode; to?: string }) {
  const content = (
    <Stack hasGutter>
      <StackItem>
        <Title
          headingLevel="h3"
          size="xl"
          style={{
            lineHeight: 1.2,
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
              style={{ marginTop: 4, opacity: 0.68, overflowWrap: 'anywhere' }}
            >
              {props.detail}
            </Text>
          ) : null}
        </TextContent>
      </StackItem>
    </Stack>
  );

  return (
    <div
      data-cy="control-hub-metric"
      style={{
        border: '1px solid var(--pf-v5-global--BorderColor--100)',
        minHeight: 124,
        minWidth: 0,
        padding: '14px 16px',
      }}
    >
      {props.to ? (
        <Link to={props.to} style={{ color: 'inherit', textDecoration: 'none' }}>
          {content}
        </Link>
      ) : (
        content
      )}
    </div>
  );
}

function HubModule(props: {
  title: string;
  description: string;
  icon: ReactNode;
  status: ReactNode;
  primary: string;
  secondary: string;
  links: { label: string; to: string }[];
}) {
  return (
    <div
      data-cy="control-hub-module"
      style={{
        borderTop: '1px solid var(--pf-v5-global--BorderColor--100)',
        minWidth: 0,
        paddingTop: 16,
      }}
    >
      <Stack hasGutter>
        <StackItem>
          <Flex
            alignItems={{ default: 'alignItemsCenter' }}
            spaceItems={{ default: 'spaceItemsSm' }}
            flexWrap={{ default: 'nowrap' }}
          >
            <FlexItem>
              <span style={{ color: 'var(--pf-v5-global--info-color--100)' }}>{props.icon}</span>
            </FlexItem>
            <FlexItem grow={{ default: 'grow' }} style={{ minWidth: 0 }}>
              <Title
                headingLevel="h3"
                size="md"
                style={{ lineHeight: 1.2, overflowWrap: 'anywhere' }}
              >
                {props.title}
              </Title>
              <Text component={TextVariants.small} style={{ opacity: 0.68 }}>
                {props.description}
              </Text>
            </FlexItem>
            <FlexItem>{props.status}</FlexItem>
          </Flex>
        </StackItem>
        <StackItem>
          <div
            style={{
              display: 'grid',
              gap: 12,
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            }}
          >
            <TextContent>
              <Text component={TextVariants.small} style={{ opacity: 0.68 }}>
                {props.primary}
              </Text>
            </TextContent>
            <TextContent>
              <Text component={TextVariants.small} style={{ opacity: 0.68 }}>
                {props.secondary}
              </Text>
            </TextContent>
          </div>
        </StackItem>
        <StackItem>
          <Flex spaceItems={{ default: 'spaceItemsMd' }} flexWrap={{ default: 'wrap' }}>
            {props.links.map((link) => (
              <FlexItem key={`${props.title}-${link.label}`}>
                <Link to={link.to}>{link.label}</Link>
              </FlexItem>
            ))}
          </Flex>
        </StackItem>
      </Stack>
    </div>
  );
}

function countResponseFallback<T>(): AwxItemsResponse<T> {
  return { count: 0, next: null, previous: null, results: [] };
}

function statusLabelText(status?: string) {
  return status ? status.replace(/_/g, ' ') : 'not configured';
}

export function AwxControlHubCard(props: { data: IAwxDashboardData }) {
  const { data } = props;
  const { t } = useTranslation();
  const getPageUrl = useGetPageUrl();
  const routeUrl = (route: AwxRoute, fallback: string) => getPageUrl(route) || fallback;

  const eda = useSafeGet<EDAStatus>(awxAPI`/eda/status/`, {
    configured: false,
    status: 'not_configured',
    controller_url: '',
  });
  const edaActivations = useSafeGet<AwxItemsResponse<unknown>>(
    awxAPI`/eda/activations/?page_size=1`,
    countResponseFallback()
  );
  const ai = useSafeGet<AISettings>(awxAPI`/ai/settings/`, {
    enabled: false,
    configured: false,
    provider: '',
    model: '',
  });
  const opa = useSafeGet<OPAStatus>(awxAPI`/opa/policies/`, {
    enabled: false,
    server_url: '',
    policies: [],
  });
  const gatekeeper = useSafeGet<GatekeeperStatus>(awxAPI`/opa/gatekeeper/`, {
    configured: false,
    counts: {
      constraint_templates: 0,
      constraints: 0,
      violations: 0,
      filtered_violations: 0,
      configs: 0,
    },
    errors: [],
  });
  const galaxy = useSafeGet<GalaxyNGStatus>(awxAPI`/galaxy_ng/status/`, {
    enabled: false,
    configured: false,
    status: 'not_configured',
    server_url: '',
    controller_error: '',
    counts: {
      namespaces: 0,
      collections: 0,
      repositories: 0,
      remotes: 0,
      remote_registries: 0,
      signature_keys: 0,
      collection_approvals: 0,
      tasks: 0,
    },
  });
  const quay = useSafeGet<QuayStatus>(awxAPI`/quay/status/`, {
    enabled: false,
    configured: false,
    status: 'not_configured',
    server_url: '',
    namespace: '',
    controller_error: '',
    auth_configured: false,
    push_configured: false,
    counts: { repositories: 0, tags: 0 },
  });
  const cloudConnections = useSafeGet<AwxItemsResponse<unknown>>(
    awxAPI`/catalog_cloud/connections/?page_size=1`,
    countResponseFallback()
  );
  const catalogItems = useSafeGet<AwxItemsResponse<unknown>>(
    awxAPI`/catalog_items/?page_size=1`,
    countResponseFallback()
  );
  const catalogDeployments = useSafeGet<AwxItemsResponse<unknown>>(
    awxAPI`/catalog_deployments/?page_size=1`,
    countResponseFallback()
  );

  const gatekeeperCounts = gatekeeper.data?.counts;
  const gatekeeperReady = Boolean(gatekeeper.data?.configured);
  const galaxyReady = Boolean(
    galaxy.data?.enabled && galaxy.data.configured && !galaxy.data.controller_error
  );
  const quayReady = Boolean(
    quay.data?.enabled && quay.data.configured && !quay.data.controller_error
  );
  const edaReady = Boolean(eda.data?.configured);
  const aiReady = Boolean(ai.data?.enabled && ai.data.configured);

  return (
    <PageDashboardCard
      id="awx-control-hub"
      title={t('AWX Control Hub')}
      subtitle={t(
        'Unified automation execution, policy, event-driven decisions, content, cloud, catalog, and AI status.'
      )}
      width="full"
      headerControls={
        <Flex spaceItems={{ default: 'spaceItemsSm' }} flexWrap={{ default: 'wrap' }}>
          <FlexItem>
            <HubStatusLabel
              ok={aiReady}
              enabledText={t('AI ready')}
              disabledText={t('AI not ready')}
            />
          </FlexItem>
          <FlexItem>
            <HubStatusLabel
              ok={edaReady}
              enabledText={t('EDA connected')}
              disabledText={t('EDA not connected')}
            />
          </FlexItem>
          <FlexItem>
            <HubStatusLabel
              ok={Boolean(opa.data?.enabled)}
              enabledText={t('OPA enabled')}
              disabledText={t('OPA disabled')}
              enabledIcon={<ShieldAltIcon />}
            />
          </FlexItem>
          <FlexItem>
            <HubStatusLabel
              ok={gatekeeperReady}
              enabledText={t('Gatekeeper connected')}
              disabledText={t('Gatekeeper not connected')}
              enabledIcon={<ShieldAltIcon />}
            />
          </FlexItem>
        </Flex>
      }
    >
      <CardBody>
        <Stack hasGutter>
          <StackItem>
            <div
              data-cy="control-hub-metrics"
              style={{
                display: 'grid',
                gap: 12,
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(210px, 100%), 1fr))',
              }}
            >
              <HubMetric
                label={t('Automation execution')}
                value={t('{{count}} templates', { count: data.job_templates?.total ?? 0 })}
                detail={t('{{hosts}} hosts / {{inventories}} inventories', {
                  hosts: data.hosts?.total ?? 0,
                  inventories: data.inventories?.total ?? 0,
                })}
                to={routeUrl(AwxRoute.Templates, '/templates')}
              />
              <HubMetric
                label={t('Self-service catalog')}
                value={t('{{count}} items', { count: catalogItems.data?.count ?? 0 })}
                detail={t('{{deployments}} deployments', {
                  deployments: catalogDeployments.data?.count ?? 0,
                })}
                to={routeUrl(AwxRoute.Catalog, '/catalog')}
              />
              <HubMetric
                label={t('Content supply chain')}
                value={t('{{collections}} collections', {
                  collections: galaxy.data?.counts.collections ?? 0,
                })}
                detail={t('{{repos}} image repositories', {
                  repos: quay.data?.counts.repositories ?? 0,
                })}
                to={routeUrl(AwxRoute.GalaxyNGOverview, '/galaxy-ng/overview')}
              />
              <HubMetric
                label={t('Policy control plane')}
                value={t('{{count}} policy paths', { count: opa.data?.policies.length ?? 0 })}
                detail={t('{{violations}} Gatekeeper violations', {
                  violations:
                    gatekeeperCounts?.filtered_violations ?? gatekeeperCounts?.violations ?? 0,
                })}
                to={routeUrl(AwxRoute.PolicyAsCodeOverview, '/policy-as-code')}
              />
              <HubMetric
                label={t('Event-driven decisions')}
                value={t('{{count}} activations', { count: edaActivations.data?.count ?? 0 })}
                detail={
                  edaReady ? t('EDA Controller connected') : t(statusLabelText(eda.data?.status))
                }
                to={routeUrl(AwxRoute.EdaActivations, '/eda/activations')}
              />
              <HubMetric
                label={t('Cloud and AI fabric')}
                value={t('{{count}} cloud connections', {
                  count: cloudConnections.data?.count ?? 0,
                })}
                detail={
                  aiReady
                    ? t('AI {{provider}} / {{model}}', {
                        provider: ai.data?.provider || t('provider'),
                        model: ai.data?.model || t('default model'),
                      })
                    : t('AI assistant not configured')
                }
                to={routeUrl(AwxRoute.CloudConnections, '/cloud/connections')}
              />
            </div>
          </StackItem>

          <StackItem>
            <div
              data-cy="control-hub-modules"
              style={{
                display: 'grid',
                gap: 20,
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(360px, 100%), 1fr))',
              }}
            >
              <HubModule
                icon={<AutomationIcon />}
                title={t('Automation execution')}
                description={t('Jobs, templates, inventories, hosts, and execution capacity.')}
                status={
                  <HubStatusLabel
                    ok={(data.hosts?.failed ?? 0) === 0 && (data.projects?.failed ?? 0) === 0}
                    enabledText={t('Healthy')}
                    disabledText={t('Needs attention')}
                  />
                }
                primary={t('{{jobs}} job templates', { jobs: data.job_templates?.total ?? 0 })}
                secondary={t('{{projects}} projects', { projects: data.projects?.total ?? 0 })}
                links={[
                  { label: t('Jobs'), to: routeUrl(AwxRoute.Jobs, '/jobs') },
                  { label: t('Templates'), to: routeUrl(AwxRoute.Templates, '/templates') },
                  { label: t('Inventories'), to: routeUrl(AwxRoute.Inventories, '/inventories') },
                  { label: t('Hosts'), to: routeUrl(AwxRoute.Hosts, '/hosts') },
                ]}
              />
              <HubModule
                icon={<BookIcon />}
                title={t('Content and registries')}
                description={t(
                  'Galaxy NG collections and Project Quay execution environment images.'
                )}
                status={
                  <HubStatusLabel
                    ok={galaxyReady || quayReady}
                    enabledText={t('Connected')}
                    disabledText={t('Not ready')}
                  />
                }
                primary={t('{{collections}} collections', {
                  collections: galaxy.data?.counts.collections ?? 0,
                })}
                secondary={t('{{repositories}} Quay repositories', {
                  repositories: quay.data?.counts.repositories ?? 0,
                })}
                links={[
                  {
                    label: t('Automation Hub'),
                    to: routeUrl(AwxRoute.GalaxyNGOverview, '/galaxy-ng/overview'),
                  },
                  { label: t('Project Quay'), to: routeUrl(AwxRoute.QuayOverview, '/quay') },
                  {
                    label: t('EE images'),
                    to: routeUrl(
                      AwxRoute.QuayExecutionEnvironmentImages,
                      '/quay/execution-environment-images'
                    ),
                  },
                ]}
              />
              <HubModule
                icon={<SecurityIcon />}
                title={t('Policy as Code')}
                description={t('OPA guardrails and Kubernetes Gatekeeper posture.')}
                status={
                  <HubStatusLabel
                    ok={Boolean(opa.data?.enabled) || gatekeeperReady}
                    enabledText={t('Enforced')}
                    disabledText={t('Not enforced')}
                  />
                }
                primary={t('{{policies}} OPA policies', {
                  policies: opa.data?.policies.length ?? 0,
                })}
                secondary={t('{{violations}} violations', {
                  violations:
                    gatekeeperCounts?.filtered_violations ?? gatekeeperCounts?.violations ?? 0,
                })}
                links={[
                  {
                    label: t('Policy overview'),
                    to: routeUrl(AwxRoute.PolicyAsCodeOverview, '/policy-as-code'),
                  },
                  {
                    label: t('OPA'),
                    to: routeUrl(AwxRoute.PolicyAsCodeOpaOverview, '/policy-as-code/opa/overview'),
                  },
                  {
                    label: t('Gatekeeper'),
                    to: routeUrl(
                      AwxRoute.PolicyAsCodeGatekeeperOverview,
                      '/policy-as-code/gatekeeper/overview'
                    ),
                  },
                ]}
              />
              <HubModule
                icon={<RobotIcon />}
                title={t('Event-driven automation')}
                description={t('EDA rulebook activations, projects, event streams, and RBAC sync.')}
                status={
                  <HubStatusLabel
                    ok={edaReady}
                    enabledText={t('Connected')}
                    disabledText={t('Not configured')}
                  />
                }
                primary={t('{{activations}} activations', {
                  activations: edaActivations.data?.count ?? 0,
                })}
                secondary={
                  edaReady
                    ? eda.data?.controller_url || t('Controller ready')
                    : t(statusLabelText(eda.data?.status))
                }
                links={[
                  {
                    label: t('Activations'),
                    to: routeUrl(AwxRoute.EdaActivations, '/eda/activations'),
                  },
                  { label: t('Rulebooks'), to: routeUrl(AwxRoute.EdaRulebooks, '/eda/rulebooks') },
                  {
                    label: t('Access sync'),
                    to: routeUrl(AwxRoute.EdaRbacSync, '/eda/access/sync'),
                  },
                ]}
              />
              <HubModule
                icon={<CloudIcon />}
                title={t('Cloud and catalog')}
                description={t(
                  'Provider connections, synced provider state, and requestable deployments.'
                )}
                status={
                  <HubStatusLabel
                    ok={
                      (cloudConnections.data?.count ?? 0) > 0 || (catalogItems.data?.count ?? 0) > 0
                    }
                    enabledText={t('Available')}
                    disabledText={t('No sources')}
                  />
                }
                primary={t('{{connections}} cloud connections', {
                  connections: cloudConnections.data?.count ?? 0,
                })}
                secondary={t('{{deployments}} catalog deployments', {
                  deployments: catalogDeployments.data?.count ?? 0,
                })}
                links={[
                  {
                    label: t('Cloud connections'),
                    to: routeUrl(AwxRoute.CloudConnections, '/cloud/connections'),
                  },
                  { label: t('Catalog browse'), to: routeUrl(AwxRoute.Catalog, '/catalog') },
                  {
                    label: t('My deployments'),
                    to: routeUrl(AwxRoute.CatalogDeployments, '/catalog/deployments'),
                  },
                ]}
              />
              <HubModule
                icon={<ServerIcon />}
                title={t('Platform services')}
                description={t(
                  'Execution nodes, credentials, users, organizations, and AI assistant context.'
                )}
                status={
                  <HubStatusLabel
                    ok={aiReady}
                    enabledText={t('AI ready')}
                    disabledText={t('AI not ready')}
                  />
                }
                primary={t('{{organizations}} organizations', {
                  organizations: data.organizations?.total ?? 0,
                })}
                secondary={t('{{users}} users / {{credentials}} credentials', {
                  users: data.users?.total ?? 0,
                  credentials: data.credentials?.total ?? 0,
                })}
                links={[
                  {
                    label: t('Instances'),
                    to: routeUrl(AwxRoute.Instances, '/infrastructure/instances'),
                  },
                  { label: t('Credentials'), to: routeUrl(AwxRoute.Credentials, '/credentials') },
                  {
                    label: t('AI settings'),
                    to: routeUrl(AwxRoute.SettingsAiAssistant, '/settings/ai-assistant'),
                  },
                ]}
              />
            </div>
          </StackItem>

          <StackItem>
            <Flex spaceItems={{ default: 'spaceItemsSm' }} flexWrap={{ default: 'wrap' }}>
              <FlexItem>
                <Label color="blue" icon={<CubesIcon />}>
                  {t('{{tasks}} Galaxy tasks', { tasks: galaxy.data?.counts.tasks ?? 0 })}
                </Label>
              </FlexItem>
              <FlexItem>
                <Label color={quay.data?.push_configured ? 'green' : 'grey'}>
                  {quay.data?.push_configured ? t('Quay push ready') : t('Quay push missing')}
                </Label>
              </FlexItem>
              <FlexItem>
                <Label color={ai.data?.openai_codex_connected ? 'green' : 'grey'}>
                  {ai.data?.openai_codex_connected
                    ? t('Codex device login connected')
                    : t('Codex device login not connected')}
                </Label>
              </FlexItem>
            </Flex>
          </StackItem>
        </Stack>
      </CardBody>
    </PageDashboardCard>
  );
}
