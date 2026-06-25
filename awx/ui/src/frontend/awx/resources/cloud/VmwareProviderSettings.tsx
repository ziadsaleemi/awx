/* eslint-disable i18next/no-literal-string */
import { useCallback, useEffect, useMemo, useState } from 'react';
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
  ToggleGroup,
  ToggleGroupItem,
} from '@patternfly/react-core';
import {
  CubesIcon,
  InfoCircleIcon,
  NetworkIcon,
  PlusCircleIcon,
  ServerIcon,
  StorageDomainIcon,
} from '@patternfly/react-icons';
import {
  IPageAction,
  ITableColumn,
  PageActionSelection,
  PageActionType,
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
import {
  CloudConnectionEntry,
  VmwareAdminSettings,
  VmwareCluster,
  VmwareDatacenter,
  VmwareDatastore,
  VmwareHost,
  VmwareNetwork,
  VmwareProviderData,
  VmwareVM,
  fetchCloudConnections,
  fetchProviderState,
  patchProviderState,
} from './cloudConnectionStore';
import VmwareLogo from '../../../assets/vmware.svg';
import { ConnectionModal } from './CloudConnections';
import { CloudInventoryMapping } from './CloudInventoryMapping';
import { CloudProviderOverviewGrid, CloudProviderOverviewSection } from './CloudProviderLayout';
import { useCloudOrganization } from './useCloudOrganization';

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
        type: 'text',
        value: (vm) => vm.id,
        table: 'expanded',
      },
      {
        header: t('Host ID'),
        type: 'text',
        value: (vm) => vm.host_id || undefined,
        table: 'expanded',
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
        cell: (h) => (
          <TextCell
            text={h.cpu_count !== null && h.cpu_count !== undefined ? String(h.cpu_count) : '-'}
          />
        ),
      },
      {
        header: t('Memory'),
        cell: (h) => (
          <TextCell
            text={
              h.memory_size_mib !== null && h.memory_size_mib !== undefined
                ? fmtMiB(h.memory_size_mib)
                : '-'
            }
          />
        ),
      },
      {
        header: t('ID'),
        type: 'text',
        value: (h) => h.id,
        table: 'expanded',
      },
      {
        header: t('Cluster ID'),
        type: 'text',
        value: (h) => h.cluster_id || undefined,
        table: 'expanded',
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

function DatastoresTab(props: {
  datastores: VmwareDatastore[];
  adminSettings?: VmwareAdminSettings | null;
  onBulkToggle?: (names: string[], allowed: boolean) => void;
}) {
  const { t } = useTranslation();
  const { datastores, adminSettings, onBulkToggle } = props;
  const allowedNames = adminSettings?.allowedDatastoreNames ?? null;

  const toolbarActions = useMemo<IPageAction<VmwareDatastore>[]>(() => {
    if (!onBulkToggle) return [];
    return [
      {
        type: PageActionType.Button,
        selection: PageActionSelection.Multiple,
        label: t('Allow selected'),
        onClick: (items: VmwareDatastore[]) =>
          onBulkToggle(
            items.map((d) => d.name),
            true
          ),
      },
      {
        type: PageActionType.Button,
        selection: PageActionSelection.Multiple,
        label: t('Deny selected'),
        onClick: (items: VmwareDatastore[]) =>
          onBulkToggle(
            items.map((d) => d.name),
            false
          ),
      },
    ];
  }, [onBulkToggle, t]);

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
      ...(onBulkToggle
        ? [
            {
              header: t('Catalog'),
              cell: (ds: VmwareDatastore) => {
                const isAllowed = allowedNames === null || allowedNames.includes(ds.name);
                return (
                  <Label color={isAllowed ? 'green' : 'red'}>
                    {isAllowed ? t('Allowed') : t('Denied')}
                  </Label>
                );
              },
            },
          ]
        : []),
      {
        header: t('Datastore ID'),
        type: 'text',
        value: (ds) => ds.id,
        table: 'expanded',
      },
    ],
    [t, allowedNames, onBulkToggle]
  );

  const view = useInMemoryView<VmwareDatastore>({
    keyFn: (ds) => ds.id,
    items: datastores,
    tableColumns,
  });

  return (
    <>
      {onBulkToggle && allowedNames !== null && (
        <Alert
          isInline
          variant="info"
          title={t('Datastore allow-list active')}
          style={{ margin: '0.75rem 1rem 0' }}
        >
          {t('{{count}} of {{total}} datastores are available to catalog deployments.', {
            count: allowedNames.length,
            total: datastores.length,
          })}
        </Alert>
      )}
      <PageTable<VmwareDatastore>
        id="vmware-datastores-table"
        tableColumns={tableColumns}
        toolbarActions={toolbarActions}
        errorStateTitle={t('Error loading datastores')}
        emptyStateTitle={t('No datastores found')}
        emptyStateDescription={t('Pull data from vCenter to discover datastores.')}
        disableListView
        disableCardView
        {...view}
      />
    </>
  );
}

