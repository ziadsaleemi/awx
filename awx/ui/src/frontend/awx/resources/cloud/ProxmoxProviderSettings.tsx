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
  Progress,
  ProgressMeasureLocation,
  Switch,
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
  IFilterState,
  ITableColumn,
  IToolbarFilter,
  PageHeader,
  PageLayout,
  PageTable,
  PageTab,
  PageTabs,
  TextCell,
  ToolbarFilterType,
  useInMemoryView,
  usePageAlertToaster,
} from '../../../../framework';
import { isRequestError } from '../../../common/crud/RequestError';
import { postRequest } from '../../../common/crud/Data';
import { awxAPI } from '../../common/api/awx-utils';
import { EmptyStateUnauthorized } from '../../../../framework/components/EmptyStateUnauthorized';
import {
  CloudConnectionEntry,
  ProxmoxAdminSettings,
  ProxmoxContainer,
  ProxmoxNetwork,
  ProxmoxNode,
  ProxmoxProviderData,
  ProxmoxStorage,
  ProxmoxVM,
  fetchCloudConnections,
  fetchProviderState,
  patchProviderState,
} from './cloudConnectionStore';
import ProxmoxLogo from '../../../assets/proxmox.svg';
import { ConnectionModal } from './CloudConnections';
import { CloudInventoryMapping } from './CloudInventoryMapping';
import { useCloudOrganization } from './useCloudOrganization';

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

// ─── sub-tabs ────────────────────────────────────────────────────────────────

