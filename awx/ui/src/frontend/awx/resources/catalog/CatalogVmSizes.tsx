import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import {
  Alert,
  Button,
  EmptyState,
  EmptyStateBody,
  EmptyStateIcon,
  FormGroup,
  FormSelect,
  FormSelectOption,
  PageSection,
  Spinner,
  TextInput,
  Title,
} from '@patternfly/react-core';
import { requestPatch } from '../../../common/crud/Data';
import { useGet } from '../../../common/crud/useGet';
import { PageHeader, PageLayout, usePageAlertToaster } from '../../../../framework';
import { CubesIcon } from '@patternfly/react-icons';
import { PageTab, PageTabs } from '../../../../framework/PageTabs/PageTabs';
import { awxAPI } from '../../common/api/awx-utils';
import { CatalogItem } from '../../interfaces/CatalogItem';

const SelectorPanel = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  padding: 16px;
  background-color: #222428;
  border: 1px solid var(--pf-v5-global--BorderColor--100);
  border-radius: 6px;
  margin-bottom: 16px;
`;

const StyledTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  margin-top: 16px;
  margin-bottom: 16px;

  th {
    background-color: #222428;
    color: var(--pf-v5-global--Color--100);
    font-weight: 600;
    padding: 12px 16px;
    border-bottom: 2px solid var(--pf-v5-global--BorderColor--100);
    font-size: 0.875rem;
    text-align: left;
  }

  td {
    padding: 8px 16px;
    border-bottom: 1px solid var(--pf-v5-global--BorderColor--100);
    vertical-align: middle;
  }

  tr:hover td {
    background-color: rgba(255, 255, 255, 0.03);
  }
`;

interface CatalogItemListResponse {
  count: number;
  results: CatalogItem[];
}

interface VmSizeRow {
  name: string;
  cpu: string;
  ram: string;
  cluster: string;
  node: string;
}

const hypervisorProviders = ['proxmox', 'vmware', 'hyperv', 'kvm'];
const publicCloudProviders = ['digitalocean', 'aws', 'azure', 'gcp'];

function readVmSizes(rawSchema: Record<string, unknown> | null, provider: string): VmSizeRow[] {
  const schema = rawSchema && typeof rawSchema === 'object' ? rawSchema : {};
  const raw = (schema as { x_vm_sizes?: unknown }).x_vm_sizes;
  if (!raw || typeof raw !== 'object') {
    return [];
  }

  const rows: VmSizeRow[] = [];
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') {
      continue;
    }

    const preset = value as {
      cpu?: unknown;
      ram?: unknown;
      memory?: unknown;
      provider?: unknown;
      cluster?: unknown;
      node?: unknown;
    };
    const presetProvider = typeof preset.provider === 'string' ? preset.provider : undefined;

    const isLegacyProxmoxPreset = !presetProvider && provider === 'proxmox';
    const matchesProvider = presetProvider === provider || isLegacyProxmoxPreset;
    if (!matchesProvider) {
      continue;
    }

    const cpu = preset.cpu;
    const ram = preset.ram ?? preset.memory;
    if (cpu === undefined || ram === undefined) {
      continue;
    }

    rows.push({
      name,
      cpu: String(cpu),
      ram: String(ram),
      cluster: typeof preset.cluster === 'string' ? preset.cluster : '',
      node: typeof preset.node === 'string' ? preset.node : '',
    });
  }

  return rows;
}

