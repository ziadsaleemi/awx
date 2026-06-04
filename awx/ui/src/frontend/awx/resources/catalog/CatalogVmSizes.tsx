import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  ButtonVariant,
  Form,
  FormGroup,
  Modal,
  ModalVariant,
  TextInput,
} from '@patternfly/react-core';
import { PencilAltIcon, PlusCircleIcon, TrashIcon } from '@patternfly/react-icons';
import {
  IPageAction,
  ITableColumn,
  IToolbarFilter,
  PageActionSelection,
  PageActionType,
  PageHeader,
  PageLayout,
  PageTable,
  TextCell,
  ToolbarFilterType,
  useInMemoryView,
  usePageAlertToaster,
} from '../../../../framework';
import { useGet } from '../../../common/crud/useGet';
import {
  ApiCloudProviderState,
  CloudProviderSettingsState,
  getProviderStateUrl,
  patchProviderState,
} from '../../resources/cloud/cloudConnectionStore';
import { useCloudOrganization } from '../../resources/cloud/useCloudOrganization';

// ── types ─────────────────────────────────────────────────────────────────────

interface VmSize {
  name: string;
  cpu: string;
  ram: string;
  enabled?: boolean;
}

// ── constants ─────────────────────────────────────────────────────────────────

const GLOBAL_PROVIDER_ID = 'global';

// ── helpers ───────────────────────────────────────────────────────────────────

function readVmSizes(state: ApiCloudProviderState | undefined): VmSize[] {
  if (!state?.provider_settings) return [];
  const settings = state.provider_settings as unknown as { vm_sizes?: VmSize[] };
  return Array.isArray(settings.vm_sizes) ? settings.vm_sizes : [];
}

async function persistVmSizes(
  globalState: ApiCloudProviderState | undefined,
  sizes: VmSize[],
  organizationId?: number | null
): Promise<ApiCloudProviderState | null> {
  const existing = (globalState?.provider_settings as unknown as Record<string, unknown>) ?? {};
  return patchProviderState(
    GLOBAL_PROVIDER_ID,
    {
      provider_settings: {
        ...existing,
        vm_sizes: sizes,
      } as unknown as CloudProviderSettingsState,
    },
    organizationId
  );
}

// ── AddVmSizeModal ────────────────────────────────────────────────────────────

interface AddVmSizeModalProps {
  existingNames: string[];
  onAdd: (size: VmSize) => void;
  onClose: () => void;
}

function AddVmSizeModal({ existingNames, onAdd, onClose }: AddVmSizeModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [cpu, setCpu] = useState('');
  const [ram, setRam] = useState('');

  const isDuplicate = existingNames.map((n) => n.toLowerCase()).includes(name.trim().toLowerCase());
  const isValid = name.trim() !== '' && cpu.trim() !== '' && ram.trim() !== '' && !isDuplicate;

  return (
    <Modal
      variant={ModalVariant.small}
      title={t('Add VM Size')}
      isOpen
      onClose={onClose}
      actions={[
        <Button
          key="add"
          variant="primary"
          onClick={() => onAdd({ name: name.trim(), cpu: cpu.trim(), ram: ram.trim() })}
          isDisabled={!isValid}
        >
          {t('Add')}
        </Button>,
        <Button key="cancel" variant="link" onClick={onClose}>
          {t('Cancel')}
        </Button>,
      ]}
    >
      <Form>
        <FormGroup label={t('Name')} fieldId="add-vm-size-name" isRequired>
          <TextInput
            id="add-vm-size-name"
            value={name}
            onChange={(_, v) => setName(v)}
            placeholder={t('e.g. Medium')}
            validated={isDuplicate ? 'error' : 'default'}
          />
          {isDuplicate && (
            <span style={{ color: 'var(--pf-global--danger-color--100)', fontSize: '0.875rem' }}>
              {t('A VM size with this name already exists.')}
            </span>
          )}
        </FormGroup>
        <FormGroup label={t('CPU cores')} fieldId="add-vm-size-cpu" isRequired>
          <TextInput
            id="add-vm-size-cpu"
            type="number"
            value={cpu}
            onChange={(_, v) => setCpu(v)}
            placeholder="4"
          />
        </FormGroup>
        <FormGroup label={t('RAM (GB)')} fieldId="add-vm-size-ram" isRequired>
          <TextInput
            id="add-vm-size-ram"
            type="number"
            value={ram}
            onChange={(_, v) => setRam(v)}
            placeholder="8"
          />
        </FormGroup>
      </Form>
    </Modal>
  );
}

// ── EditVmSizeModal ────────────────────────────────────────────────────────────

interface EditVmSizeModalProps {
  size: VmSize;
  existingNames: string[];
  onSave: (original: VmSize, updated: VmSize) => void;
  onClose: () => void;
}

