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
  EmptyState,
  EmptyStateBody,
  EmptyStateIcon,
  Grid,
  GridItem,
  Label,
  PageSection,
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
  VmwareCluster,
  VmwareDatacenter,
  VmwareDatastore,
  VmwareHost,
  VmwareNetwork,
  VmwareProviderData,
  VmwareVM,
  getCloudConnections,
  getCloudProviderData,
  setCloudProviderData,
} from './cloudConnectionStore';
import VmwareLogo from '../../../assets/vmware.svg';

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmtMiB(mib: number): string {
  if (!mib) return '0 MiB';
  if (mib >= 1024 * 1024) return `${(mib / 1024 / 1024).toFixed(1)} TiB`;
  if (mib >= 1024) return `${(mib / 1024).toFixed(1)} GiB`;
  return `${mib} MiB`;
}

// ─── styled ──────────────────────────────────────────────────────────────────

const DarkCard = styled(Card)`
  background-color: #222428 !important;
  border: 1px solid var(--pf-v5-global--BorderColor--100) !important;
  box-shadow: var(--pf-v5-global--BoxShadow--sm) !important;
`;

// ─── sub-tabs ────────────────────────────────────────────────────────────────

function VMsTab(props: { vms: VmwareVM[] }) {
  const { t } = useTranslation();
  const tableColumns = useMemo<ITableColumn<VmwareVM>[]>(
    () => [
      {
        header: t('Name'),
        cell: (vm) => (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CubesIcon />
            <TextCell text={vm.name} />
          </div>
        ),
        sort: 'name',
      },
      {
        header: t('Power State'),
        cell: (vm) => {
          const color =
            vm.power_state === 'POWERED_ON'
              ? 'green'
              : vm.power_state === 'SUSPENDED'
                ? 'orange'
                : 'red';
          return <Label color={color}>{vm.power_state}</Label>;
        },
      },
      {
        header: t('CPUs'),
        cell: (vm) => <TextCell text={String(vm.cpu_count)} />,
      },
      {
        header: t('Memory'),
        cell: (vm) => <TextCell text={fmtMiB(vm.memory_size_mib)} />,
      },
      {
        header: t('ID'),
        cell: (vm) => <TextCell text={vm.id} />,
      },
    ],
    [t]
  );

  const view = useInMemoryView<VmwareVM>({
    keyFn: (vm) => vm.id,
    items: props.vms,
    tableColumns,
  });

  return (
    <PageTable<VmwareVM>
      id="vmware-vms-table"
      tableColumns={tableColumns}
      errorStateTitle={t('Error loading virtual machines')}
      emptyStateTitle={t('No virtual machines found')}
      emptyStateDescription={t('Pull data from vCenter to discover virtual machines.')}
      disableListView
      disableCardView
      {...view}
    />
  );
}

function HostsTab(props: { hosts: VmwareHost[] }) {
  const { t } = useTranslation();
  const tableColumns = useMemo<ITableColumn<VmwareHost>[]>(
    () => [
      {
        header: t('Name'),
        cell: (h) => (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ServerIcon />
            <TextCell text={h.name} />
          </div>
        ),
        sort: 'name',
      },
      {
        header: t('Power State'),
        cell: (h) => {
          const color = h.power_state === 'POWERED_ON' ? 'green' : 'grey';
          return <Label color={color}>{h.power_state}</Label>;
        },
      },
      {
        header: t('Connection State'),
        cell: (h) => {
          const color = h.connection_state === 'CONNECTED' ? 'green' : 'red';
          return <Label color={color}>{h.connection_state}</Label>;
        },
      },
      {
        header: t('CPUs'),
        cell: (h) => <TextCell text={h.cpu_count != null ? String(h.cpu_count) : '-'} />,
      },
      {
        header: t('Memory'),
        cell: (h) => <TextCell text={h.memory_size_mib != null ? fmtMiB(h.memory_size_mib) : '-'} />,
      },
      {
        header: t('ID'),
        cell: (h) => <TextCell text={h.id} />,
      },
    ],
    [t]
  );

  const view = useInMemoryView<VmwareHost>({
    keyFn: (h) => h.id,
    items: props.hosts,
    tableColumns,
  });

  return (
    <PageTable<VmwareHost>
      id="vmware-hosts-table"
      tableColumns={tableColumns}
      errorStateTitle={t('Error loading hosts')}
      emptyStateTitle={t('No hosts found')}
      emptyStateDescription={t('Pull data from vCenter to discover ESXi hosts.')}
      disableListView
      disableCardView
      {...view}
    />
  );
}