function NodesTab(props: {
  nodes: ProxmoxNode[];
  adminSettings: ProxmoxAdminSettings | null;
  onToggle?: (name: string, allowed: boolean) => void;
}) {
  const { t } = useTranslation();
  const { nodes, adminSettings, onToggle } = props;
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
      {
        header: t('Type'),
        type: 'text',
        value: (n) => n.type,
        table: 'expanded',
      },
      {
        header: t('Catalog'),
        cell: (n) => {
          const isAllowed =
            adminSettings?.allowedNodeNames === null ||
            adminSettings?.allowedNodeNames === undefined ||
            adminSettings.allowedNodeNames.includes(n.node);
          return (
            <Switch
              id={`proxmox-node-allowed-${n.node}`}
              isChecked={isAllowed}
              onChange={(_evt, checked) => onToggle?.(n.node, checked)}
              aria-label={n.node}
              isDisabled={!onToggle}
            />
          );
        },
      },
    ],
    [t, adminSettings, onToggle]
  );

  const [filterState, setFilterState] = useState<IFilterState>({});
  const clearAllFilters = useCallback(() => setFilterState({}), []);
  const toolbarFilters = useMemo<IToolbarFilter[]>(
    () => [
      {
        key: 'node',
        label: t('Node'),
        type: ToolbarFilterType.SingleText,
        query: 'node',
        comparison: 'contains',
      },
      {
        key: 'status',
        label: t('Status'),
        type: ToolbarFilterType.SingleText,
        query: 'status',
        comparison: 'contains',
      },
    ],
    [t]
  );
  const filteredItems = useMemo(() => {
    const searches = Object.entries(filterState)
      .filter(([, v]) => v && v.length > 0)
      .map(([k, v]) => ({ k, v: v! }));
    if (!searches.length) return nodes;
    return nodes.filter((item) =>
      searches.every(({ k, v }) => {
        const field = String((item as unknown as Record<string, unknown>)[k] ?? '').toLowerCase();
        return v.some((s) => field.includes(s.toLowerCase()));
      })
    );
  }, [nodes, filterState]);

  const view = useInMemoryView<ProxmoxNode>({
    keyFn: (n) => n.node,
    items: filteredItems,
    tableColumns,
  });

  return (
    <PageTable<ProxmoxNode>
      id="proxmox-nodes-table"
      tableColumns={tableColumns}
      errorStateTitle={t('Error loading nodes')}
      emptyStateTitle={t('No nodes discovered')}
      emptyStateDescription={t('Sync this connection to discover cluster nodes.')}
      isSelectMultiple
      disableListView
      disableCardView
      {...view}
      toolbarFilters={toolbarFilters}
      filterState={filterState}
      setFilterState={setFilterState}
      clearAllFilters={clearAllFilters}
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
      {
        header: t('Type'),
        type: 'text',
        value: (vm) => vm.type,
        table: 'expanded',
      },
    ],
    [t]
  );

  const [filterState, setFilterState] = useState<IFilterState>({});
  const clearAllFilters = useCallback(() => setFilterState({}), []);
  const toolbarFilters = useMemo<IToolbarFilter[]>(
    () => [
      {
        key: 'name',
        label: t('Name'),
        type: ToolbarFilterType.SingleText,
        query: 'name',
        comparison: 'contains',
      },
      {
        key: 'status',
        label: t('Status'),
        type: ToolbarFilterType.SingleText,
        query: 'status',
        comparison: 'contains',
      },
      {
        key: 'node',
        label: t('Node'),
        type: ToolbarFilterType.SingleText,
        query: 'node',
        comparison: 'contains',
      },
    ],
    [t]
  );
  const filteredItems = useMemo(() => {
    const searches = Object.entries(filterState)
      .filter(([, v]) => v && v.length > 0)
      .map(([k, v]) => ({ k, v: v! }));
    if (!searches.length) return props.vms;
    return props.vms.filter((item) =>
      searches.every(({ k, v }) => {
        const field = String((item as unknown as Record<string, unknown>)[k] ?? '').toLowerCase();
        return v.some((s) => field.includes(s.toLowerCase()));
      })
    );
  }, [props.vms, filterState]);

  const view = useInMemoryView<ProxmoxVM>({
    keyFn: (vm) => String(vm.vmid),
    items: filteredItems,
    tableColumns,
  });

  return (
    <PageTable<ProxmoxVM>
      id="proxmox-vms-table"
      tableColumns={tableColumns}
      errorStateTitle={t('Error loading VMs')}
      emptyStateTitle={t('No virtual machines found')}
      emptyStateDescription={t('Sync this connection to discover KVM virtual machines.')}
      isSelectMultiple
      disableListView
      disableCardView
      {...view}
      toolbarFilters={toolbarFilters}
      filterState={filterState}
      setFilterState={setFilterState}
      clearAllFilters={clearAllFilters}
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
      {
        header: t('Type'),
        type: 'text',
        value: (ct) => ct.type,
        table: 'expanded',
      },
    ],
    [t]
  );

  const [filterState, setFilterState] = useState<IFilterState>({});
  const clearAllFilters = useCallback(() => setFilterState({}), []);
  const toolbarFilters = useMemo<IToolbarFilter[]>(
    () => [
      {
        key: 'name',
        label: t('Name'),
        type: ToolbarFilterType.SingleText,
        query: 'name',
        comparison: 'contains',
      },
      {
        key: 'status',
        label: t('Status'),
        type: ToolbarFilterType.SingleText,
        query: 'status',
        comparison: 'contains',
      },
      {
        key: 'node',
        label: t('Node'),
        type: ToolbarFilterType.SingleText,
        query: 'node',
        comparison: 'contains',
      },
    ],
    [t]
  );
  const filteredItems = useMemo(() => {
    const searches = Object.entries(filterState)
      .filter(([, v]) => v && v.length > 0)
      .map(([k, v]) => ({ k, v: v! }));
    if (!searches.length) return props.containers;
    return props.containers.filter((item) =>
      searches.every(({ k, v }) => {
        const field = String((item as unknown as Record<string, unknown>)[k] ?? '').toLowerCase();
        return v.some((s) => field.includes(s.toLowerCase()));
      })
    );
  }, [props.containers, filterState]);

  const view = useInMemoryView<ProxmoxContainer>({
    keyFn: (ct) => String(ct.vmid),
    items: filteredItems,
    tableColumns,
  });

  return (
    <PageTable<ProxmoxContainer>
      id="proxmox-containers-table"
      tableColumns={tableColumns}
      errorStateTitle={t('Error loading containers')}
      emptyStateTitle={t('No LXC containers found')}
      emptyStateDescription={t('Sync this connection to discover LXC containers.')}
      isSelectMultiple
      disableListView
      disableCardView
      {...view}
      toolbarFilters={toolbarFilters}
      filterState={filterState}
      setFilterState={setFilterState}
      clearAllFilters={clearAllFilters}
    />
  );
}

