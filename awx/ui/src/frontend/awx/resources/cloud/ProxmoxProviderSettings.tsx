/* eslint-disable i18next/no-literal-string */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardTitle,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  EmptyState,
  EmptyStateBody,
  EmptyStateIcon,
  Grid,
  GridItem,
  Label,
  PageSection,
  Progress,
  ProgressMeasureLocation,
  Title,
} from '@patternfly/react-core';
import {
  CubesIcon,
  InfoCircleIcon,
  NetworkIcon,
  ServerIcon,
  StorageDomainIcon,
} from '@patternfly/react-icons';
import {
  ITableColumn,
  PageHeader,
  PageLayout,
  PageTable,
  PageTab,
  PageTabs,
  TextCell,
  useInMemoryView,
  usePageAlertToaster,
} from '../../../../framework';
import { isRequestError } from '../../../common/crud/RequestError';
import { postRequest } from '../../../common/crud/Data';
import { awxAPI } from '../../common/api/awx-utils';
import { EmptyStateUnauthorized } from '../../../../framework/components/EmptyStateUnauthorized';
import { useAwxActiveUser } from '../../common/useAwxActiveUser';
import {
  CloudConnectionEntry,
  ProxmoxContainer,
  ProxmoxNetwork,
  ProxmoxNode,
  ProxmoxProviderData,
  ProxmoxStorage,
  ProxmoxVM,
  getCloudConnections,
  getCloudProviderData,
  setCloudProviderData,
} from './cloudConnectionStore';
import ProxmoxLogo from '../../../assets/proxmox.svg';

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmtBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let n = bytes;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u++;
  }
  return `${n.toFixed(n >= 10 ? 0 : 1)} ${units[u]}`;
}