function EditVmSizeModal({ size, existingNames, onSave, onClose }: EditVmSizeModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(size.name);
  const [cpu, setCpu] = useState(size.cpu);
  const [ram, setRam] = useState(size.ram);

  const isDuplicate =
    name.trim().toLowerCase() !== size.name.toLowerCase() &&
    existingNames.map((n) => n.toLowerCase()).includes(name.trim().toLowerCase());
  const isValid = name.trim() !== '' && cpu.trim() !== '' && ram.trim() !== '' && !isDuplicate;

  return (
    <Modal
      variant={ModalVariant.small}
      title={t('Edit VM Size')}
      isOpen
      onClose={onClose}
      actions={[
        <Button
          key="save"
          variant="primary"
          onClick={() => onSave(size, { name: name.trim(), cpu: cpu.trim(), ram: ram.trim() })}
          isDisabled={!isValid}
        >
          {t('Save')}
        </Button>,
        <Button key="cancel" variant="link" onClick={onClose}>
          {t('Cancel')}
        </Button>,
      ]}
    >
      <Form>
        <FormGroup label={t('Name')} fieldId="edit-vm-size-name" isRequired>
          <TextInput
            id="edit-vm-size-name"
            value={name}
            onChange={(_, v) => setName(v)}
            validated={isDuplicate ? 'error' : 'default'}
          />
          {isDuplicate && (
            <span style={{ color: 'var(--pf-global--danger-color--100)', fontSize: '0.875rem' }}>
              {t('A VM size with this name already exists.')}
            </span>
          )}
        </FormGroup>
        <FormGroup label={t('CPU cores')} fieldId="edit-vm-size-cpu" isRequired>
          <TextInput
            id="edit-vm-size-cpu"
            type="number"
            value={cpu}
            onChange={(_, v) => setCpu(v)}
          />
        </FormGroup>
        <FormGroup label={t('RAM (GB)')} fieldId="edit-vm-size-ram" isRequired>
          <TextInput
            id="edit-vm-size-ram"
            type="number"
            value={ram}
            onChange={(_, v) => setRam(v)}
          />
        </FormGroup>
      </Form>
    </Modal>
  );
}

// ── CatalogVmSizes ────────────────────────────────────────────────────────────