function StorageTab(props: {
  storage: ProxmoxStorage[];
  adminSettings: ProxmoxAdminSettings | null;
  onToggle?: (name: string, allowed: boolean) => void;
}) {
  const { t } = useTranslation();
  const { storage, adminSettings, onToggle } = props;
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
      {
        header: t('Nodes'),
        type: 'text',
        value: (s) => s.nodes || undefined,
        table: 'expanded',
      },
      {
        header: t('Catalog'),
        cell: (s) => {
          const isAllowed =
            adminSettings?.allowedStorageNames === null ||
            adminSettings?.allowedStorageNames === undefined ||
            adminSettings.allowedStorageNames.includes(s.storage);
          return (
            <Switch
              id={`proxmox-storage-allowed-${s.storage}`}
              isChecked={isAllowed}
              onChange={(_evt, checked) => onToggle?.(s.storage, checked)}
              aria-label={s.storage}
              isDisabled={!onToggle}
            />
          );
        },
      },
    ],
    [t, adminSettings, onToggle]
  );

  const [filterState, setFilterState] = useState<IFilterState>({});
  const clearAllFilters = useCallback(() => setFilterState({}), []);
  const toolbarFilters = useMemo<IToolbarFilter[]>(
    () => [
      {
        key: 'storage',
        label: t('Storage'),
        type: ToolbarFilterType.SingleText,
        query: 'storage',
        comparison: 'contains',
      },
      {
        key: 'type',
        label: t('Type'),
        type: ToolbarFilterType.SingleText,
        query: 'type',
        comparison: 'contains',
      },
      {
        key: 'status',
        label: t('Status'),
        type: ToolbarFilterType.SingleText,
        query: 'status',
        comparison: 'contains',
      },
      {
        key: 'content',
        label: t('Content'),
        type: ToolbarFilterType.SingleText,
        query: 'content',
        comparison: 'contains',
      },
    ],
    [t]
  );
  const filteredItems = useMemo(() => {
    const searches = Object.entries(filterState)
      .filter(([, v]) => v && v.length > 0)
      .map(([k, v]) => ({ k, v: v! }));
    if (!searches.length) return storage;
    return storage.filter((item) =>
      searches.every(({ k, v }) => {
        const field = String((item as unknown as Record<string, unknown>)[k] ?? '').toLowerCase();
        return v.some((s) => field.includes(s.toLowerCase()));
      })
    );
  }, [storage, filterState]);

  const view = useInMemoryView<ProxmoxStorage>({
    keyFn: (s) => s.storage,
    items: filteredItems,
    tableColumns,
  });

  return (
    <PageTable<ProxmoxStorage>
      id="proxmox-storage-table"
      tableColumns={tableColumns}
      errorStateTitle={t('Error loading storage')}
      emptyStateTitle={t('No storage pools found')}
      emptyStateDescription={t('Sync this connection to discover storage pools.')}
      isSelectMultiple
      disableListView
      disableCardView
      {...view}
      toolbarFilters={toolbarFilters}
      filterState={filterState}
      setFilterState={setFilterState}
      clearAllFilters={clearAllFilters}
    />
  );
}