function fmtUptime(seconds: number): string {
  if (!seconds) return '-';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function getPct(used: number, total: number) {
  return total > 0 ? Math.round((used / total) * 100) : 0;
}

// ─── styled ──────────────────────────────────────────────────────────────────

const DarkCard = styled(Card)`
  background-color: #222428 !important;
  border: 1px solid var(--pf-v5-global--BorderColor--100) !important;
  box-shadow: var(--pf-v5-global--BoxShadow--sm) !important;
`;

const StatCard = styled(Card)`
  text-align: center;
  padding: 0.25rem 0;
  background-color: #2c2e33 !important;
  border: 1px solid var(--pf-v5-global--BorderColor--100) !important;
`;

// ─── sub-tabs ────────────────────────────────────────────────────────────────

function NodesTab(props: { nodes: ProxmoxNode[] }) {
  const { t } = useTranslation();
  const tableColumns = useMemo<ITableColumn<ProxmoxNode>[]>(
    () => [
      {
        header: t('Node'),
        cell: (n) => (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ServerIcon />
            <TextCell text={n.node} />
          </div>
        ),
        sort: 'node',
      },
      {
        header: t('Status'),
        cell: (n) =>
          n.status === 'online' ? (
            <Label color="green">{t('Online')}</Label>
          ) : (
            <Label color="red">{t('Offline')}</Label>
          ),
      },
      {
        header: t('CPUs'),
        cell: (n) => <TextCell text={String(n.maxcpu)} />,
      },
      {
        header: t('Memory'),
        cell: (n) => <TextCell text={fmtBytes(n.maxmem)} />,
      },
      {
        header: t('Disk'),
        cell: (n) => <TextCell text={fmtBytes(n.maxdisk)} />,
      },
      {
        header: t('Uptime'),
        cell: (n) => <TextCell text={fmtUptime(n.uptime)} />,
      },
    ],
    [t]
  );

  const view = useInMemoryView<ProxmoxNode>({
    keyFn: (n) => n.node,
    items: props.nodes,
    tableColumns,
  });

  return (
    <PageTable<ProxmoxNode>
      id="proxmox-nodes-table"
      tableColumns={tableColumns}
      errorStateTitle={t('Error loading nodes')}
      emptyStateTitle={t('No nodes discovered')}
      emptyStateDescription={t('Sync this connection to discover cluster nodes.')}
      disableListView
      disableCardView
      {...view}
    />
  );
}

function VMsTab(props: { vms: ProxmoxVM[] }) {
  const { t } = useTranslation();
  const tableColumns = useMemo<ITableColumn<ProxmoxVM>[]>(
    () => [
      {
        header: t('VMID'),
        cell: (vm) => <TextCell text={String(vm.vmid)} />,
        sort: 'vmid',
      },
      {
        header: t('Name'),
        cell: (vm) => <TextCell text={vm.name || '-'} />,
        sort: 'name',
      },
      {
        header: t('Node'),
        cell: (vm) => <TextCell text={vm.node} />,
        sort: 'node',
      },
      {
        header: t('Status'),
        cell: (vm) =>
          vm.status === 'running' ? (
            <Label color="green">{t('Running')}</Label>
          ) : vm.status === 'paused' ? (
            <Label color="orange">{t('Paused')}</Label>
          ) : (
            <Label color="grey">{t('Stopped')}</Label>
          ),
      },
      {
        header: t('vCPUs'),
        cell: (vm) => <TextCell text={String(vm.cpus)} />,
      },
      {
        header: t('Memory'),
        cell: (vm) => <TextCell text={fmtBytes(vm.maxmem)} />,
      },
      {
        header: t('Disk'),
        cell: (vm) => <TextCell text={fmtBytes(vm.maxdisk)} />,
      },
      {
        header: t('Uptime'),
        cell: (vm) => <TextCell text={fmtUptime(vm.uptime)} />,
      },
    ],
    [t]
  );

  const view = useInMemoryView<ProxmoxVM>({
    keyFn: (vm) => String(vm.vmid),
    items: props.vms,
    tableColumns,
  });

  return (
    <PageTable<ProxmoxVM>
      id="proxmox-vms-table"
      tableColumns={tableColumns}
      errorStateTitle={t('Error loading VMs')}
      emptyStateTitle={t('No virtual machines found')}
      emptyStateDescription={t('Sync this connection to discover KVM virtual machines.')}
      disableListView
      disableCardView
      {...view}
    />
  );
}

function ContainersTab(props: { containers: ProxmoxContainer[] }) {
  const { t } = useTranslation();
  const tableColumns = useMemo<ITableColumn<ProxmoxContainer>[]>(
    () => [
      {
        header: t('CT ID'),
        cell: (ct) => <TextCell text={String(ct.vmid)} />,
        sort: 'vmid',
      },
      {
        header: t('Name'),
        cell: (ct) => <TextCell text={ct.name || '-'} />,
        sort: 'name',
      },
      {
        header: t('Node'),
        cell: (ct) => <TextCell text={ct.node} />,
      },
      {
        header: t('Status'),
        cell: (ct) =>
          ct.status === 'running' ? (
            <Label color="green">{t('Running')}</Label>
          ) : (
            <Label color="grey">{t('Stopped')}</Label>
          ),
      },
      {
        header: t('vCPUs'),
        cell: (ct) => <TextCell text={String(ct.cpus)} />,
      },
      {
        header: t('Memory'),
        cell: (ct) => <TextCell text={fmtBytes(ct.maxmem)} />,
      },
      {
        header: t('Disk'),
        cell: (ct) => <TextCell text={fmtBytes(ct.maxdisk)} />,
      },
      {
        header: t('Uptime'),
        cell: (ct) => <TextCell text={fmtUptime(ct.uptime)} />,
      },
    ],
    [t]
  );

  const view = useInMemoryView<ProxmoxContainer>({
    keyFn: (ct) => String(ct.vmid),
    items: props.containers,
    tableColumns,
  });

  return (
    <PageTable<ProxmoxContainer>
      id="proxmox-containers-table"
      tableColumns={tableColumns}
      errorStateTitle={t('Error loading containers')}
      emptyStateTitle={t('No LXC containers found')}
      emptyStateDescription={t('Sync this connection to discover LXC containers.')}
      disableListView
      disableCardView
      {...view}
    />
  );
}

function StorageTab(props: { storage: ProxmoxStorage[] }) {
  const { t } = useTranslation();
  const tableColumns = useMemo<ITableColumn<ProxmoxStorage>[]>(
    () => [
      {
        header: t('Storage'),
        cell: (s) => (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <StorageDomainIcon />
            <TextCell text={s.storage} />
          </div>
        ),
        sort: 'storage',
      },
      {
        header: t('Type'),
        cell: (s) => <TextCell text={s.type} />,
        sort: 'type',
      },
      {
        header: t('Content'),
        cell: (s) => <TextCell text={s.content || '-'} />,
      },
      {
        header: t('Status'),
        cell: (s) =>
          s.status === 'active' ? (
            <Label color="green">{t('Active')}</Label>
          ) : (
            <Label color="red">{t('Inactive')}</Label>
          ),
      },
      {
        header: t('Available'),
        cell: (s) => <TextCell text={fmtBytes(s.avail)} />,
      },
      {
        header: t('Total'),
        cell: (s) => <TextCell text={fmtBytes(s.total)} />,
      },
      {
        header: t('Used %'),
        cell: (s) => {
          const pct = getPct(s.used, s.total);
          return (
            <div style={{ minWidth: 120 }}>
              <Progress
                value={pct}
                measureLocation={ProgressMeasureLocation.outside}
                aria-label={t('Storage used')}
                style={{ fontSize: '0.75rem' }}
              />
            </div>
          );
        },
      },
      {
        header: t('Shared'),
        cell: (s) =>
          s.shared ? (
            <Label color="blue">{t('Shared')}</Label>
          ) : (
            <Label color="grey">{t('Local')}</Label>
          ),
      },
    ],
    [t]
  );

  const view = useInMemoryView<ProxmoxStorage>({
    keyFn: (s) => s.storage,
    items: props.storage,
    tableColumns,
  });

  return (
    <PageTable<ProxmoxStorage>
      id="proxmox-storage-table"
      tableColumns={tableColumns}
      errorStateTitle={t('Error loading storage')}
      emptyStateTitle={t('No storage pools found')}
      emptyStateDescription={t('Sync this connection to discover storage pools.')}
      disableListView
      disableCardView
      {...view}
    />
  );
}

function NetworksTab(props: { networks: ProxmoxNetwork[] }) {
  const { t } = useTranslation();
  const tableColumns = useMemo<ITableColumn<ProxmoxNetwork>[]>(
    () => [
      {
        header: t('Interface'),
        cell: (n) => (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <NetworkIcon />
            <TextCell text={n.iface} />
          </div>
        ),
        sort: 'iface',
      },
      {
        header: t('Node'),
        cell: (n) => <TextCell text={n.node} />,
      },
      {
        header: t('Type'),
        cell: (n) => <Label color="blue">{n.type}</Label>,
        sort: 'type',
      },
      {
        header: t('Active'),
        cell: (n) =>
          n.active ? (
            <Label color="green">{t('Active')}</Label>
          ) : (
            <Label color="grey">{t('Inactive')}</Label>
          ),
      },
      {
        header: t('CIDR'),
        cell: (n) => <TextCell text={n.cidr || n.address || '-'} />,
      },
      {
        header: t('Bridge ports'),
        cell: (n) => <TextCell text={n.bridge_ports || '-'} />,
      },
      {
        header: t('Comment'),
        cell: (n) => <TextCell text={n.comments || '-'} />,
      },
    ],
    [t]
  );

  const view = useInMemoryView<ProxmoxNetwork>({
    keyFn: (n) => `${n.node}:${n.iface}`,
    items: props.networks,
    tableColumns,
  });

  return (
    <PageTable<ProxmoxNetwork>
      id="proxmox-networks-table"
      tableColumns={tableColumns}
      errorStateTitle={t('Error loading networks')}
      emptyStateTitle={t('No network interfaces found')}
      emptyStateDescription={t('Sync this connection to discover bridges and network interfaces.')}
      disableListView
      disableCardView
      {...view}
    />
  );
}

// ─── connection summary card ──────────────────────────────────────────────────

function ConnectionCard(props: { entry: CloudConnectionEntry; data: ProxmoxProviderData | null }) {
  const { t } = useTranslation();
  const { entry, data } = props;

  const nodeCount = data?.nodes?.length ?? 0;
  const vmCount = data?.vms?.length ?? 0;
  const ctCount = data?.containers?.length ?? 0;
  const stCount = data?.storage?.length ?? 0;

  return (
    <DarkCard style={{ height: '100%' }}>
      <CardBody
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          justifyContent: 'space-between',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            width: '100%',
            gap: 16,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <CardTitle style={{ marginBottom: '0.75rem', padding: 0 }}>{entry.name}</CardTitle>
            <DescriptionList isCompact style={{ wordBreak: 'break-word' }}>
              <DescriptionListGroup>
                <DescriptionListTerm>{t('Credential')}</DescriptionListTerm>
                <DescriptionListDescription>
                  {entry.credentialName || '-'}
                </DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup style={{ marginTop: '0.5rem' }}>
                <DescriptionListTerm>{t('Last synced')}</DescriptionListTerm>
                <DescriptionListDescription>
                  {data?.pulledAt ? new Date(data.pulledAt).toLocaleString() : t('Never')}
                </DescriptionListDescription>
              </DescriptionListGroup>
            </DescriptionList>
          </div>
          <div style={{ flexShrink: 0 }}>
            {entry.status === 'connected' ? (
              <Label color="green">{t('Connected')}</Label>
            ) : entry.status === 'misconfigured' ? (
              <Label color="orange">{t('Misconfigured')}</Label>
            ) : (
              <Label color="grey">{t('Disconnected')}</Label>
            )}
          </div>
        </div>

        {data && (
          <Grid hasGutter style={{ marginTop: '1.25rem' }}>
            {[
              { icon: <ServerIcon />, label: t('Nodes'), value: nodeCount },
              { icon: <CubesIcon />, label: t('VMs'), value: vmCount },
              { icon: <CubesIcon />, label: t('Containers'), value: ctCount },
              { icon: <StorageDomainIcon />, label: t('Storage'), value: stCount },
            ].map(({ icon, label, value }) => (
              <GridItem key={label} span={6}>
                <StatCard>
                  <CardBody style={{ padding: '0.75rem 0.5rem' }}>
                    <div style={{ color: 'var(--pf-v5-global--Color--200)', marginBottom: 4 }}>
                      {icon}
                    </div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{value}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--pf-v5-global--Color--200)' }}>
                      {label}
                    </div>
                  </CardBody>
                </StatCard>
              </GridItem>
            ))}
          </Grid>
        )}

        {entry.error && (
          <Alert
            isInline
            variant="danger"
            title={t('Connection error')}
            style={{ marginTop: '1rem' }}
          >
            {entry.error}
          </Alert>
        )}
      </CardBody>
    </DarkCard>
  );
}

