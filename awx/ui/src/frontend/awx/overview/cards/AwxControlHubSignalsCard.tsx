/* eslint-disable i18next/no-literal-string */
import { CardBody, Label, Split, SplitItem, Stack, StackItem } from '@patternfly/react-core';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import { PageDashboardCard } from '../../../../framework/PageDashboard/PageDashboardCard';
import { PageDashboardChart } from '../../../../framework/PageDashboard/PageDashboardChart';
import { usePageChartColors } from '../../../../framework/PageDashboard/usePageChartColors';
import { useGetPageUrl } from '../../../../framework/PageNavigation/useGetPageUrl';
import { requestGet } from '../../../common/crud/Data';
import { AwxItemsResponse } from '../../common/AwxItemsResponse';
import { awxAPI } from '../../common/api/awx-utils';
import { AwxRoute } from '../../main/AwxRoutes';
import { IAwxDashboardData } from '../AwxOverview';

interface EDAStatus {
  configured: boolean;
  status: string;
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
  policies: { id: string; path: string }[];
}

interface GatekeeperStatus {
  configured: boolean;
  counts?: {
    constraint_templates: number;
    constraints: number;
    violations: number;
    filtered_violations: number;
    configs: number;
  };
}

interface GalaxyNGStatus {
  enabled: boolean;
  configured: boolean;
  controller_error: string;
  counts: {
    collections: number;
    repositories: number;
    tasks: number;
  };
}

interface QuayStatus {
  enabled: boolean;
  configured: boolean;
  controller_error: string;
  push_configured: boolean;
  counts: {
    repositories: number;
    tags: number;
  };
}

interface HubSignalRow {
  name: string;
  chartLabel: string;
  state: 'ready' | 'attention' | 'not-ready';
  signal: string;
  inventory: string;
  action: ReactNode;
  readyScore: number;
  attentionScore: number;
  inventoryScore: number;
}

function countResponseFallback<T>(): AwxItemsResponse<T> {
  return { count: 0, next: null, previous: null, results: [] };
}

function useSafeGet<T>(url: string, fallback: T) {
  return useSWR<T>(url, (requestUrl: string) => requestGet<T>(requestUrl).catch(() => fallback));
}

function HubSignalStatus(props: { state: HubSignalRow['state'] }) {
  const { t } = useTranslation();
  switch (props.state) {
    case 'ready':
      return <Label color="green">{t('Ready')}</Label>;
    case 'attention':
      return <Label color="orange">{t('Attention')}</Label>;
    default:
      return <Label color="grey">{t('Not configured')}</Label>;
  }
}