function NetworksTab(props: {
  networks: ProxmoxNetwork[];
  adminSettings: ProxmoxAdminSettings | null;
  onToggle?: (key: string, allowed: boolean) => void;
}) {
  const { t } = useTranslation();
  const { networks, adminSettings, onToggle } = props;
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
      {
        header: t('Address'),
        type: 'text',
        value: (n) => n.address || undefined,
        table: 'expanded',
      },
      {
        header: t('Netmask'),
        type: 'text',
        value: (n) => n.netmask || undefined,
        table: 'expanded',
      },
      {
        header: t('Catalog'),
        cell: (n) => {
          const key = `${n.node}:${n.iface}`;
          const isAllowed =
            adminSettings?.allowedNetworkNames === null ||
            adminSettings?.allowedNetworkNames === undefined ||
            adminSettings.allowedNetworkNames.includes(key);
          return (
            <Switch
              id={`proxmox-network-allowed-${key}`}
              isChecked={isAllowed}
              onChange={(_evt, checked) => onToggle?.(key, checked)}
              aria-label={key}
              isDisabled={!onToggle}
            />
          );
        },
      },
    ],
    [t, adminSettings, onToggle]
  );

  const [filterState, setFilterState] = useState<IFilterState>({});
  const clearAllFilters = useCallback(() => setFilterState({}), []);
  const toolbarFilters = useMemo<IToolbarFilter[]>(
    () => [
      {
        key: 'iface',
        label: t('Interface'),
        type: ToolbarFilterType.SingleText,
        query: 'iface',
        comparison: 'contains',
      },
      {
        key: 'node',
        label: t('Node'),
        type: ToolbarFilterType.SingleText,
        query: 'node',
        comparison: 'contains',
      },
      {
        key: 'type',
        label: t('Type'),
        type: ToolbarFilterType.SingleText,
        query: 'type',
        comparison: 'contains',
      },
    ],
    [t]
  );
  const filteredItems = useMemo(() => {
    const searches = Object.entries(filterState)
      .filter(([, v]) => v && v.length > 0)
      .map(([k, v]) => ({ k, v: v! }));
    if (!searches.length) return networks;
    return networks.filter((item) =>
      searches.every(({ k, v }) => {
        const field = String((item as unknown as Record<string, unknown>)[k] ?? '').toLowerCase();
        return v.some((s) => field.includes(s.toLowerCase()));
      })
    );
  }, [networks, filterState]);

  const view = useInMemoryView<ProxmoxNetwork>({
    keyFn: (n) => `${n.node}:${n.iface}`,
    items: filteredItems,
    tableColumns,
  });

  return (
    <PageTable<ProxmoxNetwork>
      id="proxmox-networks-table"
      tableColumns={tableColumns}
      errorStateTitle={t('Error loading networks')}
      emptyStateTitle={t('No network interfaces found')}
      emptyStateDescription={t('Sync this connection to discover bridges and network interfaces.')}
      isSelectMultiple
      disableListView
      disableCardView
      {...view}
      toolbarFilters={toolbarFilters}
      filterState={filterState}
      setFilterState={setFilterState}
      clearAllFilters={clearAllFilters}
    />
  );
}