function DatastoresTab(props: { datastores: VmwareDatastore[] }) {
  const { t } = useTranslation();
  const tableColumns = useMemo<ITableColumn<VmwareDatastore>[]>(
    () => [
      {
        header: t('Name'),
        cell: (ds) => (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <StorageDomainIcon />
            <TextCell text={ds.name} />
          </div>
        ),
        sort: 'name',
      },
      {
        header: t('Type'),
        cell: (ds) => <Label color="blue">{ds.type}</Label>,
      },
      {
        header: t('Accessible'),
        cell: (ds) =>
          ds.accessible ? (
            <Label color="green">{t('Yes')}</Label>
          ) : (
            <Label color="red">{t('No')}</Label>
          ),
      },
      {
        header: t('Capacity'),
        cell: (ds) => <TextCell text={fmtMiB(ds.capacity_mb)} />,
      },
      {
        header: t('Free Space'),
        cell: (ds) => <TextCell text={fmtMiB(ds.free_space_mb)} />,
      },
    ],
    [t]
  );

  const view = useInMemoryView<VmwareDatastore>({
    keyFn: (ds) => ds.id,
    items: props.datastores,
    tableColumns,
  });

  return (
    <PageTable<VmwareDatastore>
      id="vmware-datastores-table"
      tableColumns={tableColumns}
      errorStateTitle={t('Error loading datastores')}
      emptyStateTitle={t('No datastores found')}
      emptyStateDescription={t('Pull data from vCenter to discover datastores.')}
      disableListView
      disableCardView
      {...view}
    />
  );
}

function NetworksTab(props: { networks: VmwareNetwork[] }) {
  const { t } = useTranslation();
  const tableColumns = useMemo<ITableColumn<VmwareNetwork>[]>(
    () => [
      {
        header: t('Name'),
        cell: (n) => (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <NetworkIcon />
            <TextCell text={n.name} />
          </div>
        ),
        sort: 'name',
      },
      {
        header: t('Type'),
        cell: (n) => <Label color="purple">{n.type}</Label>,
      },
      {
        header: t('ID'),
        cell: (n) => <TextCell text={n.id} />,
      },
    ],
    [t]
  );

  const view = useInMemoryView<VmwareNetwork>({
    keyFn: (n) => n.id,
    items: props.networks,
    tableColumns,
  });

  return (
    <PageTable<VmwareNetwork>
      id="vmware-networks-table"
      tableColumns={tableColumns}
      errorStateTitle={t('Error loading networks')}
      emptyStateTitle={t('No networks found')}
      emptyStateDescription={t('Pull data from vCenter to discover networks and port groups.')}
      disableListView
      disableCardView
      {...view}
    />
  );
}

function DatacentersTab(props: { datacenters: VmwareDatacenter[]; clusters: VmwareCluster[] }) {
  const { t } = useTranslation();
  const tableColumns = useMemo<ITableColumn<VmwareDatacenter>[]>(
    () => [
      {
        header: t('Name'),
        cell: (dc) => <TextCell text={dc.name} />,
        sort: 'name',
      },
      {
        header: t('Clusters'),
        cell: (dc) => {
          const count = props.clusters.filter((c) => c.datacenter_id === dc.id).length;
          return <TextCell text={String(count)} />;
        },
      },
      {
        header: t('ID'),
        cell: (dc) => <TextCell text={dc.id} />,
      },
    ],
    [t, props.clusters]
  );

  const view = useInMemoryView<VmwareDatacenter>({
    keyFn: (dc) => dc.id,
    items: props.datacenters,
    tableColumns,
  });

  return (
    <PageTable<VmwareDatacenter>
      id="vmware-datacenters-table"
      tableColumns={tableColumns}
      errorStateTitle={t('Error loading datacenters')}
      emptyStateTitle={t('No datacenters found')}
      emptyStateDescription={t('Pull data from vCenter to discover datacenters.')}
      disableListView
      disableCardView
      {...view}
    />
  );
}

// ─── connection summary card ──────────────────────────────────────────────────