export function AwxControlHubSignalsCard(props: { data: IAwxDashboardData }) {
  const { data } = props;
  const { t } = useTranslation();
  const getPageUrl = useGetPageUrl();
  const routeUrl = (route: AwxRoute, fallback: string) => getPageUrl(route) || fallback;
  const { successfulColor, failedColor, canceledColor } = usePageChartColors();

  const eda = useSafeGet<EDAStatus>(awxAPI`/eda/status/`, {
    configured: false,
    status: 'not_configured',
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
  });
  const galaxy = useSafeGet<GalaxyNGStatus>(awxAPI`/galaxy_ng/status/`, {
    enabled: false,
    configured: false,
    controller_error: '',
    counts: {
      collections: 0,
      repositories: 0,
      tasks: 0,
    },
  });
  const quay = useSafeGet<QuayStatus>(awxAPI`/quay/status/`, {
    enabled: false,
    configured: false,
    controller_error: '',
    push_configured: false,
    counts: {
      repositories: 0,
      tags: 0,
    },
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

  const failedAutomation = (data.hosts?.failed ?? 0) + (data.projects?.failed ?? 0);
  const gatekeeperViolations =
    gatekeeper.data?.counts?.filtered_violations ?? gatekeeper.data?.counts?.violations ?? 0;
  const galaxyReady = Boolean(
    galaxy.data?.enabled && galaxy.data.configured && !galaxy.data.controller_error
  );
  const quayReady = Boolean(
    quay.data?.enabled && quay.data.configured && !quay.data.controller_error
  );
  const aiReady = Boolean(ai.data?.enabled && ai.data.configured);
  const edaReady = Boolean(eda.data?.configured);
  const cloudReady = (cloudConnections.data?.count ?? 0) > 0;
  const catalogReady = (catalogItems.data?.count ?? 0) > 0;
  const policyReady = Boolean(opa.data?.enabled || gatekeeper.data?.configured);

  const rows: HubSignalRow[] = [
    {
      name: t('Automation execution'),
      chartLabel: t('Auto'),
      state: failedAutomation > 0 ? 'attention' : 'ready',
      signal:
        failedAutomation > 0
          ? t('{{count}} failed host/project signals', { count: failedAutomation })
          : t('Hosts and projects are healthy'),
      inventory: t('{{templates}} templates / {{hosts}} hosts', {
        templates: data.job_templates?.total ?? 0,
        hosts: data.hosts?.total ?? 0,
      }),
      action: <Link to={routeUrl(AwxRoute.Jobs, '/jobs')}>{t('Review jobs')}</Link>,
      readyScore: failedAutomation > 0 ? 0 : 1,
      attentionScore: Math.min(failedAutomation, 5),
      inventoryScore: Math.min((data.job_templates?.total ?? 0) + (data.hosts?.total ?? 0), 10),
    },
    {
      name: t('Self-service catalog'),
      chartLabel: t('Catalog'),
      state: catalogReady ? 'ready' : 'not-ready',
      signal: catalogReady
        ? t('{{count}} requestable catalog items', { count: catalogItems.data?.count ?? 0 })
        : t('No catalog items available'),
      inventory: t('{{deployments}} deployments', {
        deployments: catalogDeployments.data?.count ?? 0,
      }),
      action: <Link to={routeUrl(AwxRoute.Catalog, '/catalog')}>{t('Browse catalog')}</Link>,
      readyScore: catalogReady ? 1 : 0,
      attentionScore: 0,
      inventoryScore: Math.min(
        (catalogItems.data?.count ?? 0) + (catalogDeployments.data?.count ?? 0),
        10
      ),
    },
    {
      name: t('Content supply chain'),
      chartLabel: t('Content'),
      state: galaxyReady || quayReady ? 'ready' : 'not-ready',
      signal: t('{{collections}} collections / {{repositories}} image repos', {
        collections: galaxy.data?.counts.collections ?? 0,
        repositories: quay.data?.counts.repositories ?? 0,
      }),
      inventory: quay.data?.push_configured ? t('Quay push ready') : t('Quay push not configured'),
      action: (
        <Link to={routeUrl(AwxRoute.GalaxyNGOverview, '/galaxy-ng/overview')}>
          {t('Open content')}
        </Link>
      ),
      readyScore: Number(galaxyReady) + Number(quayReady),
      attentionScore: quayReady && !quay.data?.push_configured ? 1 : 0,
      inventoryScore: Math.min(
        (galaxy.data?.counts.collections ?? 0) + (quay.data?.counts.repositories ?? 0),
        10
      ),
    },
    {
      name: t('Policy as Code'),
      chartLabel: t('Policy'),
      state: gatekeeperViolations > 0 ? 'attention' : policyReady ? 'ready' : 'not-ready',
      signal:
        gatekeeperViolations > 0
          ? t('{{count}} Gatekeeper violations', { count: gatekeeperViolations })
          : t('{{count}} OPA policy paths', { count: opa.data?.policies.length ?? 0 }),
      inventory: t('{{templates}} templates / {{constraints}} constraints', {
        templates: gatekeeper.data?.counts?.constraint_templates ?? 0,
        constraints: gatekeeper.data?.counts?.constraints ?? 0,
      }),
      action: (
        <Link to={routeUrl(AwxRoute.PolicyAsCodeOverview, '/policy-as-code')}>
          {t('Review policy')}
        </Link>
      ),
      readyScore: policyReady && gatekeeperViolations === 0 ? 1 : 0,
      attentionScore: Math.min(gatekeeperViolations, 5),
      inventoryScore: Math.min(
        (opa.data?.policies.length ?? 0) + (gatekeeper.data?.counts?.constraints ?? 0),
        10
      ),
    },
    {
      name: t('Event-driven decisions'),
      chartLabel: t('EDA'),
      state: edaReady ? 'ready' : 'not-ready',
      signal: edaReady ? t('EDA Controller connected') : t('EDA not configured'),
      inventory: t('{{activations}} activations', {
        activations: edaActivations.data?.count ?? 0,
      }),
      action: (
        <Link to={routeUrl(AwxRoute.EdaActivations, '/eda/activations')}>{t('Open EDA')}</Link>
      ),
      readyScore: edaReady ? 1 : 0,
      attentionScore: 0,
      inventoryScore: Math.min(edaActivations.data?.count ?? 0, 10),
    },
    {
      name: t('Cloud and AI fabric'),
      chartLabel: t('Cloud'),
      state: cloudReady && aiReady ? 'ready' : cloudReady || aiReady ? 'attention' : 'not-ready',
      signal: aiReady
        ? t('AI {{provider}} / {{model}}', {
            provider: ai.data?.provider || t('provider'),
            model: ai.data?.model || t('default model'),
          })
        : t('AI assistant not configured'),
      inventory: t('{{connections}} cloud connections', {
        connections: cloudConnections.data?.count ?? 0,
      }),
      action: (
        <Link to={routeUrl(AwxRoute.CloudConnections, '/cloud/connections')}>
          {t('Open cloud')}
        </Link>
      ),
      readyScore: Number(cloudReady) + Number(aiReady),
      attentionScore: cloudReady !== aiReady ? 1 : 0,
      inventoryScore: Math.min(cloudConnections.data?.count ?? 0, 10),
    },
  ];

  const chartValues = rows.map((row) => ({
    label: row.chartLabel,
    readyScore: row.readyScore,
    attentionScore: row.attentionScore,
    inventoryScore: row.inventoryScore,
  }));

  return (
    <PageDashboardCard
      id="awx-control-hub-signals"
      title={t('Control hub signals')}
      subtitle={t('Graph and table view of the systems AWX is coordinating.')}
      width="full"
      height="lg"
    >
      <CardBody>
        <Stack hasGutter>
          <StackItem data-cy="control-hub-signals-chart">
            <div style={{ minHeight: 260 }}>
              <PageDashboardChart
                yLabel={t('Signal score')}
                variant="lineChart"
                allowZero
                height={260}
                padding={{ right: 48 }}
                groups={[
                  {
                    label: t('Ready'),
                    color: successfulColor,
                    values: chartValues.map((value) => ({
                      label: value.label,
                      value: value.readyScore,
                    })),
                  },
                  {
                    label: t('Attention'),
                    color: failedColor,
                    values: chartValues.map((value) => ({
                      label: value.label,
                      value: value.attentionScore,
                    })),
                  },
                  {
                    label: t('Inventory'),
                    color: canceledColor,
                    values: chartValues.map((value) => ({
                      label: value.label,
                      value: value.inventoryScore,
                    })),
                  },
                ]}
              />
            </div>
          </StackItem>
          <StackItem>
            <Table
              aria-label={t('AWX control hub systems')}
              variant="compact"
              data-cy="control-hub-signals-table"
            >
              <Thead>
                <Tr>
                  <Th>{t('System')}</Th>
                  <Th>{t('State')}</Th>
                  <Th>{t('Signal')}</Th>
                  <Th>{t('Inventory')}</Th>
                  <Th>{t('Action')}</Th>
                </Tr>
              </Thead>
              <Tbody>
                {rows.map((row) => (
                  <Tr key={row.name} data-cy="control-hub-signals-row">
                    <Td dataLabel={t('System')}>{row.name}</Td>
                    <Td dataLabel={t('State')}>
                      <HubSignalStatus state={row.state} />
                    </Td>
                    <Td dataLabel={t('Signal')}>{row.signal}</Td>
                    <Td dataLabel={t('Inventory')}>{row.inventory}</Td>
                    <Td dataLabel={t('Action')}>
                      <Split hasGutter>
                        <SplitItem>{row.action}</SplitItem>
                      </Split>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </StackItem>
        </Stack>
      </CardBody>
    </PageDashboardCard>
  );
}