function TemplatesTab(props: {
  templates: ProxmoxVM[];
  adminSettings: ProxmoxAdminSettings | null;
  onToggle?: (name: string, allowed: boolean) => void;
}) {
  const { t } = useTranslation();
  const { templates, adminSettings, onToggle } = props;

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
        header: t('Catalog'),
        cell: (vm) => {
          const isAllowed =
            adminSettings?.allowedTemplateNames === null ||
            adminSettings?.allowedTemplateNames === undefined ||
            adminSettings.allowedTemplateNames.includes(vm.name);
          return (
            <Switch
              id={`proxmox-template-allowed-${vm.name}`}
              isChecked={isAllowed}
              onChange={(_evt, checked) => onToggle?.(vm.name, checked)}
              aria-label={vm.name}
              isDisabled={!onToggle}
            />
          );
        },
      },
      {
        header: t('Type'),
        type: 'text',
        value: (vm) => vm.type,
        table: 'expanded',
      },
      {
        header: t('Uptime'),
        type: 'text',
        value: (vm) => (vm.uptime ? String(vm.uptime) + 's' : undefined),
        table: 'expanded',
      },
    ],
    [t, adminSettings, onToggle]
  );

  const [filterState, setFilterState] = useState<IFilterState>({});
  const clearAllFilters = useCallback(() => setFilterState({}), []);
  const toolbarFilters = useMemo<IToolbarFilter[]>(
    () => [
      {
        key: 'name',
        label: t('Name'),
        type: ToolbarFilterType.SingleText,
        query: 'name',
        comparison: 'contains',
      },
      {
        key: 'status',
        label: t('Status'),
        type: ToolbarFilterType.SingleText,
        query: 'status',
        comparison: 'contains',
      },
      {
        key: 'node',
        label: t('Node'),
        type: ToolbarFilterType.SingleText,
        query: 'node',
        comparison: 'contains',
      },
    ],
    [t]
  );
  const filteredItems = useMemo(() => {
    const searches = Object.entries(filterState)
      .filter(([, v]) => v && v.length > 0)
      .map(([k, v]) => ({ k, v: v! }));
    if (!searches.length) return templates;
    return templates.filter((item) =>
      searches.every(({ k, v }) => {
        const field = String((item as unknown as Record<string, unknown>)[k] ?? '').toLowerCase();
        return v.some((s) => field.includes(s.toLowerCase()));
      })
    );
  }, [templates, filterState]);

  const view = useInMemoryView<ProxmoxVM>({
    keyFn: (vm) => String(vm.vmid),
    items: filteredItems,
    tableColumns,
  });

  return (
    <>
      <div
        style={{
          padding: '0.75rem 1rem',
          background: 'var(--pf-v5-global--BackgroundColor--200)',
          borderBottom: '1px solid var(--pf-v5-global--BorderColor--100)',
          fontSize: '0.8rem',
          color: 'var(--pf-v5-global--Color--200)',
        }}
      >
        {t(
          'Templates are VM images available for provisioning. Use the toggle in each row to allow or deny templates from appearing in the catalog deploy wizard.'
        )}
        {adminSettings?.allowedTemplateNames !== null &&
          adminSettings?.allowedTemplateNames !== undefined && (
            <span style={{ marginLeft: 12, color: '#f0ab00', fontWeight: 600 }}>
              {t('{{n}} template(s) allowed', {
                n: adminSettings.allowedTemplateNames.length,
              })}
            </span>
          )}
      </div>
      <PageTable<ProxmoxVM>
        id="proxmox-templates-table"
        tableColumns={tableColumns}
        errorStateTitle={t('Error loading templates')}
        emptyStateTitle={t('No templates found')}
        emptyStateDescription={t(
          'Sync this connection to discover VM templates. Templates must have the "template" flag set in Proxmox.'
        )}
        isSelectMultiple
        disableListView
        disableCardView
        {...view}
        toolbarFilters={toolbarFilters}
        filterState={filterState}
        setFilterState={setFilterState}
        clearAllFilters={clearAllFilters}
      />
    </>
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
            <ServerIcon style={{ color: '#e57000', fontSize: '1.1rem' }} />
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
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '0.82rem',
              marginBottom: 6,
            }}
          >
            <span style={{ color: 'var(--pf-v5-global--Color--200)' }}>{t('Credential')}</span>
            <span
              style={{ fontWeight: 500, color: '#fff', textAlign: 'right', wordBreak: 'break-all' }}
            >
              {entry.credentialName || '-'}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
            <span style={{ color: 'var(--pf-v5-global--Color--200)' }}>{t('Last synced')}</span>
            <span style={{ color: '#fff', fontWeight: 500 }}>
              {data?.pulledAt ? new Date(data.pulledAt).toLocaleTimeString() : t('Never')}
            </span>
          </div>
        </div>

        {/* Discovered resources stats */}
        {data && (
          <div style={{ marginTop: 'auto' }}>
            <div
              style={{
                fontSize: '0.75rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--pf-v5-global--Color--200)',
                marginBottom: '0.6rem',
                fontWeight: 600,
              }}
            >
              {t('Discovered Resources')}
            </div>
            <Grid hasGutter>
              {[
                {
                  icon: <ServerIcon style={{ color: '#39a5dc' }} />,
                  label: t('Nodes'),
                  value: nodeCount,
                },
                {
                  icon: <CubesIcon style={{ color: '#2b9af3' }} />,
                  label: t('VMs'),
                  value: vmCount,
                },
                {
                  icon: <CubesIcon style={{ color: '#ec7a08' }} />,
                  label: t('CTs'),
                  value: ctCount,
                },
                {
                  icon: <StorageDomainIcon style={{ color: '#f0ab00' }} />,
                  label: t('Storage'),
                  value: stCount,
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

// Helper to resolve connection data safely.
// provider_data is now stored as { "<connectionId>": { pulled_at, nodes, vms, ... } }
function getConnectionData(
  entry: CloudConnectionEntry,
  rawProviderData: unknown
): ProxmoxProviderData | null {
  if (!rawProviderData || typeof rawProviderData !== 'object') return null;
  const dataMap = rawProviderData as Record<string, unknown>;
  const connData = dataMap[entry.id];
  if (!connData || typeof connData !== 'object') return null;
  return connData as ProxmoxProviderData;
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
      <Grid hasGutter style={{ maxWidth: 1400, margin: '0 auto' }}>
        {/* Left Column: Connections list */}
        <GridItem sm={12} lg={8} xl={9}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Title headingLevel="h3" size="md" style={{ color: '#fff', fontWeight: 600 }}>
              {t('Active Connections')}
              <Badge style={{ marginLeft: 8, background: '#e57000', color: '#fff' }}>
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

        {/* Right Column: Variable Reference & Info Sidebar */}
        <GridItem sm={12} lg={4} xl={3}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Quick explanation panel */}
            <DarkCard>
              <CardBody style={{ padding: '1.25rem' }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <InfoCircleIcon
                    style={{ color: '#39a5dc', fontSize: '1.2rem', marginTop: 2, flexShrink: 0 }}
                  />
                  <div>
                    <h4
                      style={{
                        fontWeight: 600,
                        fontSize: '0.9rem',
                        color: '#fff',
                        marginBottom: 6,
                      }}
                    >
                      {t('How credentials work')}
                    </h4>
                    <p
                      style={{
                        fontSize: '0.78rem',
                        color: 'var(--pf-v5-global--Color--200)',
                        lineHeight: 1.4,
                      }}
                    >
                      {t(
                        'Connected credentials automatically inject standard Terraform variables into job templates that use this provider. No manual variable mapping is required.'
                      )}
                    </p>
                  </div>
                </div>
              </CardBody>
            </DarkCard>

            {/* Variable Reference List */}
            <DarkCard>
              <CardBody style={{ padding: '1.25rem' }}>
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1rem' }}
                >
                  <ProxmoxLogo style={{ width: 18, height: 18 }} />
                  <h4 style={{ fontWeight: 600, fontSize: '0.9rem', color: '#fff' }}>
                    {t('Terraform Variables')}
                  </h4>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[
                    {
                      variable: 'TF_VAR_pm_api_url',
                      description: t('Proxmox API endpoint, e.g. https://node:8006/api2/json'),
                    },
                    {
                      variable: 'TF_VAR_pm_user',
                      description: t('API user (e.g. root@pam)'),
                    },
                    {
                      variable: 'TF_VAR_pm_password',
                      description: t('API user password'),
                    },
                    {
                      variable: 'TF_VAR_pm_api_token_id',
                      description: t('API token ID (e.g. user@pam!tokenid)'),
                    },
                    {
                      variable: 'TF_VAR_pm_api_token_secret',
                      description: t('API token secret UUID'),
                    },
                    {
                      variable: 'TF_VAR_pm_tls_insecure',
                      description: t('Disable TLS cert verification (true/false)'),
                    },
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
                          color: '#e57000',
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
              </CardBody>
            </DarkCard>
          </div>
        </GridItem>
      </Grid>
    </PageSection>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export function ProxmoxProviderSettings() {
  const { t } = useTranslation();
  const { canManageCloud, organizationId } = useCloudOrganization();
  const alertToaster = usePageAlertToaster();
  const [isPulling, setIsPulling] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [connectionEntries, setConnectionEntries] = useState<CloudConnectionEntry[]>([]);
  const [rawProviderData, setRawProviderData] = useState<unknown>(null);
  const [adminSettings, setAdminSettings] = useState<ProxmoxAdminSettings | null>(null);
  const [selectedConnectorId, setSelectedConnectorId] = useState<string>('all');

  const loadData = useCallback(() => {
    void fetchCloudConnections('proxmox', organizationId).then(setConnectionEntries);
    void fetchProviderState('proxmox', organizationId).then((state) => {
      if (state?.provider_data !== undefined) setRawProviderData(state.provider_data);
      if (state?.admin_settings !== undefined)
        setAdminSettings(state.admin_settings as ProxmoxAdminSettings | null);
    });
  }, [organizationId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleModalClose = useCallback(() => {
    setShowModal(false);
    void fetchCloudConnections('proxmox', organizationId).then(setConnectionEntries);
  }, [organizationId]);

  const connectedEntries = useMemo(
    () => connectionEntries.filter((e) => e.status === 'connected'),
    [connectionEntries]
  );

  // Load and map connection data
  const connectionDataMap = useMemo(() => {
    const map: Record<string, ProxmoxProviderData> = {};
    const raw = rawProviderData;
    for (const entry of connectionEntries) {
      const data = getConnectionData(entry, raw);
      if (data) {
        map[entry.id] = data;
      }
    }
    return map;
  }, [connectionEntries, rawProviderData]);

  // Aggregate data from all connected connections
  const allData = useMemo<ProxmoxProviderData>(() => {
    const aggregated: ProxmoxProviderData = {
      pulledAt: '',
      nodes: [],
      vms: [],
      templates: [],
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
      if (Array.isArray(data.templates)) aggregated.templates.push(...data.templates);
      if (Array.isArray(data.containers)) aggregated.containers.push(...data.containers);
      if (Array.isArray(data.storage)) aggregated.storage.push(...data.storage);
      if (Array.isArray(data.networks)) aggregated.networks.push(...data.networks);
    }

    return aggregated;
  }, [connectedEntries, connectionDataMap]);

  // Data for the currently selected connector (or aggregated "all")
  const activeData = useMemo<ProxmoxProviderData>(() => {
    if (selectedConnectorId === 'all') return allData;
    return (
      connectionDataMap[selectedConnectorId] ?? {
        pulledAt: '',
        nodes: [],
        vms: [],
        templates: [],
        containers: [],
        storage: [],
        networks: [],
      }
    );
  }, [selectedConnectorId, allData, connectionDataMap]);

  // Toggle a single template's allow/deny status and persist to DB
  const onToggleTemplate = useCallback(
    async (name: string, allowed: boolean) => {
      const current = adminSettings?.allowedTemplateNames ?? null;
      const allKeys = allData.templates.map((t) => t.name);
      const next = new Set(current === null ? allKeys : current);
      if (allowed) next.add(name);
      else next.delete(name);
      const newSettings: ProxmoxAdminSettings = {
        allowedTemplateNames: [...next],
        allowedNodeNames: adminSettings?.allowedNodeNames ?? null,
        allowedStorageNames: adminSettings?.allowedStorageNames ?? null,
        allowedNetworkNames: adminSettings?.allowedNetworkNames ?? null,
      };
      setAdminSettings(newSettings);
      await patchProviderState('proxmox', { admin_settings: newSettings }, organizationId);
    },
    [adminSettings, allData.templates, organizationId]
  );

  const onToggleNode = useCallback(
    async (name: string, allowed: boolean) => {
      const current = adminSettings?.allowedNodeNames ?? null;
      const allKeys = allData.nodes.map((n) => n.node);
      const next = new Set(current === null ? allKeys : current);
      if (allowed) next.add(name);
      else next.delete(name);
      const newSettings: ProxmoxAdminSettings = {
        allowedTemplateNames: adminSettings?.allowedTemplateNames ?? null,
        allowedNodeNames: [...next],
        allowedStorageNames: adminSettings?.allowedStorageNames ?? null,
        allowedNetworkNames: adminSettings?.allowedNetworkNames ?? null,
      };
      setAdminSettings(newSettings);
      await patchProviderState('proxmox', { admin_settings: newSettings }, organizationId);
    },
    [adminSettings, allData.nodes, organizationId]
  );

  const onToggleStorage = useCallback(
    async (id: string, allowed: boolean) => {
      const current = adminSettings?.allowedStorageNames ?? null;
      const allKeys = allData.storage.map((s) => s.storage);
      const next = new Set(current === null ? allKeys : current);
      if (allowed) next.add(id);
      else next.delete(id);
      const newSettings: ProxmoxAdminSettings = {
        allowedTemplateNames: adminSettings?.allowedTemplateNames ?? null,
        allowedNodeNames: adminSettings?.allowedNodeNames ?? null,
        allowedStorageNames: [...next],
        allowedNetworkNames: adminSettings?.allowedNetworkNames ?? null,
      };
      setAdminSettings(newSettings);
      await patchProviderState('proxmox', { admin_settings: newSettings }, organizationId);
    },
    [adminSettings, allData.storage, organizationId]
  );

  const onToggleNetwork = useCallback(
    async (key: string, allowed: boolean) => {
      const current = adminSettings?.allowedNetworkNames ?? null;
      const allKeys = allData.networks.map((n) => `${n.node}:${n.iface}`);
      const next = new Set(current === null ? allKeys : current);
      if (allowed) next.add(key);
      else next.delete(key);
      const newSettings: ProxmoxAdminSettings = {
        allowedTemplateNames: adminSettings?.allowedTemplateNames ?? null,
        allowedNodeNames: adminSettings?.allowedNodeNames ?? null,
        allowedStorageNames: adminSettings?.allowedStorageNames ?? null,
        allowedNetworkNames: [...next],
      };
      setAdminSettings(newSettings);
      await patchProviderState('proxmox', { admin_settings: newSettings }, organizationId);
    },
    [adminSettings, allData.networks, organizationId]
  );

  const onPull = async () => {
    const toPull = connectedEntries.filter((e) => e.credentialId);
    if (!toPull.length) {
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Connect a Proxmox VE credential first.'),
      });
      return;
    }

    setIsPulling(true);
    let successCount = 0;
    const errors: string[] = [];

    for (const conn of toPull) {
      try {
        await postRequest<
          Record<string, unknown>,
          { credential_id: number; connection_id: string; organization: number | null }
        >(awxAPI`/catalog_cloud/connectors/proxmox/pull_resources/`, {
          credential_id: conn.credentialId!,
          connection_id: conn.id,
          organization: conn.organizationId,
        });
        successCount++;
      } catch (err) {
        const detail =
          isRequestError(err) && err.details
            ? err.details
            : err instanceof Error
              ? err.message
              : String(err);
        errors.push(`${conn.name}: ${detail}`);
      }
    }

    // Reload persisted data from DB so all connections' data is shown
    const state = await fetchProviderState('proxmox', organizationId);
    if (state?.provider_data !== undefined) setRawProviderData(state.provider_data);

    if (successCount > 0) {
      alertToaster.addAlert({
        variant: errors.length ? 'warning' : 'success',
        title: t('Pulled data for {{n}} connection(s).', { n: successCount }),
        children: errors.length ? errors.join('\n') : undefined,
      });
    }
    if (errors.length && successCount === 0) {
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Failed to pull Proxmox VE data'),
        children: errors.join('\n'),
      });
    }

    setIsPulling(false);
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
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Connector switcher — only shown when there are multiple connections */}
            {connectedEntries.length > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--pf-v5-global--Color--200)' }}>
                  {t('View:')}
                </span>
                <ToggleGroup aria-label={t('Select connector to view')}>
                  <ToggleGroupItem
                    text={t('All')}
                    isSelected={selectedConnectorId === 'all'}
                    onChange={() => setSelectedConnectorId('all')}
                  />
                  {connectedEntries.map((entry) => (
                    <ToggleGroupItem
                      key={entry.id}
                      text={entry.name}
                      isSelected={selectedConnectorId === entry.id}
                      onChange={() => setSelectedConnectorId(entry.id)}
                    />
                  ))}
                </ToggleGroup>
              </div>
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
                'Add a Proxmox VE credential to connect your hypervisor cluster. Each connection maps to one Proxmox node or cluster endpoint.'
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
              t('Nodes') + (activeData.nodes.length > 0 ? ` (${activeData.nodes.length})` : '')
            }
          >
            <NodesTab
              nodes={activeData.nodes}
              adminSettings={adminSettings}
              onToggle={(name, allowed) => void onToggleNode(name, allowed)}
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
              t('Containers (LXC)') +
              (activeData.containers.length > 0 ? ` (${activeData.containers.length})` : '')
            }
          >
            <ContainersTab containers={activeData.containers} />
          </PageTab>
          <PageTab
            label={
              t('Storage') +
              (activeData.storage.length > 0 ? ` (${activeData.storage.length})` : '')
            }
          >
            <StorageTab
              storage={activeData.storage}
              adminSettings={adminSettings}
              onToggle={(id, allowed) => void onToggleStorage(id, allowed)}
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
              adminSettings={adminSettings}
              onToggle={(key, allowed) => void onToggleNetwork(key, allowed)}
            />
          </PageTab>
          <PageTab
            label={
              t('Templates') +
              (allData.templates.length > 0 ? ` (${allData.templates.length})` : '')
            }
          >
            <TemplatesTab
              templates={activeData.templates ?? []}
              adminSettings={adminSettings}
              onToggle={(name, allowed) => void onToggleTemplate(name, allowed)}
            />
          </PageTab>
          <PageTab label={t('Inventory mapping')}>
            <CloudInventoryMapping
              providerId="proxmox"
              providerLabel={t('Proxmox VE')}
              organizationId={organizationId}
              connectionId={selectedConnectorId === 'all' ? null : selectedConnectorId}
              isDisabled={Object.keys(connectionDataMap).length === 0}
            />
          </PageTab>
        </PageTabs>
      )}

      {showModal && (
        <ConnectionModal
          providerId="proxmox"
          userOrgId={organizationId}
          canManageCloud={canManageCloud}
          onClose={handleModalClose}
        />
      )}
    </PageLayout>
  );
}