function ConnectionCard(props: { entry: CloudConnectionEntry; data: VmwareProviderData | null }) {
  const { t } = useTranslation();
  const { entry, data } = props;

  const vmCount = data?.vms?.length ?? 0;
  const hostCount = data?.hosts?.length ?? 0;
  const dsCount = data?.datastores?.length ?? 0;
  const netCount = data?.networks?.length ?? 0;

  return (
    <DarkCard style={{ height: '100%', borderRadius: 8 }}>
      <CardBody
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          padding: '1.25rem',
          gap: 16,
        }}
      >
        {/* Header line */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ServerIcon style={{ color: '#1D6FA5', fontSize: '1.1rem' }} />
            <span style={{ fontWeight: 600, fontSize: '1.05rem', color: '#fff' }}>
              {entry.name}
            </span>
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

        {/* Credential info panel */}
        <div
          style={{
            background: '#1b1c20',
            borderRadius: 6,
            padding: '0.75rem',
            border: '1px solid var(--pf-v5-global--BorderColor--100)',
          }}
        >
          <div style={{ fontSize: '0.78rem', color: 'var(--pf-v5-global--Color--200)' }}>
            {t('Credential ID')}: <strong style={{ color: '#fff' }}>{entry.credentialId ?? '-'}</strong>
          </div>
          {data?.pulledAt && (
            <div style={{ fontSize: '0.78rem', color: 'var(--pf-v5-global--Color--200)', marginTop: 4 }}>
              {t('Last pull')}: <strong style={{ color: '#fff' }}>{new Date(data.pulledAt).toLocaleString()}</strong>
            </div>
          )}
        </div>

        {/* Resource counts */}
        {data && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--pf-v5-global--Color--200)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {t('Discovered Resources')}
            </div>
            <Grid hasGutter>
              {[
                { icon: <CubesIcon style={{ color: '#2b9af3' }} />, label: t('VMs'), value: vmCount },
                { icon: <ServerIcon style={{ color: '#39a5dc' }} />, label: t('Hosts'), value: hostCount },
                { icon: <StorageDomainIcon style={{ color: '#f0ab00' }} />, label: t('Datastores'), value: dsCount },
                { icon: <NetworkIcon style={{ color: '#4cb140' }} />, label: t('Networks'), value: netCount },
              ].map(({ icon, label, value }) => (
                <GridItem key={label} span={6}>
                  <div
                    style={{
                      background: '#2c2e33',
                      border: '1px solid var(--pf-v5-global--BorderColor--100)',
                      borderRadius: 6,
                      padding: '0.5rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                    }}
                  >
                    {icon}
                    <div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#fff', lineHeight: 1.1 }}>
                        {value}
                      </div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--pf-v5-global--Color--200)' }}>
                        {label}
                      </div>
                    </div>
                  </div>
                </GridItem>
              ))}
            </Grid>
          </div>
        )}

        {entry.error && (
          <Alert
            isInline
            variant="danger"
            title={t('Connection error')}
            style={{ marginTop: 'auto', fontSize: '0.8rem' }}
          >
            {entry.error}
          </Alert>
        )}
      </CardBody>
    </DarkCard>
  );
}

// ─── helper: resolve connection data ─────────────────────────────────────────

function getConnectionData(
  entry: CloudConnectionEntry,
  rawProviderData: unknown
): VmwareProviderData | null {
  if (!rawProviderData) return null;

  if (typeof rawProviderData === 'object') {
    const dataObj = rawProviderData as Record<string, unknown>;

    if (entry.id in dataObj) return dataObj[entry.id] as VmwareProviderData;

    if (!Array.isArray(rawProviderData)) {
      if (dataObj.connectionId === entry.id || dataObj.connection_id === entry.id) {
        return rawProviderData as VmwareProviderData;
      }
    }
  }

  return null;
}

// ─── overview tab ─────────────────────────────────────────────────────────────