function NetworksTab(props: {
  networks: VmwareNetwork[];
  adminSettings?: VmwareAdminSettings | null;
  onBulkToggle?: (names: string[], allowed: boolean) => void;
}) {
  const { t } = useTranslation();
  const { networks, adminSettings, onBulkToggle } = props;
  const allowedNames = adminSettings?.allowedNetworkNames ?? null;

  const toolbarActions = useMemo<IPageAction<VmwareNetwork>[]>(() => {
    if (!onBulkToggle) return [];
    return [
      {
        type: PageActionType.Button,
        selection: PageActionSelection.Multiple,
        label: t('Allow selected'),
        onClick: (items: VmwareNetwork[]) =>
          onBulkToggle(
            items.map((n) => n.name),
            true
          ),
      },
      {
        type: PageActionType.Button,
        selection: PageActionSelection.Multiple,
        label: t('Deny selected'),
        onClick: (items: VmwareNetwork[]) =>
          onBulkToggle(
            items.map((n) => n.name),
            false
          ),
      },
    ];
  }, [onBulkToggle, t]);

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
      ...(onBulkToggle
        ? [
            {
              header: t('Catalog'),
              cell: (n: VmwareNetwork) => {
                const isAllowed = allowedNames === null || allowedNames.includes(n.name);
                return (
                  <Label color={isAllowed ? 'green' : 'red'}>
                    {isAllowed ? t('Allowed') : t('Denied')}
                  </Label>
                );
              },
            },
          ]
        : []),
      {
        header: t('ID'),
        type: 'text',
        value: (n) => n.id,
        table: 'expanded',
      },
    ],
    [t, allowedNames, onBulkToggle]
  );

  const view = useInMemoryView<VmwareNetwork>({
    keyFn: (n) => n.id,
    items: networks,
    tableColumns,
  });

  return (
    <>
      {onBulkToggle && allowedNames !== null && (
        <Alert
          isInline
          variant="info"
          title={t('Network allow-list active')}
          style={{ margin: '0.75rem 1rem 0' }}
        >
          {t('{{count}} of {{total}} networks are available to catalog deployments.', {
            count: allowedNames.length,
            total: networks.length,
          })}
        </Alert>
      )}
      <PageTable<VmwareNetwork>
        id="vmware-networks-table"
        tableColumns={tableColumns}
        toolbarActions={toolbarActions}
        errorStateTitle={t('Error loading networks')}
        emptyStateTitle={t('No networks found')}
        emptyStateDescription={t('Pull data from vCenter to discover networks and port groups.')}
        disableListView
        disableCardView
        {...view}
      />
    </>
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
        type: 'text',
        value: (dc) => dc.id,
        table: 'expanded',
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
            {t('Credential ID')}:{' '}
            <strong style={{ color: '#fff' }}>{entry.credentialId ?? '-'}</strong>
          </div>
          {data?.pulledAt && (
            <div
              style={{
                fontSize: '0.78rem',
                color: 'var(--pf-v5-global--Color--200)',
                marginTop: 4,
              }}
            >
              {t('Last pull')}:{' '}
              <strong style={{ color: '#fff' }}>{new Date(data.pulledAt).toLocaleString()}</strong>
            </div>
          )}
        </div>

        {/* Resource counts */}
        {data && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div
              style={{
                fontSize: '0.75rem',
                color: 'var(--pf-v5-global--Color--200)',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              {t('Discovered Resources')}
            </div>
            <Grid hasGutter>
              {[
                {
                  icon: <CubesIcon style={{ color: '#2b9af3' }} />,
                  label: t('VMs'),
                  value: vmCount,
                },
                {
                  icon: <ServerIcon style={{ color: '#39a5dc' }} />,
                  label: t('Hosts'),
                  value: hostCount,
                },
                {
                  icon: <StorageDomainIcon style={{ color: '#f0ab00' }} />,
                  label: t('Datastores'),
                  value: dsCount,
                },
                {
                  icon: <NetworkIcon style={{ color: '#4cb140' }} />,
                  label: t('Networks'),
                  value: netCount,
                },
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
                      <div
                        style={{
                          fontSize: '1.1rem',
                          fontWeight: 700,
                          color: '#fff',
                          lineHeight: 1.1,
                        }}
                      >
                        {value}
                      </div>
                      <div
                        style={{ fontSize: '0.68rem', color: 'var(--pf-v5-global--Color--200)' }}
                      >
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

    if (entry.id in dataObj) return normalizeVmwareProviderData(dataObj[entry.id]);

    if (!Array.isArray(rawProviderData)) {
      if (dataObj.connectionId === entry.id || dataObj.connection_id === entry.id) {
        return normalizeVmwareProviderData(rawProviderData);
      }
    }
  }

  return null;
}

function normalizeVmwareProviderData(rawData: unknown): VmwareProviderData | null {
  if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) return null;
  const data = rawData as Record<string, unknown>;
  return {
    pulledAt: String(data.pulledAt ?? data.pulled_at ?? ''),
    connectionId: String(data.connectionId ?? data.connection_id ?? ''),
    datacenters: Array.isArray(data.datacenters) ? (data.datacenters as VmwareDatacenter[]) : [],
    clusters: Array.isArray(data.clusters) ? (data.clusters as VmwareCluster[]) : [],
    hosts: Array.isArray(data.hosts) ? (data.hosts as VmwareHost[]) : [],
    vms: Array.isArray(data.vms) ? (data.vms as VmwareVM[]) : [],
    networks: Array.isArray(data.networks) ? (data.networks as VmwareNetwork[]) : [],
    datastores: Array.isArray(data.datastores) ? (data.datastores as VmwareDatastore[]) : [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// ─── overview tab ─────────────────────────────────────────────────────────────

function OverviewTab(props: {
  connectionEntries: CloudConnectionEntry[];
  connectionDataMap: Record<string, VmwareProviderData>;
}) {
  const { t } = useTranslation();
  const { connectionEntries, connectionDataMap } = props;

  return (
    <CloudProviderOverviewSection>
      <CloudProviderOverviewGrid hasGutter data-cy="vmware-provider-overview-grid">
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
                  <h4
                    style={{ fontWeight: 600, fontSize: '0.9rem', color: '#fff', marginBottom: 6 }}
                  >
                    {t('VMware vSphere credentials')}
                  </h4>
                  <p
                    style={{
                      fontSize: '0.8rem',
                      color: 'var(--pf-v5-global--Color--200)',
                      lineHeight: 1.5,
                    }}
                  >
                    {t(
                      'Connect a VMware vSphere credential (host, username, password) on the Cloud Connections page. Pull data to inventory VMs, hosts, datastores, and networks from vCenter.'
                    )}
                  </p>
                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {[
                      {
                        variable: 'TF_VAR_vsphere_server',
                        description: t('vCenter server hostname / IP'),
                      },
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
                        <code
                          style={{
                            color: '#1D6FA5',
                            fontSize: '0.75rem',
                            fontFamily: 'monospace',
                            display: 'block',
                            marginBottom: '0.15rem',
                          }}
                        >
                          {variable}
                        </code>
                        <span
                          style={{
                            fontSize: '0.7rem',
                            color: 'var(--pf-v5-global--Color--200)',
                            lineHeight: 1.3,
                            display: 'block',
                          }}
                        >
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
      </CloudProviderOverviewGrid>
    </CloudProviderOverviewSection>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export function VmwareProviderSettings() {
  const { t } = useTranslation();
  const { canManageCloud, organizationId } = useCloudOrganization();
  const alertToaster = usePageAlertToaster();
  const [isPulling, setIsPulling] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [connectionEntries, setConnectionEntries] = useState<CloudConnectionEntry[]>([]);
  const [rawProviderData, setRawProviderData] = useState<unknown>(null);
  const [adminSettings, setAdminSettings] = useState<VmwareAdminSettings | null>(null);
  const [selectedConnectorId, setSelectedConnectorId] = useState<string>('all');

  const loadProviderState = useCallback(
    async (entries: CloudConnectionEntry[]) => {
      const orgKeys = new Set<string>();
      orgKeys.add(
        organizationId === null || organizationId === undefined ? 'global' : String(organizationId)
      );
      for (const entry of entries) {
        orgKeys.add(
          entry.organizationId === null || entry.organizationId === undefined
            ? 'global'
            : String(entry.organizationId)
        );
      }

      const mergedProviderData: Record<string, unknown> = {};
      let nextAdminSettings: VmwareAdminSettings | null = null;

      for (const orgKey of orgKeys) {
        const orgId = orgKey === 'global' ? null : Number(orgKey);
        const state = await fetchProviderState('vmware', orgId);
        if (isRecord(state?.provider_data)) {
          Object.assign(mergedProviderData, state.provider_data);
        }
        if (nextAdminSettings === null && state?.admin_settings) {
          nextAdminSettings = state.admin_settings as VmwareAdminSettings;
        }
      }

      setRawProviderData(Object.keys(mergedProviderData).length > 0 ? mergedProviderData : null);
      setAdminSettings(nextAdminSettings);
    },
    [organizationId]
  );

  const loadData = useCallback(() => {
    void fetchCloudConnections('vmware', organizationId).then((entries) => {
      setConnectionEntries(entries);
      void loadProviderState(entries);
    });
  }, [loadProviderState, organizationId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleModalClose = useCallback(() => {
    setShowModal(false);
    void fetchCloudConnections('vmware', organizationId).then((entries) => {
      setConnectionEntries(entries);
      void loadProviderState(entries);
    });
  }, [loadProviderState, organizationId]);

  const connectedEntries = useMemo(
    () => connectionEntries.filter((e) => e.status === 'connected'),
    [connectionEntries]
  );

  const connectionDataMap = useMemo(() => {
    const map: Record<string, VmwareProviderData> = {};
    const raw = rawProviderData;
    for (const entry of connectionEntries) {
      const data = getConnectionData(entry, raw);
      if (data) map[entry.id] = data;
    }
    return map;
  }, [connectionEntries, rawProviderData]);

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

  // Active data based on connector switcher
  const activeData = useMemo<VmwareProviderData>(() => {
    if (selectedConnectorId === 'all') return allData;
    return (
      connectionDataMap[selectedConnectorId] ?? {
        pulledAt: '',
        connectionId: '',
        datacenters: [],
        clusters: [],
        hosts: [],
        vms: [],
        networks: [],
        datastores: [],
      }
    );
  }, [selectedConnectorId, allData, connectionDataMap]);

  // Admin bulk toggle handlers
  const onBulkToggleNetwork = useCallback(
    async (names: string[], allowed: boolean) => {
      const current = adminSettings?.allowedNetworkNames ?? null;
      let next: string[] | null;
      if (allowed) {
        if (current === null) return; // already all-allowed
        const set = new Set([...current, ...names]);
        next = [...set];
      } else {
        const deny = new Set(names);
        next =
          current === null
            ? allData.networks.map((n) => n.name).filter((n) => !deny.has(n))
            : current.filter((n) => !deny.has(n));
      }
      const newSettings: VmwareAdminSettings = {
        allowedNetworkNames: next,
        allowedDatastoreNames: adminSettings?.allowedDatastoreNames ?? null,
      };
      setAdminSettings(newSettings);
      await patchProviderState('vmware', { admin_settings: newSettings }, organizationId);
    },
    [adminSettings, allData.networks, organizationId]
  );

  const onBulkToggleDatastore = useCallback(
    async (names: string[], allowed: boolean) => {
      const current = adminSettings?.allowedDatastoreNames ?? null;
      let next: string[] | null;
      if (allowed) {
        if (current === null) return;
        const set = new Set([...current, ...names]);
        next = [...set];
      } else {
        const deny = new Set(names);
        next =
          current === null
            ? allData.datastores.map((d) => d.name).filter((n) => !deny.has(n))
            : current.filter((n) => !deny.has(n));
      }
      const newSettings: VmwareAdminSettings = {
        allowedNetworkNames: adminSettings?.allowedNetworkNames ?? null,
        allowedDatastoreNames: next,
      };
      setAdminSettings(newSettings);
      await patchProviderState('vmware', { admin_settings: newSettings }, organizationId);
    },
    [adminSettings, allData.datastores, organizationId]
  );

  const onPull = async () => {
    const toPull = connectedEntries.filter((e) => e.credentialId);
    if (toPull.length === 0) {
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Connect a VMware vSphere credential first.'),
      });
      return;
    }

    setIsPulling(true);
    let successCount = 0;
    let errorCount = 0;

    for (const conn of toPull) {
      try {
        await postRequest<
          {
            pulled_at: string;
            vm_count: number;
            host_count: number;
            datastore_count: number;
            network_count: number;
          },
          { credential_id: number; connection_id: string; organization: number | null }
        >(awxAPI`/catalog_cloud/connectors/vmware/pull_resources/`, {
          credential_id: conn.credentialId!,
          connection_id: conn.id,
          organization: conn.organizationId,
        });
        successCount++;
      } catch (err) {
        errorCount++;
        const detail =
          isRequestError(err) && err.details
            ? err.details
            : err instanceof Error
              ? err.message
              : String(err);
        alertToaster.addAlert({
          variant: 'warning',
          title: t('Failed to pull from "{{name}}"', { name: conn.name }),
          children: detail,
        });
      }
    }

    // Reload from DB after all pulls complete
    await loadProviderState(connectionEntries);

    if (successCount > 0) {
      alertToaster.addAlert({
        variant: errorCount === 0 ? 'success' : 'warning',
        title: t('Pulled data from {{n}} of {{total}} connection(s).', {
          n: successCount,
          total: toPull.length,
        }),
      });
    } else {
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Failed to pull VMware vSphere data from all connections.'),
      });
    }
    setIsPulling(false);
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
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {connectedEntries.length > 1 && (
              <ToggleGroup aria-label={t('Select connection to view')}>
                <ToggleGroupItem
                  text={t('All')}
                  isSelected={selectedConnectorId === 'all'}
                  onChange={() => setSelectedConnectorId('all')}
                />
                {connectedEntries.map((e) => (
                  <ToggleGroupItem
                    key={e.id}
                    text={e.name}
                    isSelected={selectedConnectorId === e.id}
                    onChange={() => setSelectedConnectorId(e.id)}
                  />
                ))}
              </ToggleGroup>
            )}
            {connectedEntries.length > 0 && (
              <Button
                variant="primary"
                onClick={() => void onPull()}
                isLoading={isPulling}
                isDisabled={isPulling}
              >
                {isPulling ? t('Pulling\u2026') : t('Pull data')}
              </Button>
            )}
            <Button
              variant="secondary"
              icon={<PlusCircleIcon />}
              onClick={() => setShowModal(true)}
            >
              {t('Manage connections')}
            </Button>
          </div>
        }
        titleAdornment={<VmwareLogo style={{ height: 36, width: 'auto' }} />}
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
                'Add a VMware vSphere credential to connect your vCenter instance. Each connection maps to one vCenter.'
              )}
            </EmptyStateBody>
            <Button
              variant="primary"
              icon={<PlusCircleIcon />}
              onClick={() => setShowModal(true)}
              style={{ marginTop: 16 }}
            >
              {t('Add connection')}
            </Button>
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
              t('Virtual Machines') +
              (activeData.vms.length > 0 ? ` (${activeData.vms.length})` : '')
            }
          >
            <VMsTab vms={activeData.vms} />
          </PageTab>
          <PageTab
            label={
              t('Hosts') + (activeData.hosts.length > 0 ? ` (${activeData.hosts.length})` : '')
            }
          >
            <HostsTab hosts={activeData.hosts} />
          </PageTab>
          <PageTab
            label={
              t('Datastores') +
              (activeData.datastores.length > 0 ? ` (${activeData.datastores.length})` : '')
            }
          >
            <DatastoresTab
              datastores={activeData.datastores}
              adminSettings={canManageCloud ? adminSettings : undefined}
              onBulkToggle={
                canManageCloud
                  ? (names, allowed) => void onBulkToggleDatastore(names, allowed)
                  : undefined
              }
            />
          </PageTab>
          <PageTab
            label={
              t('Networks') +
              (activeData.networks.length > 0 ? ` (${activeData.networks.length})` : '')
            }
          >
            <NetworksTab
              networks={activeData.networks}
              adminSettings={canManageCloud ? adminSettings : undefined}
              onBulkToggle={
                canManageCloud
                  ? (names, allowed) => void onBulkToggleNetwork(names, allowed)
                  : undefined
              }
            />
          </PageTab>
          <PageTab
            label={
              t('Datacenters') +
              (activeData.datacenters.length > 0 ? ` (${activeData.datacenters.length})` : '')
            }
          >
            <DatacentersTab datacenters={activeData.datacenters} clusters={activeData.clusters} />
          </PageTab>
          <PageTab label={t('Inventory mapping')}>
            <CloudInventoryMapping
              providerId="vmware"
              providerLabel={t('VMware vSphere')}
              organizationId={organizationId}
              connectionId={selectedConnectorId === 'all' ? null : selectedConnectorId}
              isDisabled={Object.keys(connectionDataMap).length === 0}
            />
          </PageTab>
        </PageTabs>
      )}

      {showModal && (
        <ConnectionModal
          providerId="vmware"
          userOrgId={organizationId}
          canManageCloud={canManageCloud}
          onClose={handleModalClose}
        />
      )}
    </PageLayout>
  );
}