export function CatalogVmSizes() {
  const { t } = useTranslation();
  const alertToaster = usePageAlertToaster();
  const { organizationId } = useCloudOrganization();

  const [sizes, setSizes] = useState<VmSize[] | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editSize, setEditSize] = useState<VmSize | null>(null);

  const { data: globalState, isLoading } = useGet<ApiCloudProviderState>(
    getProviderStateUrl(GLOBAL_PROVIDER_ID, organizationId)
  );

  useEffect(() => {
    if (!isLoading) {
      setSizes(readVmSizes(globalState));
    }
  }, [globalState, isLoading]);

  const doSave = useCallback(
    async (newSizes: VmSize[]) => {
      setIsSaving(true);
      try {
        const result = await persistVmSizes(globalState, newSizes, organizationId);
        if (!result) throw new Error(t('Server returned no data'));
      } catch (error) {
        alertToaster.addAlert({
          variant: 'danger',
          title: t('Failed to save VM sizes'),
          children: error instanceof Error ? error.message : String(error),
        });
        setSizes(readVmSizes(globalState));
      } finally {
        setIsSaving(false);
      }
    },
    [alertToaster, globalState, organizationId, t]
  );

  const onAdd = useCallback(
    (size: VmSize) => {
      setShowAddModal(false);
      const newSizes = [...(sizes ?? []), size];
      setSizes(newSizes);
      void doSave(newSizes);
    },
    [doSave, sizes]
  );

  const onEdit = useCallback(
    (original: VmSize, updated: VmSize) => {
      setEditSize(null);
      const newSizes = (sizes ?? []).map((s) => (s.name === original.name ? updated : s));
      setSizes(newSizes);
      void doSave(newSizes);
    },
    [doSave, sizes]
  );

  const onDelete = useCallback(
    (size: VmSize) => {
      const newSizes = (sizes ?? []).filter((s) => s.name !== size.name);
      setSizes(newSizes);
      void doSave(newSizes);
    },
    [doSave, sizes]
  );

  const onToggleEnabled = useCallback(
    (size: VmSize, enabled: boolean) => {
      const newSizes = (sizes ?? []).map((s) => (s.name === size.name ? { ...s, enabled } : s));
      setSizes(newSizes);
      void doSave(newSizes);
    },
    [doSave, sizes]
  );

  const onDeleteMultiple = useCallback(
    (selected: VmSize[]) => {
      const selectedNames = new Set(selected.map((s) => s.name));
      const newSizes = (sizes ?? []).filter((s) => !selectedNames.has(s.name));
      setSizes(newSizes);
      void doSave(newSizes);
    },
    [doSave, sizes]
  );

  // ── table columns ──────────────────────────────────────────────────────────

  const tableColumns = useMemo<ITableColumn<VmSize>[]>(
    () => [
      {
        header: t('Name'),
        cell: (s) => <TextCell text={s.name} />,
        sort: 'name',
        card: 'name',
        list: 'name',
      },
      {
        header: t('CPU cores'),
        cell: (s) => <TextCell text={s.cpu} />,
        sort: 'cpu',
        card: 'subtitle',
      },
      {
        header: t('RAM (GB)'),
        cell: (s) => <TextCell text={s.ram} />,
        sort: 'ram',
      },
    ],
    [t]
  );

  // ── toolbar filters ────────────────────────────────────────────────────────

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
        key: 'cpu',
        label: t('CPU'),
        type: ToolbarFilterType.SingleText,
        query: 'cpu',
        comparison: 'contains',
      },
      {
        key: 'ram',
        label: t('RAM'),
        type: ToolbarFilterType.SingleText,
        query: 'ram',
        comparison: 'contains',
      },
    ],
    [t]
  );

  // ── in-memory view (enables list / table / card toggle + search + pagination)

  const view = useInMemoryView<VmSize>({
    keyFn: (s) => s.name,
    items: sizes,
    tableColumns,
    toolbarFilters,
    disableQueryString: true,
  });

  // ── toolbar actions ────────────────────────────────────────────────────────

  const toolbarActions = useMemo<IPageAction<VmSize>[]>(
    () => [
      {
        type: PageActionType.Button,
        selection: PageActionSelection.None,
        variant: ButtonVariant.primary,
        isPinned: true,
        label: t('Add VM size'),
        icon: PlusCircleIcon,
        onClick: () => setShowAddModal(true),
        isDisabled: () => (isSaving ? t('Saving…') : undefined),
      },
      { type: PageActionType.Seperator },
      {
        type: PageActionType.Button,
        selection: PageActionSelection.Multiple,
        icon: TrashIcon,
        label: t('Delete selected'),
        onClick: onDeleteMultiple,
        isDanger: true,
        isDisabled: () => (isSaving ? t('Saving…') : undefined),
      },
    ],
    [isSaving, onDeleteMultiple, t]
  );

  // ── row actions ────────────────────────────────────────────────────────────

  const rowActions = useMemo<IPageAction<VmSize>[]>(
    () => [
      {
        type: PageActionType.Switch,
        selection: PageActionSelection.Single,
        ariaLabel: (isEnabled) =>
          isEnabled ? t('Click to disable VM size') : t('Click to enable VM size'),
        onToggle: (size: VmSize, enabled: boolean) => onToggleEnabled(size, enabled),
        isSwitchOn: (size: VmSize) => size.enabled !== false,
        label: t('Enabled'),
        labelOff: t('Disabled'),
        showPinnedLabel: false,
        isPinned: true,
        isDisabled: () => (isSaving ? t('Saving…') : undefined),
      },
      {
        type: PageActionType.Button,
        selection: PageActionSelection.Single,
        isPinned: true,
        icon: PencilAltIcon,
        label: t('Edit'),
        onClick: (size: VmSize) => setEditSize(size),
      },
      { type: PageActionType.Seperator },
      {
        type: PageActionType.Button,
        selection: PageActionSelection.Single,
        icon: TrashIcon,
        label: t('Delete'),
        isDanger: true,
        onClick: (size: VmSize) => onDelete(size),
        isDisabled: () => (isSaving ? t('Saving…') : undefined),
      },
    ],
    [isSaving, onDelete, onToggleEnabled, t]
  );

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <PageLayout>
      <PageHeader
        title={t('VM Sizes')}
        description={t('Manage reusable VM size presets. These apply to all hypervisor providers.')}
      />
      <PageTable<VmSize>
        id="catalog-vm-sizes-table"
        tableColumns={tableColumns}
        toolbarFilters={toolbarFilters}
        toolbarActions={toolbarActions}
        rowActions={rowActions}
        errorStateTitle={t('Error loading VM sizes')}
        emptyStateTitle={t('No VM sizes defined')}
        emptyStateDescription={t(
          'Click "Add VM size" to create reusable presets for all hypervisor providers.'
        )}
        emptyStateButtonIcon={<PlusCircleIcon />}
        emptyStateButtonText={t('Add VM size')}
        emptyStateButtonClick={() => setShowAddModal(true)}
        defaultSubtitle={t('VM Size')}
        {...view}
      />
      {showAddModal && (
        <AddVmSizeModal
          existingNames={(sizes ?? []).map((s) => s.name)}
          onAdd={onAdd}
          onClose={() => setShowAddModal(false)}
        />
      )}
      {editSize && (
        <EditVmSizeModal
          size={editSize}
          existingNames={(sizes ?? []).map((s) => s.name)}
          onSave={onEdit}
          onClose={() => setEditSize(null)}
        />
      )}
    </PageLayout>
  );
}