function OverviewTab(props: {
  connectionEntries: CloudConnectionEntry[];
  connectionDataMap: Record<string, VmwareProviderData>;
}) {
  const { t } = useTranslation();
  const { connectionEntries, connectionDataMap } = props;

  return (
    <PageSection style={{ overflowY: 'auto', flex: 1, padding: '1.5rem' }}>
      <Grid hasGutter style={{ maxWidth: 1400, margin: '0 auto' }}>
        {/* Connections */}
        <GridItem sm={12} lg={8} xl={9}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Title headingLevel="h3" size="md" style={{ color: '#fff', fontWeight: 600 }}>
              {t('Active Connections')}
              <Badge style={{ marginLeft: 8, background: '#1D6FA5', color: '#fff' }}>
                {connectionEntries.length}
              </Badge>
            </Title>
            <Grid hasGutter>
              {connectionEntries.map((entry) => (
                <GridItem key={entry.id} sm={12} md={6} xl={4}>
                  <ConnectionCard entry={entry} data={connectionDataMap[entry.id] || null} />
                </GridItem>
              ))}
            </Grid>
          </div>
        </GridItem>

        {/* Sidebar info */}
        <GridItem sm={12} lg={4} xl={3}>
          <DarkCard>
            <CardBody style={{ padding: '1.25rem' }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <InfoCircleIcon
                  style={{ color: '#1D6FA5', fontSize: '1.2rem', marginTop: 2, flexShrink: 0 }}
                />
                <div>
                  <h4 style={{ fontWeight: 600, fontSize: '0.9rem', color: '#fff', marginBottom: 6 }}>
                    {t('VMware vSphere credentials')}
                  </h4>
                  <p style={{ fontSize: '0.8rem', color: 'var(--pf-v5-global--Color--200)', lineHeight: 1.5 }}>
                    {t(
                      'Connect a VMware vSphere credential (host, username, password) on the Cloud Connections page. Pull data to inventory VMs, hosts, datastores, and networks from vCenter.'
                    )}
                  </p>
                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {[
                      { variable: 'TF_VAR_vsphere_server', description: t('vCenter server hostname / IP') },
                      { variable: 'TF_VAR_vsphere_user', description: t('vCenter username') },
                      { variable: 'TF_VAR_vsphere_password', description: t('vCenter password') },
                    ].map(({ variable, description }) => (
                      <div
                        key={variable}
                        style={{
                          background: '#1b1c20',
                          border: '1px solid var(--pf-v5-global--BorderColor--100)',
                          borderRadius: 6,
                          padding: '0.6rem 0.75rem',
                        }}
                      >
                        <code style={{ color: '#1D6FA5', fontSize: '0.75rem', fontFamily: 'monospace', display: 'block', marginBottom: '0.15rem' }}>
                          {variable}
                        </code>
                        <span style={{ fontSize: '0.7rem', color: 'var(--pf-v5-global--Color--200)', lineHeight: 1.3, display: 'block' }}>
                          {description}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardBody>
          </DarkCard>
        </GridItem>
      </Grid>
    </PageSection>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export function VmwareProviderSettings() {
  const { t } = useTranslation();
  const { activeAwxUser } = useAwxActiveUser();
  const alertToaster = usePageAlertToaster();
  const [isPulling, setIsPulling] = useState(false);

  const canManageCloud =
    Boolean(activeAwxUser?.is_superuser) || Boolean(activeAwxUser?.is_system_auditor);

  const connectionEntries = useMemo(() => getCloudConnections()['vmware'] ?? [], []);
  const connectedEntries = useMemo(
    () => connectionEntries.filter((e) => e.status === 'connected'),
    [connectionEntries]
  );

  const connectionDataMap = useMemo(() => {
    const map: Record<string, VmwareProviderData> = {};
    const raw = getCloudProviderData('vmware');
    for (const entry of connectionEntries) {
      const data = getConnectionData(entry, raw);
      if (data) map[entry.id] = data;
    }
    return map;
  }, [connectionEntries]);

  // Aggregate data across all connected entries
  const allData = useMemo<VmwareProviderData>(() => {
    const agg: VmwareProviderData = {
      pulledAt: '',
      connectionId: '',
      datacenters: [],
      clusters: [],
      hosts: [],
      vms: [],
      networks: [],
      datastores: [],
    };

    let latestPulledAt = 0;
    for (const entry of connectedEntries) {
      const data = connectionDataMap[entry.id];
      if (!data) continue;
      if (data.pulledAt) {
        const t2 = new Date(data.pulledAt).getTime();
        if (t2 > latestPulledAt) {
          latestPulledAt = t2;
          agg.pulledAt = data.pulledAt;
        }
      }
      if (Array.isArray(data.datacenters)) agg.datacenters.push(...data.datacenters);
      if (Array.isArray(data.clusters)) agg.clusters.push(...data.clusters);
      if (Array.isArray(data.hosts)) agg.hosts.push(...data.hosts);
      if (Array.isArray(data.vms)) agg.vms.push(...data.vms);
      if (Array.isArray(data.networks)) agg.networks.push(...data.networks);
      if (Array.isArray(data.datastores)) agg.datastores.push(...data.datastores);
    }

    return agg;
  }, [connectedEntries, connectionDataMap]);

  const onPull = async () => {
    const firstConnected = connectedEntries[0];
    if (!firstConnected?.credentialId) {
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Connect a VMware vSphere credential first.'),
      });
      return;
    }

    setIsPulling(true);
    try {
      const result = await postRequest<
        {
          pulled_at: string;
          vm_count: number;
          host_count: number;
          datastore_count: number;
          network_count: number;
          datacenter_count: number;
          cluster_count: number;
          vms: VmwareVM[];
          hosts: VmwareHost[];
          datastores: VmwareDatastore[];
          networks: VmwareNetwork[];
          datacenters: VmwareDatacenter[];
          clusters: VmwareCluster[];
        },
        { credential_id: number }
      >(awxAPI`/catalog_cloud/connectors/vmware/pull_resources/`, {
        credential_id: firstConnected.credentialId,
      });

      const newData: VmwareProviderData = {
        pulledAt: result.pulled_at,
        connectionId: firstConnected.id,
        datacenters: result.datacenters ?? [],
        clusters: result.clusters ?? [],
        hosts: result.hosts ?? [],
        vms: result.vms ?? [],
        networks: result.networks ?? [],
        datastores: result.datastores ?? [],
      };

      setCloudProviderData('vmware', newData);

      alertToaster.addAlert({
        variant: 'success',
        title: t(
          'Pulled {{vms}} VMs, {{hosts}} hosts, {{datastores}} datastores, {{networks}} networks.',
          {
            vms: result.vm_count ?? 0,
            hosts: result.host_count ?? 0,
            datastores: result.datastore_count ?? 0,
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
        title: t('Failed to pull VMware vSphere data'),
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
          title={t('VMware vSphere')}
          description={t('vCenter inventory management for administrators.')}
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
        title={t('VMware vSphere')}
        description={
          connectedEntries.length > 0
            ? t('{{n}} connection(s) active — vCenter resources available for Terraform jobs.', {
                n: connectedEntries.length,
              })
            : t(
                'No active connections. Add and connect a VMware vSphere credential on the Cloud Connections page.'
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
        logo={<img src={VmwareLogo as string} alt="VMware vSphere" style={{ height: 36 }} />}
      />

      {connectionEntries.length === 0 ? (
        <PageSection>
          <EmptyState>
            <EmptyStateIcon icon={CubesIcon} />
            <Title headingLevel="h4" size="lg">
              {t('No VMware vSphere connections configured')}
            </Title>
            <EmptyStateBody>
              {t(
                'Go to Cloud Connections and add a VMware vSphere credential. Each connection maps to one vCenter instance.'
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
            label={
              t('Virtual Machines') + (allData.vms.length > 0 ? ` (${allData.vms.length})` : '')
            }
          >
            <VMsTab vms={allData.vms} />
          </PageTab>
          <PageTab
            label={t('Hosts') + (allData.hosts.length > 0 ? ` (${allData.hosts.length})` : '')}
          >
            <HostsTab hosts={allData.hosts} />
          </PageTab>
          <PageTab
            label={
              t('Datastores') + (allData.datastores.length > 0 ? ` (${allData.datastores.length})` : '')
            }
          >
            <DatastoresTab datastores={allData.datastores} />
          </PageTab>
          <PageTab
            label={
              t('Networks') + (allData.networks.length > 0 ? ` (${allData.networks.length})` : '')
            }
          >
            <NetworksTab networks={allData.networks} />
          </PageTab>
          <PageTab
            label={
              t('Datacenters') +
              (allData.datacenters.length > 0 ? ` (${allData.datacenters.length})` : '')
            }
          >
            <DatacentersTab datacenters={allData.datacenters} clusters={allData.clusters} />
          </PageTab>
        </PageTabs>
      )}
    </PageLayout>
  );
}