// Helper to resolve connection data safely
function getConnectionData(
  entry: CloudConnectionEntry,
  rawProviderData: unknown
): ProxmoxProviderData | null {
  if (!rawProviderData) return null;

  if (typeof rawProviderData === 'object') {
    const dataObj = rawProviderData as Record<string, unknown>;

    if (entry.id in dataObj) {
      return dataObj[entry.id] as ProxmoxProviderData;
    }

    if (Array.isArray(rawProviderData)) {
      const arr = rawProviderData as Record<string, unknown>[];
      const found = arr.find(
        (d) =>
          d &&
          typeof d === 'object' &&
          (d.connectionId === entry.id || d.connection_id === entry.id)
      );
      if (found) return found as unknown as ProxmoxProviderData;
    }

    if (dataObj.connectionId === entry.id || dataObj.connection_id === entry.id) {
      return rawProviderData as ProxmoxProviderData;
    }
  }

  return null;
}

// Overview tab component
function OverviewTab(props: {
  connectionEntries: CloudConnectionEntry[];
  connectionDataMap: Record<string, ProxmoxProviderData>;
}) {
  const { t } = useTranslation();
  const { connectionEntries, connectionDataMap } = props;

  return (
    <PageSection style={{ overflowY: 'auto', flex: 1, padding: '1.5rem' }}>
      <div style={{ display: 'grid', gap: 24, maxWidth: 1200, margin: '0 auto' }}>
        {/* How it works banner */}
        <Alert
          isInline
          variant="info"
          title={t('How Proxmox VE credentials are used')}
          customIcon={<InfoCircleIcon />}
        >
          {t(
            'Each connected credential automatically injects Terraform variables (TF_VAR_pm_api_url, TF_VAR_pm_user, TF_VAR_pm_password / TF_VAR_pm_api_token_id, TF_VAR_pm_api_token_secret) into Terraform job templates that reference this provider. No manual variable configuration is needed per job.'
          )}
        </Alert>

        {/* Connection summary cards */}
        <div>
          <Title headingLevel="h3" size="md" style={{ marginBottom: '0.75rem' }}>
            {t('Connections')}
            <Badge style={{ marginLeft: 8 }}>{connectionEntries.length}</Badge>
          </Title>
          <Grid hasGutter>
            {connectionEntries.map((entry) => (
              <GridItem key={entry.id} sm={12} md={6} lg={4}>
                <ConnectionCard entry={entry} data={connectionDataMap[entry.id] || null} />
              </GridItem>
            ))}
          </Grid>
        </div>

        {/* Terraform variable reference */}
        <DarkCard>
          <CardBody>
            <CardTitle style={{ marginBottom: '1rem' }}>
              <ProxmoxLogo
                style={{ width: 20, height: 20, marginRight: 8, verticalAlign: 'middle' }}
              />
              {t('Terraform variable reference')}
            </CardTitle>
            <p
              style={{
                color: 'var(--pf-v5-global--Color--200)',
                marginBottom: '0.75rem',
                fontSize: '0.875rem',
              }}
            >
              {t(
                'The following environment variables are injected into Terraform job templates when a Proxmox VE connection is active. Use these in your Terraform provider configuration.'
              )}
            </p>
            <Grid hasGutter>
              {[
                {
                  variable: 'TF_VAR_pm_api_url',
                  description: t('Proxmox API endpoint, e.g. https://node:8006/api2/json'),
                },
                {
                  variable: 'TF_VAR_pm_user',
                  description: t('API user, e.g. root@pam (used with password auth)'),
                },
                {
                  variable: 'TF_VAR_pm_password',
                  description: t('API user password (used with password auth)'),
                },
                {
                  variable: 'TF_VAR_pm_api_token_id',
                  description: t('API token ID, e.g. user@pam!tokenid (used with token auth)'),
                },
                {
                  variable: 'TF_VAR_pm_api_token_secret',
                  description: t('API token secret UUID (used with token auth)'),
                },
                {
                  variable: 'TF_VAR_pm_tls_insecure',
                  description: t('Set true to disable TLS certificate verification'),
                },
              ].map(({ variable, description }) => (
                <GridItem key={variable} sm={12} md={6}>
                  <div
                    style={{
                      background: '#1b1c20',
                      border: '1px solid var(--pf-v5-global--BorderColor--100)',
                      borderRadius: 6,
                      padding: '0.6rem 0.8rem',
                    }}
                  >
                    <code
                      style={{
                        color: '#e57000',
                        fontSize: '0.8rem',
                        fontFamily: 'monospace',
                        display: 'block',
                        marginBottom: '0.2rem',
                      }}
                    >
                      {variable}
                    </code>
                    <span style={{ fontSize: '0.78rem', color: 'var(--pf-v5-global--Color--200)' }}>
                      {description}
                    </span>
                  </div>
                </GridItem>
              ))}
            </Grid>
          </CardBody>
        </DarkCard>
      </div>
    </PageSection>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export function ProxmoxProviderSettings() {
  const { t } = useTranslation();
  const { activeAwxUser } = useAwxActiveUser();
  const alertToaster = usePageAlertToaster();
  const [isPulling, setIsPulling] = useState(false);

  const canManageCloud =
    Boolean(activeAwxUser?.is_superuser) || Boolean(activeAwxUser?.is_system_auditor);

  const connectionEntries = useMemo(() => getCloudConnections()['proxmox'] ?? [], []);
  const connectedEntries = useMemo(
    () => connectionEntries.filter((e) => e.status === 'connected'),
    [connectionEntries]
  );

  // Load and map connection data
  const connectionDataMap = useMemo(() => {
    const map: Record<string, ProxmoxProviderData> = {};
    const raw = getCloudProviderData('proxmox');
    for (const entry of connectionEntries) {
      const data = getConnectionData(entry, raw);
      if (data) {
        map[entry.id] = data;
      }
    }
    return map;
  }, [connectionEntries]);

  // Aggregate data from all connected connections
  const allData = useMemo<ProxmoxProviderData>(() => {
    const aggregated: ProxmoxProviderData = {
      pulledAt: '',
      connectionId: '',
      nodes: [],
      vms: [],
      containers: [],
      storage: [],
      networks: [],
    };

    let latestPulledAt = 0;

    for (const entry of connectedEntries) {
      const data = connectionDataMap[entry.id];
      if (!data) continue;

      if (data.pulledAt) {
        const time = new Date(data.pulledAt).getTime();
        if (time > latestPulledAt) {
          latestPulledAt = time;
          aggregated.pulledAt = data.pulledAt;
        }
      }

      if (Array.isArray(data.nodes)) aggregated.nodes.push(...data.nodes);
      if (Array.isArray(data.vms)) aggregated.vms.push(...data.vms);
      if (Array.isArray(data.containers)) aggregated.containers.push(...data.containers);
      if (Array.isArray(data.storage)) aggregated.storage.push(...data.storage);
      if (Array.isArray(data.networks)) aggregated.networks.push(...data.networks);
    }

    return aggregated;
  }, [connectedEntries, connectionDataMap]);

  const onPull = async () => {
    const firstConnected = connectedEntries[0];
    if (!firstConnected?.credentialId) {
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Connect a Proxmox VE credential first.'),
      });
      return;
    }

    setIsPulling(true);
    try {
      const result = await postRequest<
        {
          pulled_at: string;
          node_count: number;
          vm_count: number;
          container_count: number;
          storage_count: number;
          network_count: number;
          nodes: ProxmoxNode[];
          vms: ProxmoxVM[];
          containers: ProxmoxContainer[];
          storage: ProxmoxStorage[];
          networks: ProxmoxNetwork[];
        },
        { credential_id: number }
      >(awxAPI`/catalog_cloud/connectors/proxmox/pull_resources/`, {
        credential_id: firstConnected.credentialId,
      });

      const newData: ProxmoxProviderData = {
        pulledAt: result.pulled_at,
        connectionId: firstConnected.id,
        nodes: result.nodes ?? [],
        vms: result.vms ?? [],
        containers: result.containers ?? [],
        storage: result.storage ?? [],
        networks: result.networks ?? [],
      };
      setCloudProviderData('proxmox', newData);
      alertToaster.addAlert({
        variant: 'success',
        title: t(
          'Pulled {{nodes}} nodes, {{vms}} VMs, {{containers}} containers, {{storage}} storage pools, {{networks}} interfaces.',
          {
            nodes: result.node_count ?? 0,
            vms: result.vm_count ?? 0,
            containers: result.container_count ?? 0,
            storage: result.storage_count ?? 0,
            networks: result.network_count ?? 0,
          }
        ),
      });
    } catch (err) {
      const detail =
        isRequestError(err) && err.details
          ? err.details
          : err instanceof Error
            ? err.message
            : String(err);
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Failed to pull Proxmox VE data'),
        children: detail,
      });
    } finally {
      setIsPulling(false);
    }
  };

  if (!canManageCloud) {
    return (
      <PageLayout>
        <PageHeader
          title={t('Proxmox VE')}
          description={t('Hypervisor cluster management for administrators.')}
        />
        <PageSection variant="light">
          <EmptyStateUnauthorized
            title={t('You do not have permission to manage cloud connections.')}
          />
        </PageSection>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <PageHeader
        title={t('Proxmox VE')}
        description={
          connectedEntries.length > 0
            ? t('{{n}} connection(s) active — hypervisor resources available for Terraform jobs.', {
                n: connectedEntries.length,
              })
            : t(
                'No active connections. Add and connect a Proxmox VE credential on the Cloud Connections page.'
              )
        }
        headerActions={
          connectedEntries.length > 0 ? (
            <Button
              variant="primary"
              onClick={() => void onPull()}
              isLoading={isPulling}
              isDisabled={isPulling}
            >
              {isPulling ? t('Pulling\u2026') : t('Pull data')}
            </Button>
          ) : undefined
        }
      />

      {connectionEntries.length === 0 ? (
        <PageSection>
          <EmptyState>
            <EmptyStateIcon icon={CubesIcon} />
            <Title headingLevel="h4" size="lg">
              {t('No Proxmox VE connections configured')}
            </Title>
            <EmptyStateBody>
              {t(
                'Go to Cloud Connections and add a Proxmox VE credential. Each connection maps to one Proxmox node or cluster endpoint.'
              )}
            </EmptyStateBody>
          </EmptyState>
        </PageSection>
      ) : (
        <PageTabs>
          <PageTab label={t('Overview')}>
            <OverviewTab
              connectionEntries={connectionEntries}
              connectionDataMap={connectionDataMap}
            />
          </PageTab>
          <PageTab
            label={t('Nodes') + (allData.nodes.length > 0 ? ` (${allData.nodes.length})` : '')}
          >
            <NodesTab nodes={allData.nodes} />
          </PageTab>
          <PageTab
            label={
              t('Virtual Machines') + (allData.vms.length > 0 ? ` (${allData.vms.length})` : '')
            }
          >
            <VMsTab vms={allData.vms} />
          </PageTab>
          <PageTab
            label={
              t('Containers (LXC)') +
              (allData.containers.length > 0 ? ` (${allData.containers.length})` : '')
            }
          >
            <ContainersTab containers={allData.containers} />
          </PageTab>
          <PageTab
            label={
              t('Storage') + (allData.storage.length > 0 ? ` (${allData.storage.length})` : '')
            }
          >
            <StorageTab storage={allData.storage} />
          </PageTab>
          <PageTab
            label={
              t('Networks') + (allData.networks.length > 0 ? ` (${allData.networks.length})` : '')
            }
          >
            <NetworksTab networks={allData.networks} />
          </PageTab>
        </PageTabs>
      )}
    </PageLayout>
  );
}