export function CatalogVmSizes() {
  const { t } = useTranslation();
  const alertToaster = usePageAlertToaster();
  const [hypervisorProvider, setHypervisorProvider] = useState('proxmox');
  const [publicCloudProvider, setPublicCloudProvider] = useState('digitalocean');
  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [rows, setRows] = useState<VmSizeRow[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const { data, isLoading, refresh } = useGet<CatalogItemListResponse>(awxAPI`/catalog_items/`);
  const items = data?.results ?? [];

  useEffect(() => {
    if (!items.length) {
      setSelectedItemId('');
      return;
    }
    if (!selectedItemId) {
      setSelectedItemId(String(items[0].id));
      return;
    }
    const exists = items.some((item) => String(item.id) === selectedItemId);
    if (!exists) {
      setSelectedItemId(String(items[0].id));
    }
  }, [items, selectedItemId]);

  const selectedItem = useMemo(
    () => items.find((item) => String(item.id) === selectedItemId),
    [items, selectedItemId]
  );

  useEffect(() => {
    if (!selectedItem) {
      setRows([]);
      return;
    }
    setRows(readVmSizes(selectedItem.extra_vars_schema, hypervisorProvider));
  }, [selectedItem, hypervisorProvider]);

  const onChangeRow = (index: number, field: keyof VmSizeRow, value: string) => {
    setRows((current) =>
      current.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row))
    );
  };

  const onAddRow = () => {
    setRows((current) => [...current, { name: '', cpu: '', ram: '', cluster: '', node: '' }]);
  };

  const onDeleteRow = (index: number) => {
    setRows((current) => current.filter((_, rowIndex) => rowIndex !== index));
  };

  const canSave = Boolean(selectedItem?.summary_fields?.user_capabilities?.edit);

  const onSave = async () => {
    if (!selectedItem) {
      return;
    }

    const nonEmptyRows = rows.filter((row) => row.name.trim() && row.cpu.trim() && row.ram.trim());

    const uniqueNames = new Set<string>();
    for (const row of nonEmptyRows) {
      const normalizedName = row.name.trim().toLowerCase();
      if (uniqueNames.has(normalizedName)) {
        alertToaster.addAlert({
          variant: 'danger',
          title: t('VM size names must be unique per provider.'),
        });
        return;
      }
      uniqueNames.add(normalizedName);
    }

    const schema =
      selectedItem.extra_vars_schema && typeof selectedItem.extra_vars_schema === 'object'
        ? ({ ...selectedItem.extra_vars_schema } as Record<string, unknown>)
        : {};

    const existingSizesRaw = (schema as { x_vm_sizes?: unknown }).x_vm_sizes;
    const existingSizes =
      existingSizesRaw && typeof existingSizesRaw === 'object'
        ? ({ ...existingSizesRaw } as Record<string, unknown>)
        : {};

    const preservedEntries: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(existingSizes)) {
      if (!value || typeof value !== 'object') {
        continue;
      }
      const preset = value as { provider?: unknown };
      const presetProvider = typeof preset.provider === 'string' ? preset.provider : undefined;
      const legacyProxmoxPreset = !presetProvider;
      const belongsToActiveProvider =
        presetProvider === hypervisorProvider ||
        (legacyProxmoxPreset && hypervisorProvider === 'proxmox');

      if (!belongsToActiveProvider) {
        preservedEntries[name] = value;
      }
    }

    for (const row of nonEmptyRows) {
      const cpuNum = Number(row.cpu);
      const ramNum = Number(row.ram);
      preservedEntries[row.name.trim()] = {
        cpu: Number.isNaN(cpuNum) ? row.cpu.trim() : cpuNum,
        ram: Number.isNaN(ramNum) ? row.ram.trim() : ramNum,
        provider: hypervisorProvider,
        cluster: row.cluster.trim() || undefined,
        node: row.node.trim() || undefined,
      };
    }

    schema.x_vm_sizes = preservedEntries;

    setIsSaving(true);
    try {
      await requestPatch<Record<string, unknown>>(
        awxAPI`/catalog_items/${selectedItem.id.toString()}/`,
        {
          extra_vars_schema: schema,
        }
      );
      alertToaster.addAlert({
        variant: 'success',
        title: t('Saved VM sizes for {{item}} ({{provider}}).', {
          item: selectedItem.name,
          provider: hypervisorProvider,
        }),
      });
      refresh();
    } catch (error) {
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Failed to save VM sizes'),
        children: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <PageLayout>
      <PageHeader
        title={t('VM Sizes')}
        description={t(
          'Dedicated control plane for VM size presets. Custom presets apply only to hypervisors; public clouds use provider-native sizes.'
        )}
      />
      <PageSection variant="light">
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <Spinner />
          </div>
        ) : !items.length ? (
          <EmptyState>
            <EmptyStateIcon icon={CubesIcon} />
            <Title headingLevel="h4" size="lg">
              {t('No catalog items')}
            </Title>
            <EmptyStateBody>
              {t('Create a catalog item first, then define VM size presets here.')}
            </EmptyStateBody>
          </EmptyState>
        ) : (
          <PageTabs initialTabIndex={0}>
            <PageTab label={t('Hypervisors')}>
              <div style={{ marginTop: 16, display: 'grid', gap: 16 }}>
                <Alert
                  isInline
                  variant="info"
                  title={t('Custom VM sizes are scoped to hypervisors only.')}
                >
                  {t(
                    'Use cluster and node fields to prepare provider mapping for deployment placement in future releases.'
                  )}
                </Alert>

                <SelectorPanel>
                  <FormGroup label={t('Catalog item')} fieldId="catalog-item-select">
                    <FormSelect
                      id="catalog-item-select"
                      value={selectedItemId}
                      onChange={(_, value) => setSelectedItemId(String(value))}
                    >
                      {items.map((item) => (
                        <FormSelectOption key={item.id} value={String(item.id)} label={item.name} />
                      ))}
                    </FormSelect>
                  </FormGroup>

                  <FormGroup label={t('Hypervisor provider')} fieldId="hypervisor-provider-select">
                    <FormSelect
                      id="hypervisor-provider-select"
                      value={hypervisorProvider}
                      onChange={(_, value) => setHypervisorProvider(String(value))}
                    >
                      {hypervisorProviders.map((provider) => (
                        <FormSelectOption key={provider} value={provider} label={provider} />
                      ))}
                    </FormSelect>
                  </FormGroup>
                </SelectorPanel>

                <div style={{ overflowX: 'auto' }}>
                  <StyledTable>
                    <thead>
                      <tr>
                        <th>{t('Name')}</th>
                        <th>{t('CPU')}</th>
                        <th>{t('RAM')}</th>
                        <th>{t('Cluster')}</th>
                        <th>{t('Node')}</th>
                        <th>{t('Actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, index) => (
                        <tr key={`vm-size-row-${index}`}>
                          <td>
                            <TextInput
                              id={`vm-size-name-${index}`}
                              aria-label={t('VM size name row {{index}}', { index: index + 1 })}
                              value={row.name}
                              onChange={(_, value) => onChangeRow(index, 'name', String(value))}
                            />
                          </td>
                          <td>
                            <TextInput
                              id={`vm-size-cpu-${index}`}
                              aria-label={t('VM size CPU row {{index}}', { index: index + 1 })}
                              value={row.cpu}
                              onChange={(_, value) => onChangeRow(index, 'cpu', String(value))}
                            />
                          </td>
                          <td>
                            <TextInput
                              id={`vm-size-ram-${index}`}
                              aria-label={t('VM size RAM row {{index}}', { index: index + 1 })}
                              value={row.ram}
                              onChange={(_, value) => onChangeRow(index, 'ram', String(value))}
                            />
                          </td>
                          <td>
                            <TextInput
                              id={`vm-size-cluster-${index}`}
                              aria-label={t('VM size cluster row {{index}}', { index: index + 1 })}
                              value={row.cluster}
                              onChange={(_, value) => onChangeRow(index, 'cluster', String(value))}
                            />
                          </td>
                          <td>
                            <TextInput
                              id={`vm-size-node-${index}`}
                              aria-label={t('VM size node row {{index}}', { index: index + 1 })}
                              value={row.node}
                              onChange={(_, value) => onChangeRow(index, 'node', String(value))}
                            />
                          </td>
                          <td>
                            <Button variant="link" isDanger onClick={() => onDeleteRow(index)}>
                              {t('Remove')}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </StyledTable>
                </div>

                <div style={{ display: 'flex', gap: 12 }}>
                  <Button variant="secondary" onClick={onAddRow}>
                    {t('Add VM size')}
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => void onSave()}
                    isLoading={isSaving}
                    isDisabled={!canSave}
                  >
                    {t('Save VM sizes')}
                  </Button>
                </div>

                {!canSave && (
                  <Alert
                    isInline
                    variant="warning"
                    title={t('You do not have permission to edit this catalog item.')}
                  />
                )}
              </div>
            </PageTab>

            <PageTab label={t('Public clouds')}>
              <div style={{ marginTop: 16, display: 'grid', gap: 16 }}>
                <SelectorPanel>
                  <FormGroup label={t('Cloud provider')} fieldId="public-cloud-provider-select">
                    <FormSelect
                      id="public-cloud-provider-select"
                      value={publicCloudProvider}
                      onChange={(_, value) => setPublicCloudProvider(String(value))}
                    >
                      {publicCloudProviders.map((provider) => (
                        <FormSelectOption key={provider} value={provider} label={provider} />
                      ))}
                    </FormSelect>
                  </FormGroup>
                </SelectorPanel>

                {publicCloudProvider === 'digitalocean' ? (
                  <Alert
                    isInline
                    variant="info"
                    title={t('DigitalOcean provider enabled for testing')}
                  >
                    {t(
                      'Custom VM sizes are disabled for DigitalOcean because public clouds should use provider-native plans. This tab is a planning surface for mapping plan slugs and image catalogs in future work.'
                    )}
                  </Alert>
                ) : (
                  <Alert isInline variant="info" title={t('Provider mapping planned')}>
                    {t(
                      'This provider tab is reserved for future marketplace and cloud template mapping. Public cloud plan catalogs will be synced from provider APIs.'
                    )}
                  </Alert>
                )}
              </div>
            </PageTab>
          </PageTabs>
        )}
      </PageSection>
    </PageLayout>
  );
}
