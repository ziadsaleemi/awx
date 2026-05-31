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
  FormGroup,
  FormSelect,
  FormSelectOption,
  Grid,
  GridItem,
  Label,
  Modal,
  ModalVariant,
  PageSection,
  Switch,
  TextInput,
  Title,
  ToggleGroup,
  ToggleGroupItem,
} from '@patternfly/react-core';
import {
  CubesIcon,
  GlobeIcon,
  InfoCircleIcon,
  NetworkIcon,
  PlusCircleIcon,
  ServerIcon,
  StorageDomainIcon,
  TrashIcon,
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
import { postRequest, requestGet } from '../../../common/crud/Data';
import { useGet } from '../../../common/crud/useGet';
import { Credential } from '../../interfaces/Credential';
import { awxAPI } from '../../common/api/awx-utils';
import { EmptyStateUnauthorized } from '../../../../framework/components/EmptyStateUnauthorized';
import {
  AzureAdminSettings,
  AzureLocation,
  AzureProviderData,
  AzureResourceGroup,
  AzureStorageAccount,
  AzureVM,
  AzureVMImage,
  AzureVMSize,
  AzureVNet,
  CloudConnectionEntry,
  createCloudConnection,
  fetchCloudConnections,
  fetchProviderState,
  patchProviderState,
  removeCloudConnectionApi,
  updateCloudConnectionApi,
} from './cloudConnectionStore';
import { useCloudOrganization } from './useCloudOrganization';
// ─── styled ──────────────────────────────────────────────────────────────────

const DarkCard = styled(Card)`
  background-color: #222428 !important;
  border: 1px solid var(--pf-v5-global--BorderColor--100) !important;
  box-shadow: var(--pf-v5-global--BoxShadow--sm) !important;
`;

// ─── sub-tabs ────────────────────────────────────────────────────────────────

function ResourceGroupsTab(props: {
  resourceGroups: AzureResourceGroup[];
  adminSettings?: AzureAdminSettings | null;
  onToggle?: (name: string, allowed: boolean) => void;
}) {
  const { t } = useTranslation();
  const { resourceGroups, adminSettings, onToggle } = props;
  const allowedNames = adminSettings?.allowedResourceGroupNames ?? null;

  const tableColumns = useMemo<ITableColumn<AzureResourceGroup>[]>(
    () => [
      {
        header: t('Name'),
        cell: (rg) => <TextCell text={rg.name} />,
        sort: 'name',
      },
      {
        header: t('Location'),
        cell: (rg) => <TextCell text={rg.location} />,
        sort: 'location',
      },
      {
        header: t('Provisioning State'),
        cell: (rg) => {
          const color = rg.provisioning_state === 'Succeeded' ? 'green' : 'orange';
          return <Label color={color}>{rg.provisioning_state}</Label>;
        },
      },
      {
        header: t('Allowed'),
        cell: (rg) => {
          const isAllowed = allowedNames === null || allowedNames.includes(rg.name);
          return (
            <Switch
              id={`azure-rg-allowed-${rg.id}`}
              isChecked={isAllowed}
              onChange={(_evt, checked) => onToggle?.(rg.name, checked)}
              aria-label={rg.name}
              isDisabled={!onToggle}
            />
          );
        },
      },
      {
        header: t('Tags'),
        type: 'text',
        value: (rg) =>
          rg.tags && Object.keys(rg.tags).length > 0
            ? Object.entries(rg.tags)
                .map(([k, v]) => `${k}=${v}`)
                .join(', ')
            : undefined,
        table: 'expanded',
      },
      {
        header: t('Resource Group ID'),
        type: 'text',
        value: (rg) => rg.id,
        table: 'expanded',
      },
    ],
    [t, allowedNames, onToggle]
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
        key: 'location',
        label: t('Location'),
        type: ToolbarFilterType.SingleText,
        query: 'location',
        comparison: 'contains',
      },
      {
        key: 'provisioning_state',
        label: t('Provisioning State'),
        type: ToolbarFilterType.SingleText,
        query: 'provisioning_state',
        comparison: 'contains',
      },
    ],
    [t]
  );
  const filteredItems = useMemo(() => {
    const searches = Object.entries(filterState)
      .filter(([, v]) => v && v.length > 0)
      .map(([k, v]) => ({ k, v: v! }));
    if (!searches.length) return resourceGroups;
    return resourceGroups.filter((item) =>
      searches.every(({ k, v }) => {
        const field = String((item as unknown as Record<string, unknown>)[k] ?? '').toLowerCase();
        return v.some((s) => field.includes(s.toLowerCase()));
      })
    );
  }, [resourceGroups, filterState]);

  const view = useInMemoryView<AzureResourceGroup>({
    keyFn: (rg) => rg.id,
    items: filteredItems,
    tableColumns,
  });

  return (
    <PageTable<AzureResourceGroup>
      id="azure-resource-groups-table"
      tableColumns={tableColumns}
      errorStateTitle={t('Error loading resource groups')}
      emptyStateTitle={t('No resource groups found')}
      emptyStateDescription={t('Pull data from Azure to discover resource groups.')}
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

function VMImagesTab(props: {
  vmImages: AzureVMImage[];
  adminSettings?: AzureAdminSettings | null;
  onToggle?: (urn: string, allowed: boolean) => void;
}) {
  const { t } = useTranslation();
  const { vmImages, adminSettings, onToggle } = props;
  const allowedUrns = adminSettings?.allowedVMImageUrns ?? null;

  const tableColumns = useMemo<ITableColumn<AzureVMImage>[]>(
    () => [
      {
        header: t('Name'),
        cell: (img) => <TextCell text={img.name} />,
        sort: 'name',
      },
      {
        header: t('Type'),
        cell: (img) => {
          const color =
            img.image_type === 'custom' ? 'blue' : img.image_type === 'gallery' ? 'purple' : 'cyan';
          return <Label color={color}>{img.image_type}</Label>;
        },
      },
      {
        header: t('OS'),
        cell: (img) => (
          <Label color={img.os_type === 'Windows' ? 'blue' : 'green'}>{img.os_type || '-'}</Label>
        ),
        sort: 'os_type',
      },
      {
        header: t('Publisher'),
        cell: (img) => <TextCell text={img.publisher || '-'} />,
        sort: 'publisher',
      },
      {
        header: t('Offer / SKU'),
        cell: (img) =>
          img.offer ? <TextCell text={`${img.offer} / ${img.sku}`} /> : <TextCell text="-" />,
      },
      {
        header: t('Version'),
        cell: (img) => <TextCell text={img.version || '-'} />,
      },
      {
        header: t('Allowed'),
        cell: (img) => {
          const isAllowed = allowedUrns === null || allowedUrns.includes(img.urn);
          return (
            <Switch
              id={`azure-img-allowed-${img.id}`}
              isChecked={isAllowed}
              onChange={(_evt, checked) => onToggle?.(img.urn, checked)}
              aria-label={img.name}
              isDisabled={!onToggle}
            />
          );
        },
      },
      {
        header: t('URN / ID'),
        type: 'text',
        value: (img) => img.urn,
        table: 'expanded',
      },
      {
        header: t('Description'),
        type: 'text',
        value: (img) => img.description || undefined,
        table: 'expanded',
      },
      {
        header: t('Location'),
        type: 'text',
        value: (img) => img.location,
        table: 'expanded',
      },
    ],
    [t, allowedUrns, onToggle]
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
        key: 'publisher',
        label: t('Publisher'),
        type: ToolbarFilterType.SingleText,
        query: 'publisher',
        comparison: 'contains',
      },
      {
        key: 'offer',
        label: t('Offer'),
        type: ToolbarFilterType.SingleText,
        query: 'offer',
        comparison: 'contains',
      },
      {
        key: 'sku',
        label: t('SKU'),
        type: ToolbarFilterType.SingleText,
        query: 'sku',
        comparison: 'contains',
      },
      {
        key: 'location',
        label: t('Location'),
        type: ToolbarFilterType.SingleText,
        query: 'location',
        comparison: 'contains',
      },
      {
        key: 'os_type',
        label: t('OS Type'),
        type: ToolbarFilterType.SingleText,
        query: 'os_type',
        comparison: 'contains',
      },
    ],
    [t]
  );
  const filteredItems = useMemo(() => {
    const searches = Object.entries(filterState)
      .filter(([, v]) => v && v.length > 0)
      .map(([k, v]) => ({ k, v: v! }));
    if (!searches.length) return vmImages;
    return vmImages.filter((item) =>
      searches.every(({ k, v }) => {
        const field = String((item as unknown as Record<string, unknown>)[k] ?? '').toLowerCase();
        return v.some((s) => field.includes(s.toLowerCase()));
      })
    );
  }, [vmImages, filterState]);

  const view = useInMemoryView<AzureVMImage>({
    keyFn: (img) => img.id,
    items: filteredItems,
    tableColumns,
  });

  return (
    <PageTable<AzureVMImage>
      id="azure-vm-images-table"
      tableColumns={tableColumns}
      errorStateTitle={t('Error loading VM images')}
      emptyStateTitle={t('No VM images found')}
      emptyStateDescription={t('Pull data from Azure to discover available VM images.')}
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

function VMSizesTab(props: {
  vmSizes: AzureVMSize[];
  adminSettings?: AzureAdminSettings | null;
  onToggle?: (name: string, allowed: boolean) => void;
}) {
  const { t } = useTranslation();
  const { vmSizes, adminSettings, onToggle } = props;
  const allowedNames = adminSettings?.allowedVMSizeNames ?? null;

  const tableColumns = useMemo<ITableColumn<AzureVMSize>[]>(
    () => [
      {
        header: t('Name'),
        cell: (s) => <TextCell text={s.name} />,
        sort: 'name',
      },
      {
        header: t('Family'),
        cell: (s) => <TextCell text={s.family} />,
        sort: 'family',
      },
      {
        header: t('Tier'),
        cell: (s) => <Label color={s.tier === 'Basic' ? 'grey' : 'blue'}>{s.tier}</Label>,
      },
      {
        header: t('vCPUs'),
        cell: (s) => <TextCell text={String(s.vcpus)} />,
        sort: 'vcpus',
      },
      {
        header: t('RAM (GB)'),
        cell: (s) => <TextCell text={String(s.memory_gb)} />,
        sort: 'memory_gb',
      },
      {
        header: t('Price/hr'),
        cell: (s) =>
          s.price_per_hour !== null && s.price_per_hour !== undefined ? (
            <TextCell text={`$${s.price_per_hour.toFixed(4)}`} />
          ) : (
            <TextCell text="-" />
          ),
        sort: 'price_per_hour',
      },
      {
        header: t('Allowed'),
        cell: (s) => {
          const isAllowed = allowedNames === null || allowedNames.includes(s.name);
          return (
            <Switch
              id={`azure-size-allowed-${s.location}-${s.name}`}
              isChecked={isAllowed}
              onChange={(_evt, checked) => onToggle?.(s.name, checked)}
              aria-label={s.name}
              isDisabled={!onToggle}
            />
          );
        },
      },
      {
        header: t('GPUs'),
        type: 'text',
        value: (s) => (s.gpus > 0 ? String(s.gpus) : '0'),
        table: 'expanded',
      },
      {
        header: t('Max Disks'),
        type: 'text',
        value: (s) => String(s.max_data_disks),
        table: 'expanded',
      },
      {
        header: t('Max NICs'),
        type: 'text',
        value: (s) => String(s.max_nics),
        table: 'expanded',
      },
      {
        header: t('Premium SSD'),
        type: 'text',
        value: (s) => (s.premium_io ? 'Yes' : 'No'),
        table: 'expanded',
      },
      {
        header: t('Accel. Networking'),
        type: 'text',
        value: (s) => (s.accelerated_networking ? 'Yes' : 'No'),
        table: 'expanded',
      },
      {
        header: t('Zones'),
        type: 'text',
        value: (s) => (s.zones.length > 0 ? s.zones.join(', ') : '-'),
        table: 'expanded',
      },
      {
        header: t('Ultra SSD'),
        type: 'text',
        value: (s) => (s.ultra_ssd ? 'Yes' : 'No'),
        table: 'expanded',
      },
    ],
    [t, allowedNames, onToggle]
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
        key: 'tier',
        label: t('Tier'),
        type: ToolbarFilterType.SingleText,
        query: 'tier',
        comparison: 'contains',
      },
      {
        key: 'family',
        label: t('Family'),
        type: ToolbarFilterType.SingleText,
        query: 'family',
        comparison: 'contains',
      },
      {
        key: 'location',
        label: t('Location'),
        type: ToolbarFilterType.SingleText,
        query: 'location',
        comparison: 'contains',
      },
    ],
    [t]
  );
  const filteredItems = useMemo(() => {
    const searches = Object.entries(filterState)
      .filter(([, v]) => v && v.length > 0)
      .map(([k, v]) => ({ k, v: v! }));
    if (!searches.length) return vmSizes;
    return vmSizes.filter((item) =>
      searches.every(({ k, v }) => {
        const field = String((item as unknown as Record<string, unknown>)[k] ?? '').toLowerCase();
        return v.some((s) => field.includes(s.toLowerCase()));
      })
    );
  }, [vmSizes, filterState]);

  const view = useInMemoryView<AzureVMSize>({
    keyFn: (s) => `${s.location}:${s.name}`,
    items: filteredItems,
    tableColumns,
  });

  return (
    <PageTable<AzureVMSize>
      id="azure-vm-sizes-table"
      tableColumns={tableColumns}
      errorStateTitle={t('Error loading VM sizes')}
      emptyStateTitle={t('No VM sizes found')}
      emptyStateDescription={t(
        'Pull data from Azure to discover available VM sizes for your region.'
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
  );
}

function VMsTab(props: {
  vms: AzureVM[];
  adminSettings?: AzureAdminSettings | null;
  onToggle?: (id: string, allowed: boolean) => void;
}) {
  const { t } = useTranslation();
  const { vms, adminSettings, onToggle } = props;
  const allowedIds = adminSettings?.allowedVMIds ?? null;

  const tableColumns = useMemo<ITableColumn<AzureVM>[]>(
    () => [
      {
        header: t('Name'),
        cell: (vm) => (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ServerIcon />
            <TextCell text={vm.name} />
          </div>
        ),
        sort: 'name',
      },
      {
        header: t('Resource Group'),
        cell: (vm) => <TextCell text={vm.resource_group} />,
        sort: 'resource_group',
      },
      {
        header: t('Location'),
        cell: (vm) => <TextCell text={vm.location} />,
        sort: 'location',
      },
      {
        header: t('OS'),
        cell: (vm) => (
          <Label color={vm.os_type === 'Windows' ? 'blue' : 'green'}>{vm.os_type || '-'}</Label>
        ),
      },
      {
        header: t('Power State'),
        cell: (vm) => {
          if (!vm.power_state) return <TextCell text="-" />;
          const running = vm.power_state.toLowerCase().includes('running');
          return <Label color={running ? 'green' : 'grey'}>{vm.power_state}</Label>;
        },
      },
      {
        header: t('State'),
        cell: (vm) => {
          const color = vm.provisioning_state === 'Succeeded' ? 'green' : 'orange';
          return <Label color={color}>{vm.provisioning_state}</Label>;
        },
      },
      {
        header: t('Allowed'),
        cell: (vm) => {
          const isAllowed = allowedIds === null || allowedIds.includes(vm.id);
          return (
            <Switch
              id={`azure-vm-allowed-${vm.id.replace(/[^a-z0-9]/gi, '-')}`}
              isChecked={isAllowed}
              onChange={(_evt, checked) => onToggle?.(vm.id, checked)}
              aria-label={vm.name}
              isDisabled={!onToggle}
            />
          );
        },
      },
      {
        header: t('Size'),
        type: 'text',
        value: (vm) => vm.vm_size,
        table: 'expanded',
      },
      {
        header: t('VM ID'),
        type: 'text',
        value: (vm) => vm.id,
        table: 'expanded',
      },
      {
        header: t('Tags'),
        type: 'text',
        value: (vm) =>
          vm.tags
            ? Object.entries(vm.tags)
                .map(([k, v]) => `${k}=${v}`)
                .join(', ')
            : undefined,
        table: 'expanded',
      },
    ],
    [t, allowedIds, onToggle]
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
        key: 'location',
        label: t('Location'),
        type: ToolbarFilterType.SingleText,
        query: 'location',
        comparison: 'contains',
      },
      {
        key: 'resource_group',
        label: t('Resource Group'),
        type: ToolbarFilterType.SingleText,
        query: 'resource_group',
        comparison: 'contains',
      },
      {
        key: 'vm_size',
        label: t('VM Size'),
        type: ToolbarFilterType.SingleText,
        query: 'vm_size',
        comparison: 'contains',
      },
      {
        key: 'os_type',
        label: t('OS Type'),
        type: ToolbarFilterType.SingleText,
        query: 'os_type',
        comparison: 'contains',
      },
    ],
    [t]
  );
  const filteredItems = useMemo(() => {
    const searches = Object.entries(filterState)
      .filter(([, v]) => v && v.length > 0)
      .map(([k, v]) => ({ k, v: v! }));
    if (!searches.length) return vms;
    return vms.filter((item) =>
      searches.every(({ k, v }) => {
        const field = String((item as unknown as Record<string, unknown>)[k] ?? '').toLowerCase();
        return v.some((s) => field.includes(s.toLowerCase()));
      })
    );
  }, [vms, filterState]);

  const view = useInMemoryView<AzureVM>({
    keyFn: (vm) => vm.id,
    items: filteredItems,
    tableColumns,
  });

  return (
    <PageTable<AzureVM>
      id="azure-vms-table"
      tableColumns={tableColumns}
      errorStateTitle={t('Error loading virtual machines')}
      emptyStateTitle={t('No virtual machines found')}
      emptyStateDescription={t('Pull data from Azure to discover virtual machines.')}
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

function VNetsTab(props: {
  vnets: AzureVNet[];
  adminSettings?: AzureAdminSettings | null;
  onToggle?: (name: string, allowed: boolean) => void;
}) {
  const { t } = useTranslation();
  const { vnets, adminSettings, onToggle } = props;
  const allowedNames = adminSettings?.allowedVNetNames ?? null;

  const tableColumns = useMemo<ITableColumn<AzureVNet>[]>(
    () => [
      {
        header: t('Name'),
        cell: (vn) => (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <NetworkIcon />
            <TextCell text={vn.name} />
          </div>
        ),
        sort: 'name',
      },
      {
        header: t('Resource Group'),
        cell: (vn) => <TextCell text={vn.resource_group} />,
        sort: 'resource_group',
      },
      {
        header: t('Location'),
        cell: (vn) => <TextCell text={vn.location} />,
        sort: 'location',
      },
      {
        header: t('Address Space'),
        cell: (vn) => <TextCell text={vn.address_space.join(', ') || '-'} />,
      },
      {
        header: t('State'),
        cell: (vn) => {
          const color = vn.provisioning_state === 'Succeeded' ? 'green' : 'orange';
          return <Label color={color}>{vn.provisioning_state}</Label>;
        },
      },
      {
        header: t('Allowed'),
        cell: (vn) => {
          const isAllowed = allowedNames === null || allowedNames.includes(vn.name);
          return (
            <Switch
              id={`azure-vnet-allowed-${vn.id.replace(/[^a-z0-9]/gi, '-')}`}
              isChecked={isAllowed}
              onChange={(_evt, checked) => onToggle?.(vn.name, checked)}
              aria-label={vn.name}
              isDisabled={!onToggle}
            />
          );
        },
      },
      {
        header: t('VNet ID'),
        type: 'text',
        value: (vn) => vn.id,
        table: 'expanded',
      },
    ],
    [t, allowedNames, onToggle]
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
        key: 'location',
        label: t('Location'),
        type: ToolbarFilterType.SingleText,
        query: 'location',
        comparison: 'contains',
      },
      {
        key: 'resource_group',
        label: t('Resource Group'),
        type: ToolbarFilterType.SingleText,
        query: 'resource_group',
        comparison: 'contains',
      },
    ],
    [t]
  );
  const filteredItems = useMemo(() => {
    const searches = Object.entries(filterState)
      .filter(([, v]) => v && v.length > 0)
      .map(([k, v]) => ({ k, v: v! }));
    if (!searches.length) return vnets;
    return vnets.filter((item) =>
      searches.every(({ k, v }) => {
        const field = String((item as unknown as Record<string, unknown>)[k] ?? '').toLowerCase();
        return v.some((s) => field.includes(s.toLowerCase()));
      })
    );
  }, [vnets, filterState]);

  const view = useInMemoryView<AzureVNet>({
    keyFn: (vn) => vn.id,
    items: filteredItems,
    tableColumns,
  });

  return (
    <PageTable<AzureVNet>
      id="azure-vnets-table"
      tableColumns={tableColumns}
      errorStateTitle={t('Error loading virtual networks')}
      emptyStateTitle={t('No virtual networks found')}
      emptyStateDescription={t('Pull data from Azure to discover virtual networks.')}
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
  storageAccounts: AzureStorageAccount[];
  adminSettings?: AzureAdminSettings | null;
  onToggle?: (name: string, allowed: boolean) => void;
}) {
  const { t } = useTranslation();
  const { storageAccounts, adminSettings, onToggle } = props;
  const allowedNames = adminSettings?.allowedStorageAccountNames ?? null;

  const tableColumns = useMemo<ITableColumn<AzureStorageAccount>[]>(
    () => [
      {
        header: t('Name'),
        cell: (sa) => (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <StorageDomainIcon />
            <TextCell text={sa.name} />
          </div>
        ),
        sort: 'name',
      },
      {
        header: t('Resource Group'),
        cell: (sa) => <TextCell text={sa.resource_group} />,
        sort: 'resource_group',
      },
      {
        header: t('Location'),
        cell: (sa) => <TextCell text={sa.location} />,
        sort: 'location',
      },
      {
        header: t('Kind'),
        cell: (sa) => <Label color="blue">{sa.kind}</Label>,
      },
      {
        header: t('State'),
        cell: (sa) => {
          const color = sa.provisioning_state === 'Succeeded' ? 'green' : 'orange';
          return <Label color={color}>{sa.provisioning_state}</Label>;
        },
      },
      {
        header: t('Allowed'),
        cell: (sa) => {
          const isAllowed = allowedNames === null || allowedNames.includes(sa.name);
          return (
            <Switch
              id={`azure-sa-allowed-${sa.id.replace(/[^a-z0-9]/gi, '-')}`}
              isChecked={isAllowed}
              onChange={(_evt, checked) => onToggle?.(sa.name, checked)}
              aria-label={sa.name}
              isDisabled={!onToggle}
            />
          );
        },
      },
      {
        header: t('SKU'),
        type: 'text',
        value: (sa) => sa.sku,
        table: 'expanded',
      },
      {
        header: t('Storage Account ID'),
        type: 'text',
        value: (sa) => sa.id,
        table: 'expanded',
      },
    ],
    [t, allowedNames, onToggle]
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
        key: 'location',
        label: t('Location'),
        type: ToolbarFilterType.SingleText,
        query: 'location',
        comparison: 'contains',
      },
      {
        key: 'resource_group',
        label: t('Resource Group'),
        type: ToolbarFilterType.SingleText,
        query: 'resource_group',
        comparison: 'contains',
      },
      {
        key: 'kind',
        label: t('Kind'),
        type: ToolbarFilterType.SingleText,
        query: 'kind',
        comparison: 'contains',
      },
      {
        key: 'sku',
        label: t('SKU'),
        type: ToolbarFilterType.SingleText,
        query: 'sku',
        comparison: 'contains',
      },
    ],
    [t]
  );
  const filteredItems = useMemo(() => {
    const searches = Object.entries(filterState)
      .filter(([, v]) => v && v.length > 0)
      .map(([k, v]) => ({ k, v: v! }));
    if (!searches.length) return storageAccounts;
    return storageAccounts.filter((item) =>
      searches.every(({ k, v }) => {
        const field = String((item as unknown as Record<string, unknown>)[k] ?? '').toLowerCase();
        return v.some((s) => field.includes(s.toLowerCase()));
      })
    );
  }, [storageAccounts, filterState]);

  const view = useInMemoryView<AzureStorageAccount>({
    keyFn: (sa) => sa.id,
    items: filteredItems,
    tableColumns,
  });

  return (
    <PageTable<AzureStorageAccount>
      id="azure-storage-table"
      tableColumns={tableColumns}
      errorStateTitle={t('Error loading storage accounts')}
      emptyStateTitle={t('No storage accounts found')}
      emptyStateDescription={t('Pull data from Azure to discover storage accounts.')}
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

function LocationsTab(props: {
  locations: AzureLocation[];
  adminSettings?: AzureAdminSettings | null;
  onToggle?: (name: string, allowed: boolean) => void;
}) {
  const { t } = useTranslation();
  const { locations, adminSettings, onToggle } = props;
  const allowedNames = adminSettings?.allowedLocationNames ?? null;

  const tableColumns = useMemo<ITableColumn<AzureLocation>[]>(
    () => [
      {
        header: t('Display Name'),
        cell: (loc) => (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <GlobeIcon />
            <TextCell text={loc.display_name} />
          </div>
        ),
        sort: 'display_name',
      },
      {
        header: t('Name'),
        cell: (loc) => <TextCell text={loc.name} />,
        sort: 'name',
      },
      {
        header: t('Type'),
        cell: (loc) => <Label color="blue">{loc.region_type || 'Physical'}</Label>,
      },
      {
        header: t('Allowed'),
        cell: (loc) => {
          const isAllowed = allowedNames === null || allowedNames.includes(loc.name);
          return (
            <Switch
              id={`azure-loc-allowed-${loc.id.replace(/[^a-z0-9]/gi, '-')}`}
              isChecked={isAllowed}
              onChange={(_evt, checked) => onToggle?.(loc.name, checked)}
              aria-label={loc.display_name}
              isDisabled={!onToggle}
            />
          );
        },
      },
      {
        header: t('Location ID'),
        type: 'text',
        value: (loc) => loc.id,
        table: 'expanded',
      },
    ],
    [t, allowedNames, onToggle]
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
        key: 'display_name',
        label: t('Display Name'),
        type: ToolbarFilterType.SingleText,
        query: 'display_name',
        comparison: 'contains',
      },
      {
        key: 'region_type',
        label: t('Region Type'),
        type: ToolbarFilterType.SingleText,
        query: 'region_type',
        comparison: 'contains',
      },
    ],
    [t]
  );
  const filteredItems = useMemo(() => {
    const searches = Object.entries(filterState)
      .filter(([, v]) => v && v.length > 0)
      .map(([k, v]) => ({ k, v: v! }));
    if (!searches.length) return locations;
    return locations.filter((item) =>
      searches.every(({ k, v }) => {
        const field = String((item as unknown as Record<string, unknown>)[k] ?? '').toLowerCase();
        return v.some((s) => field.includes(s.toLowerCase()));
      })
    );
  }, [locations, filterState]);

  const view = useInMemoryView<AzureLocation>({
    keyFn: (loc) => loc.id,
    items: filteredItems,
    tableColumns,
  });

  return (
    <PageTable<AzureLocation>
      id="azure-locations-table"
      tableColumns={tableColumns}
      errorStateTitle={t('Error loading locations')}
      emptyStateTitle={t('No locations found')}
      emptyStateDescription={t('Pull data from Azure to discover available regions.')}
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

// ─── connection summary card ──────────────────────────────────────────────────

function ConnectionCard(props: { entry: CloudConnectionEntry; data: AzureProviderData | null }) {
  const { t } = useTranslation();
  const { entry, data } = props;

  const rgCount = data?.resource_groups?.length ?? 0;
  const vmCount = data?.vms?.length ?? 0;
  const vnetCount = data?.vnets?.length ?? 0;
  const saCount = data?.storage_accounts?.length ?? 0;

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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ServerIcon style={{ color: '#0078D4', fontSize: '1.1rem' }} />
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
          {data?.subscription_id && (
            <div
              style={{
                fontSize: '0.78rem',
                color: 'var(--pf-v5-global--Color--200)',
                marginTop: 4,
              }}
            >
              {t('Subscription')}: <strong style={{ color: '#fff' }}>{data.subscription_id}</strong>
            </div>
          )}
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
                  label: t('Resource Groups'),
                  value: rgCount,
                },
                {
                  icon: <ServerIcon style={{ color: '#39a5dc' }} />,
                  label: t('VMs'),
                  value: vmCount,
                },
                {
                  icon: <NetworkIcon style={{ color: '#4cb140' }} />,
                  label: t('VNets'),
                  value: vnetCount,
                },
                {
                  icon: <StorageDomainIcon style={{ color: '#f0ab00' }} />,
                  label: t('Storage'),
                  value: saCount,
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
): AzureProviderData | null {
  if (!rawProviderData) return null;
  if (typeof rawProviderData === 'object') {
    const dataObj = rawProviderData as Record<string, unknown>;
    if (entry.id in dataObj) return dataObj[entry.id] as AzureProviderData;
    if (!Array.isArray(rawProviderData)) {
      if (dataObj.connectionId === entry.id || dataObj.connection_id === entry.id) {
        return rawProviderData as AzureProviderData;
      }
    }
  }
  return null;
}

// ─── overview tab ─────────────────────────────────────────────────────────────

function OverviewTab(props: {
  connectionEntries: CloudConnectionEntry[];
  connectionDataMap: Record<string, AzureProviderData>;
}) {
  const { t } = useTranslation();
  const { connectionEntries, connectionDataMap } = props;

  return (
    <PageSection style={{ overflowY: 'auto', flex: 1, padding: '1.5rem' }}>
      <Grid hasGutter style={{ maxWidth: 1400, margin: '0 auto' }}>
        <GridItem sm={12} lg={8} xl={9}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Title headingLevel="h3" size="md" style={{ color: '#fff', fontWeight: 600 }}>
              {t('Active Connections')}
              <Badge style={{ marginLeft: 8, background: '#0078D4', color: '#fff' }}>
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

        <GridItem sm={12} lg={4} xl={3}>
          <DarkCard>
            <CardBody style={{ padding: '1.25rem' }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <InfoCircleIcon
                  style={{ color: '#0078D4', fontSize: '1.2rem', marginTop: 2, flexShrink: 0 }}
                />
                <div>
                  <h4
                    style={{ fontWeight: 600, fontSize: '0.9rem', color: '#fff', marginBottom: 6 }}
                  >
                    {t('Azure credentials')}
                  </h4>
                  <p
                    style={{
                      fontSize: '0.8rem',
                      color: 'var(--pf-v5-global--Color--200)',
                      lineHeight: 1.5,
                    }}
                  >
                    {t(
                      'Connect an Azure Resource Manager (Terraform) credential (subscription ID, client ID, client secret, tenant ID). Pull data to inventory resource groups, VMs, virtual networks, and storage accounts from your Azure subscription.'
                    )}
                  </p>
                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {[
                      { variable: 'ARM_SUBSCRIPTION_ID', description: t('Azure subscription ID') },
                      { variable: 'ARM_CLIENT_ID', description: t('Service principal client ID') },
                      {
                        variable: 'ARM_CLIENT_SECRET',
                        description: t('Service principal client secret'),
                      },
                      { variable: 'ARM_TENANT_ID', description: t('Azure AD tenant ID') },
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
                            color: '#0078D4',
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
      </Grid>
    </PageSection>
  );
}

// ─── connection management modal ─────────────────────────────────────────────

function ManageConnectionsModal(props: {
  isOpen: boolean;
  onClose: () => void;
  entries: CloudConnectionEntry[];
  azureCredentials: Credential[];
  allCredentials: Credential[];
  onConnect: (entryId: string, credentialId: number) => Promise<void>;
  onDisconnect: (entryId: string) => void;
  onRemove: (entryId: string) => void;
  onAddAndConnect: (name: string, credentialId: number) => Promise<void>;
  connectingId: string | null;
}) {
  const { t } = useTranslation();
  const {
    isOpen,
    onClose,
    entries,
    azureCredentials,
    allCredentials,
    onConnect,
    onDisconnect,
    onRemove,
    onAddAndConnect,
    connectingId,
  } = props;

  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCredentialId, setNewCredentialId] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const displayCredentials = azureCredentials.length > 0 ? azureCredentials : allCredentials;

  const handleAdd = async () => {
    if (!newName.trim() || !newCredentialId) return;
    setIsAdding(true);
    try {
      await onAddAndConnect(newName.trim(), Number(newCredentialId));
      setNewName('');
      setNewCredentialId('');
      setShowAddForm(false);
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <Modal
      title={t('Azure Connections')}
      isOpen={isOpen}
      onClose={onClose}
      variant={ModalVariant.medium}
      actions={[
        <Button key="close" variant="primary" onClick={onClose}>
          {t('Close')}
        </Button>,
      ]}
    >
      <div style={{ display: 'grid', gap: 16 }}>
        <Alert isInline variant="info" title={t('Azure Resource Manager credential')}>
          {t(
            'Select an Azure Resource Manager (Terraform) credential with subscription ID, client ID, client secret, and tenant ID. Each connection maps to one Azure subscription.'
          )}
        </Alert>

        {entries.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr
                style={{
                  textAlign: 'left',
                  borderBottom: '2px solid var(--pf-v5-global--BorderColor--100)',
                }}
              >
                <th style={{ padding: '6px 8px' }}>{t('Name')}</th>
                <th style={{ padding: '6px 8px' }}>{t('Status')}</th>
                <th style={{ padding: '6px 8px' }}>{t('Credential')}</th>
                <th style={{ padding: '6px 8px' }} />
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr
                  key={entry.id}
                  style={{ borderBottom: '1px solid var(--pf-v5-global--BorderColor--100)' }}
                >
                  <td style={{ padding: '8px' }}>{entry.name}</td>
                  <td style={{ padding: '8px' }}>
                    {entry.status === 'connected' ? (
                      <Label color="green">{t('Connected')}</Label>
                    ) : entry.status === 'misconfigured' ? (
                      <Label color="orange">{t('Misconfigured')}</Label>
                    ) : (
                      <Label color="grey">{t('Disconnected')}</Label>
                    )}
                  </td>
                  <td style={{ padding: '8px' }}>{entry.credentialName || '-'}</td>
                  <td style={{ padding: '8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {entry.status === 'connected' ? (
                      <Button variant="secondary" size="sm" onClick={() => onDisconnect(entry.id)}>
                        {t('Disconnect')}
                      </Button>
                    ) : (
                      entry.credentialId !== null &&
                      entry.credentialId !== undefined && (
                        <Button
                          variant="primary"
                          size="sm"
                          isLoading={connectingId === entry.id}
                          isDisabled={connectingId !== null}
                          onClick={() => void onConnect(entry.id, entry.credentialId!)}
                        >
                          {t('Connect')}
                        </Button>
                      )
                    )}{' '}
                    <Button
                      variant="plain"
                      size="sm"
                      aria-label={t('Remove connection')}
                      onClick={() => onRemove(entry.id)}
                    >
                      <TrashIcon />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {!showAddForm ? (
          <Button variant="link" icon={<PlusCircleIcon />} onClick={() => setShowAddForm(true)}>
            {t('Add connection')}
          </Button>
        ) : (
          <div
            style={{
              border: '1px solid var(--pf-v5-global--BorderColor--100)',
              borderRadius: 6,
              padding: '1rem',
              display: 'grid',
              gap: 12,
            }}
          >
            <FormGroup label={t('Connection name')} isRequired fieldId="azure-conn-name">
              <TextInput
                id="azure-conn-name"
                value={newName}
                onChange={(_, v) => setNewName(v)}
                placeholder={t('e.g. Production Subscription')}
              />
            </FormGroup>
            <FormGroup label={t('Credential')} isRequired fieldId="azure-conn-cred">
              <FormSelect
                id="azure-conn-cred"
                value={newCredentialId}
                onChange={(_, v) => setNewCredentialId(v)}
                aria-label={t('Select credential')}
              >
                <FormSelectOption value="" label={t('Select a credential')} isPlaceholder />
                {displayCredentials.map((c) => (
                  <FormSelectOption
                    key={c.id}
                    value={String(c.id)}
                    label={`${c.name} — ${c.summary_fields?.credential_type?.name ?? c.kind}`}
                  />
                ))}
              </FormSelect>
            </FormGroup>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button
                variant="primary"
                isDisabled={!newName.trim() || !newCredentialId || isAdding}
                isLoading={isAdding}
                onClick={() => void handleAdd()}
              >
                {t('Add & connect')}
              </Button>
              <Button
                variant="link"
                onClick={() => {
                  setShowAddForm(false);
                  setNewName('');
                  setNewCredentialId('');
                }}
              >
                {t('Cancel')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export function AzureProviderSettings() {
  const { t } = useTranslation();
  const { canManageCloud, organizationId } = useCloudOrganization();
  const alertToaster = usePageAlertToaster();
  const [isPulling, setIsPulling] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [connectionEntries, setConnectionEntries] = useState<CloudConnectionEntry[]>([]);
  const [rawProviderData, setRawProviderData] = useState<unknown>(null);
  const [adminSettings, setAdminSettings] = useState<AzureAdminSettings | null>(null);
  const [selectedConnectorId, setSelectedConnectorId] = useState<string>('all');

  const loadConnections = useCallback(() => {
    void fetchCloudConnections('azure', organizationId).then(setConnectionEntries);
  }, [organizationId]);

  useEffect(() => {
    loadConnections();
    void fetchProviderState('azure', organizationId).then((state) => {
      if (state?.provider_data !== undefined) setRawProviderData(state.provider_data);
      setAdminSettings((state?.admin_settings as AzureAdminSettings | null) ?? null);
    });
  }, [loadConnections, organizationId]);

  const { data: credData } = useGet<{ count: number; results: Credential[] }>(
    awxAPI`/credentials/?order_by=name&page_size=200`
  );

  const azureCredentials = useMemo(() => {
    const all = credData?.results ?? [];
    return all.filter((c) => {
      const ns =
        (c as unknown as { credential_type__namespace?: string }).credential_type__namespace ?? '';
      const typeName = (c.summary_fields?.credential_type?.name ?? '').toLowerCase();
      return ns === 'azure_rm_terraform' || typeName.includes('azure');
    });
  }, [credData]);

  const connectedEntries = useMemo(
    () => connectionEntries.filter((e) => e.status === 'connected'),
    [connectionEntries]
  );

  const connectionDataMap = useMemo(() => {
    const map: Record<string, AzureProviderData> = {};
    const raw = rawProviderData;
    for (const entry of connectionEntries) {
      const data = getConnectionData(entry, raw);
      if (data) map[entry.id] = data;
    }
    return map;
  }, [connectionEntries, rawProviderData]);

  const allData = useMemo<AzureProviderData>(() => {
    const agg: AzureProviderData = {
      pulledAt: '',
      connectionId: '',
      subscription_id: '',
      resource_groups: [],
      vms: [],
      vnets: [],
      storage_accounts: [],
      locations: [],
      vm_images: [],
      vm_sizes: [],
    };

    let latestPulledAt = 0;
    for (const entry of connectedEntries) {
      const data = connectionDataMap[entry.id];
      if (!data) continue;
      if (data.pulledAt) {
        const ts = new Date(data.pulledAt).getTime();
        if (ts > latestPulledAt) {
          latestPulledAt = ts;
          agg.pulledAt = data.pulledAt;
          agg.subscription_id = data.subscription_id;
        }
      }
      if (Array.isArray(data.resource_groups)) agg.resource_groups.push(...data.resource_groups);
      if (Array.isArray(data.vms)) agg.vms.push(...data.vms);
      if (Array.isArray(data.vnets)) agg.vnets.push(...data.vnets);
      if (Array.isArray(data.storage_accounts)) agg.storage_accounts.push(...data.storage_accounts);
      if (Array.isArray(data.locations) && agg.locations.length === 0)
        agg.locations.push(...data.locations);
      if (Array.isArray(data.vm_images) && agg.vm_images.length === 0)
        agg.vm_images.push(...data.vm_images);
      if (Array.isArray(data.vm_sizes) && agg.vm_sizes.length === 0)
        agg.vm_sizes.push(...data.vm_sizes);
    }

    return agg;
  }, [connectedEntries, connectionDataMap]);

  // Active data based on connector switcher
  const activeData = useMemo<AzureProviderData>(() => {
    if (selectedConnectorId === 'all') return allData;
    return (
      connectionDataMap[selectedConnectorId] ?? {
        pulledAt: '',
        connectionId: '',
        subscription_id: '',
        resource_groups: [],
        vms: [],
        vnets: [],
        storage_accounts: [],
        locations: [],
        vm_images: [],
        vm_sizes: [],
      }
    );
  }, [selectedConnectorId, allData, connectionDataMap]);

  // Admin per-item toggle handlers
  const onToggleVMImage = useCallback(
    async (urn: string, allowed: boolean) => {
      const current = adminSettings?.allowedVMImageUrns ?? null;
      const allKeys = allData.vm_images.map((i) => i.urn);
      const next = new Set(current === null ? allKeys : current);
      if (allowed) next.add(urn);
      else next.delete(urn);
      const newSettings: AzureAdminSettings = {
        allowedVMImageUrns: [...next],
        allowedLocationNames: adminSettings?.allowedLocationNames ?? null,
        allowedVMSizeNames: adminSettings?.allowedVMSizeNames ?? null,
        allowedResourceGroupNames: adminSettings?.allowedResourceGroupNames ?? null,
        allowedVMIds: adminSettings?.allowedVMIds ?? null,
        allowedVNetNames: adminSettings?.allowedVNetNames ?? null,
        allowedStorageAccountNames: adminSettings?.allowedStorageAccountNames ?? null,
      };
      setAdminSettings(newSettings);
      await patchProviderState('azure', { admin_settings: newSettings }, organizationId);
    },
    [adminSettings, allData.vm_images, organizationId]
  );

  const onToggleLocation = useCallback(
    async (name: string, allowed: boolean) => {
      const current = adminSettings?.allowedLocationNames ?? null;
      const allKeys = allData.locations.map((l) => l.name);
      const next = new Set(current === null ? allKeys : current);
      if (allowed) next.add(name);
      else next.delete(name);
      const newSettings: AzureAdminSettings = {
        allowedVMImageUrns: adminSettings?.allowedVMImageUrns ?? null,
        allowedLocationNames: [...next],
        allowedVMSizeNames: adminSettings?.allowedVMSizeNames ?? null,
        allowedResourceGroupNames: adminSettings?.allowedResourceGroupNames ?? null,
        allowedVMIds: adminSettings?.allowedVMIds ?? null,
        allowedVNetNames: adminSettings?.allowedVNetNames ?? null,
        allowedStorageAccountNames: adminSettings?.allowedStorageAccountNames ?? null,
      };
      setAdminSettings(newSettings);
      await patchProviderState('azure', { admin_settings: newSettings }, organizationId);
    },
    [adminSettings, allData.locations, organizationId]
  );

  const onToggleVMSize = useCallback(
    async (name: string, allowed: boolean) => {
      const current = adminSettings?.allowedVMSizeNames ?? null;
      const allKeys = allData.vm_sizes.map((s) => s.name);
      const next = new Set(current === null ? allKeys : current);
      if (allowed) next.add(name);
      else next.delete(name);
      const newSettings: AzureAdminSettings = {
        allowedVMImageUrns: adminSettings?.allowedVMImageUrns ?? null,
        allowedLocationNames: adminSettings?.allowedLocationNames ?? null,
        allowedVMSizeNames: [...next],
        allowedResourceGroupNames: adminSettings?.allowedResourceGroupNames ?? null,
        allowedVMIds: adminSettings?.allowedVMIds ?? null,
        allowedVNetNames: adminSettings?.allowedVNetNames ?? null,
        allowedStorageAccountNames: adminSettings?.allowedStorageAccountNames ?? null,
      };
      setAdminSettings(newSettings);
      await patchProviderState('azure', { admin_settings: newSettings }, organizationId);
    },
    [adminSettings, allData.vm_sizes, organizationId]
  );

  const onToggleResourceGroup = useCallback(
    async (name: string, allowed: boolean) => {
      const current = adminSettings?.allowedResourceGroupNames ?? null;
      const allKeys = allData.resource_groups.map((rg) => rg.name);
      const next = new Set(current === null ? allKeys : current);
      if (allowed) next.add(name);
      else next.delete(name);
      const newSettings: AzureAdminSettings = {
        allowedVMImageUrns: adminSettings?.allowedVMImageUrns ?? null,
        allowedLocationNames: adminSettings?.allowedLocationNames ?? null,
        allowedVMSizeNames: adminSettings?.allowedVMSizeNames ?? null,
        allowedResourceGroupNames: [...next],
        allowedVMIds: adminSettings?.allowedVMIds ?? null,
        allowedVNetNames: adminSettings?.allowedVNetNames ?? null,
        allowedStorageAccountNames: adminSettings?.allowedStorageAccountNames ?? null,
      };
      setAdminSettings(newSettings);
      await patchProviderState('azure', { admin_settings: newSettings }, organizationId);
    },
    [adminSettings, allData.resource_groups, organizationId]
  );

  const onToggleVM = useCallback(
    async (id: string, allowed: boolean) => {
      const current = adminSettings?.allowedVMIds ?? null;
      const allKeys = allData.vms.map((vm) => vm.id);
      const next = new Set(current === null ? allKeys : current);
      if (allowed) next.add(id);
      else next.delete(id);
      const newSettings: AzureAdminSettings = {
        allowedVMImageUrns: adminSettings?.allowedVMImageUrns ?? null,
        allowedLocationNames: adminSettings?.allowedLocationNames ?? null,
        allowedVMSizeNames: adminSettings?.allowedVMSizeNames ?? null,
        allowedResourceGroupNames: adminSettings?.allowedResourceGroupNames ?? null,
        allowedVMIds: [...next],
        allowedVNetNames: adminSettings?.allowedVNetNames ?? null,
        allowedStorageAccountNames: adminSettings?.allowedStorageAccountNames ?? null,
      };
      setAdminSettings(newSettings);
      await patchProviderState('azure', { admin_settings: newSettings }, organizationId);
    },
    [adminSettings, allData.vms, organizationId]
  );

  const onToggleVNet = useCallback(
    async (name: string, allowed: boolean) => {
      const current = adminSettings?.allowedVNetNames ?? null;
      const allKeys = allData.vnets.map((vn) => vn.name);
      const next = new Set(current === null ? allKeys : current);
      if (allowed) next.add(name);
      else next.delete(name);
      const newSettings: AzureAdminSettings = {
        allowedVMImageUrns: adminSettings?.allowedVMImageUrns ?? null,
        allowedLocationNames: adminSettings?.allowedLocationNames ?? null,
        allowedVMSizeNames: adminSettings?.allowedVMSizeNames ?? null,
        allowedResourceGroupNames: adminSettings?.allowedResourceGroupNames ?? null,
        allowedVMIds: adminSettings?.allowedVMIds ?? null,
        allowedVNetNames: [...next],
        allowedStorageAccountNames: adminSettings?.allowedStorageAccountNames ?? null,
      };
      setAdminSettings(newSettings);
      await patchProviderState('azure', { admin_settings: newSettings }, organizationId);
    },
    [adminSettings, allData.vnets, organizationId]
  );

  const onToggleStorage = useCallback(
    async (name: string, allowed: boolean) => {
      const current = adminSettings?.allowedStorageAccountNames ?? null;
      const allKeys = allData.storage_accounts.map((sa) => sa.name);
      const next = new Set(current === null ? allKeys : current);
      if (allowed) next.add(name);
      else next.delete(name);
      const newSettings: AzureAdminSettings = {
        allowedVMImageUrns: adminSettings?.allowedVMImageUrns ?? null,
        allowedLocationNames: adminSettings?.allowedLocationNames ?? null,
        allowedVMSizeNames: adminSettings?.allowedVMSizeNames ?? null,
        allowedResourceGroupNames: adminSettings?.allowedResourceGroupNames ?? null,
        allowedVMIds: adminSettings?.allowedVMIds ?? null,
        allowedVNetNames: adminSettings?.allowedVNetNames ?? null,
        allowedStorageAccountNames: [...next],
      };
      setAdminSettings(newSettings);
      await patchProviderState('azure', { admin_settings: newSettings }, organizationId);
    },
    [adminSettings, allData.storage_accounts, organizationId]
  );

  const onConnect = useCallback(
    async (entryId: string, credentialId: number) => {
      setConnectingId(entryId);
      try {
        await requestGet(awxAPI`/credentials/${credentialId.toString()}/`);
        await updateCloudConnectionApi(entryId, {
          status: 'connected',
          credentialId,
          error: '',
        });
        loadConnections();
        alertToaster.addAlert({ variant: 'success', title: t('Connected.') });
      } catch (err) {
        const detail =
          isRequestError(err) && err.details
            ? err.details
            : err instanceof Error
              ? err.message
              : String(err);
        await updateCloudConnectionApi(entryId, {
          status: 'misconfigured',
          credentialId,
          error: detail,
        });
        loadConnections();
        alertToaster.addAlert({
          variant: 'danger',
          title: t('Failed to connect.'),
          children: detail,
        });
      } finally {
        setConnectingId(null);
      }
    },
    [alertToaster, loadConnections, t]
  );

  const onDisconnect = useCallback(
    async (entryId: string) => {
      await updateCloudConnectionApi(entryId, { status: 'disconnected', error: '' });
      loadConnections();
    },
    [loadConnections]
  );

  const onRemove = useCallback(
    async (entryId: string) => {
      await removeCloudConnectionApi(entryId);
      loadConnections();
    },
    [loadConnections]
  );

  const onAddAndConnect = useCallback(
    async (name: string, credentialId: number) => {
      const cred = credData?.results?.find((c) => c.id === credentialId);
      const newEntry = await createCloudConnection('azure', {
        name,
        status: 'disconnected',
        credentialId,
        credentialName: cred?.name ?? '',
        error: '',
        organizationId,
      });
      loadConnections();
      await onConnect(newEntry.id, credentialId);
    },
    [credData, loadConnections, onConnect, organizationId]
  );

  const onPull = async () => {
    const toPull = connectedEntries.filter((e) => e.credentialId);
    if (toPull.length === 0) {
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Connect an Azure credential first.'),
      });
      return;
    }

    setIsPulling(true);
    let successCount = 0;
    let errorCount = 0;

    for (const conn of toPull) {
      try {
        await postRequest<
          { pulled_at: string; subscription_id: string; resource_group_count: number },
          { credential_id: number; connection_id: string; organization: number | null }
        >(awxAPI`/catalog_cloud/connectors/azure/pull_resources/`, {
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
    const state = await fetchProviderState('azure', organizationId);
    if (state?.provider_data !== undefined) setRawProviderData(state.provider_data);

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
        title: t('Failed to pull Azure data from all connections.'),
      });
    }
    setIsPulling(false);
  };

  if (!canManageCloud) {
    return (
      <PageLayout>
        <PageHeader
          title={t('Microsoft Azure')}
          description={t('Azure subscription management for administrators.')}
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
        title={t('Microsoft Azure')}
        description={t('Azure subscription management for administrators.')}
        headerActions={
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
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
            {allData.pulledAt && (
              <span
                style={{
                  fontSize: '0.8rem',
                  color: 'var(--pf-v5-global--Color--200)',
                  whiteSpace: 'nowrap',
                }}
              >
                {t('Last pull: {{time}}', { time: new Date(allData.pulledAt).toLocaleString() })}
              </span>
            )}
          </div>
        }
      />

      {connectionEntries.length === 0 ? (
        <PageSection>
          <EmptyState>
            <EmptyStateIcon icon={CubesIcon} />
            <Title headingLevel="h4" size="lg">
              {t('No Azure connections configured')}
            </Title>
            <EmptyStateBody>
              {t(
                'Add an Azure Resource Manager (Terraform) credential to connect your Azure subscription.'
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
              t('Resource Groups') +
              (activeData.resource_groups.length > 0
                ? ` (${activeData.resource_groups.length})`
                : '')
            }
          >
            <ResourceGroupsTab
              resourceGroups={activeData.resource_groups}
              adminSettings={adminSettings}
              onToggle={(name, allowed) => void onToggleResourceGroup(name, allowed)}
            />
          </PageTab>
          <PageTab
            label={
              t('Virtual Machines') +
              (activeData.vms.length > 0 ? ` (${activeData.vms.length})` : '')
            }
          >
            <VMsTab
              vms={activeData.vms}
              adminSettings={adminSettings}
              onToggle={(id, allowed) => void onToggleVM(id, allowed)}
            />
          </PageTab>
          <PageTab
            label={
              t('Virtual Networks') +
              (activeData.vnets.length > 0 ? ` (${activeData.vnets.length})` : '')
            }
          >
            <VNetsTab
              vnets={activeData.vnets}
              adminSettings={adminSettings}
              onToggle={(name, allowed) => void onToggleVNet(name, allowed)}
            />
          </PageTab>
          <PageTab
            label={
              t('Storage') +
              (activeData.storage_accounts.length > 0
                ? ` (${activeData.storage_accounts.length})`
                : '')
            }
          >
            <StorageTab
              storageAccounts={activeData.storage_accounts}
              adminSettings={adminSettings}
              onToggle={(name, allowed) => void onToggleStorage(name, allowed)}
            />
          </PageTab>
          <PageTab
            label={
              t('Locations') +
              (activeData.locations.length > 0 ? ` (${activeData.locations.length})` : '')
            }
          >
            <LocationsTab
              locations={activeData.locations}
              adminSettings={adminSettings}
              onToggle={(name, allowed) => void onToggleLocation(name, allowed)}
            />
          </PageTab>
          <PageTab
            label={
              t('VM Images') +
              (activeData.vm_images.length > 0 ? ` (${activeData.vm_images.length})` : '')
            }
          >
            <VMImagesTab
              vmImages={activeData.vm_images}
              adminSettings={adminSettings}
              onToggle={(urn, allowed) => void onToggleVMImage(urn, allowed)}
            />
          </PageTab>
          <PageTab
            label={
              t('VM Sizes') +
              (activeData.vm_sizes.length > 0 ? ` (${activeData.vm_sizes.length})` : '')
            }
          >
            <VMSizesTab
              vmSizes={activeData.vm_sizes}
              adminSettings={adminSettings}
              onToggle={(name, allowed) => void onToggleVMSize(name, allowed)}
            />
          </PageTab>
        </PageTabs>
      )}

      <ManageConnectionsModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        entries={connectionEntries}
        azureCredentials={azureCredentials}
        allCredentials={credData?.results ?? []}
        onConnect={onConnect}
        onDisconnect={(id) => void onDisconnect(id)}
        onRemove={(id) => void onRemove(id)}
        onAddAndConnect={onAddAndConnect}
        connectingId={connectingId}
      />
    </PageLayout>
  );
}
