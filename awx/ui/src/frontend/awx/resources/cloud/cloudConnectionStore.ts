import { requestGet, postRequest, requestPatch, requestDelete } from '../../../common/crud/Data';
import { awxAPI } from '../../common/api/awx-utils';
import type { GeneratedInventoryPlan } from '../inventories/GeneratedInventory';

/**
 * Dispatch this custom event after any connection change so that other
 * components (e.g. the navigation routes) can react without polling.
 */
export const cloudConnectionsChangedEvent = 'awx-cloud-connections-changed';

export type CloudConnectionStatus = 'connected' | 'disconnected' | 'misconfigured';

/** A single named connection entry for a cloud provider. */
export interface CloudConnectionEntry {
  id: string;
  name: string;
  providerId: string;
  status: CloudConnectionStatus;
  credentialId: number | null;
  credentialName: string;
  error: string;
  organizationId: number | null;
  updatedAt: string;
}

// Backward-compat alias
export type CloudConnectionState = CloudConnectionEntry;

export interface CloudProviderSettingsState {
  allowTemplatePull: boolean;
  allowedTemplatePatterns: string;
  allowedNetworks: string;
  lastTemplatePullAt: string;
}

export interface DigitalOceanImage {
  id: number;
  slug: string;
  name: string;
  distribution: string;
  type: string;
  status: string;
  public: boolean;
  private: boolean;
  min_disk_size: number;
  size_gigabytes: number;
  regions: string[];
}

export interface DigitalOceanSize {
  slug: string;
  description: string;
  memory_mb: number;
  vcpus: number;
  disk_gb: number;
  transfer_tb: number;
  price_monthly: number;
  price_hourly: number;
  available: boolean;
  regions: string[];
}

export interface DigitalOceanRegion {
  slug: string;
  name: string;
  available: boolean;
  features: string[];
}

export interface DigitalOceanVpc {
  id: string;
  name: string;
  region: string;
  ip_range: string;
  default: boolean;
  created_at: string;
}

export interface DigitalOceanProviderData {
  pulledAt: string;
  images: DigitalOceanImage[];
  pricing: DigitalOceanSize[];
  regions: DigitalOceanRegion[];
  vpcs: DigitalOceanVpc[];
}

export type CloudProviderData = DigitalOceanProviderData;

// ── Proxmox VE data types ─────────────────────────────────────────────────────

export interface ProxmoxNode {
  node: string;
  status: 'online' | 'offline' | 'unknown';
  type: 'node';
  maxcpu: number;
  maxmem: number;
  maxdisk: number;
  uptime: number;
}

export interface ProxmoxVM {
  vmid: number;
  name: string;
  status: 'running' | 'stopped' | 'paused';
  node: string;
  cpus: number;
  maxmem: number;
  maxdisk: number;
  uptime: number;
  type: 'qemu';
}

export interface ProxmoxContainer {
  vmid: number;
  name: string;
  status: 'running' | 'stopped';
  node: string;
  cpus: number;
  maxmem: number;
  maxdisk: number;
  uptime: number;
  type: 'lxc';
}

export interface ProxmoxStorage {
  storage: string;
  type: string;
  status: 'active' | 'inactive';
  nodes?: string;
  avail: number;
  total: number;
  used: number;
  shared: boolean;
  content: string;
}

export interface ProxmoxNetwork {
  iface: string;
  type: 'bridge' | 'bond' | 'eth' | 'vlan' | 'alias' | 'OVSBridge';
  node: string;
  active: boolean;
  address?: string;
  netmask?: string;
  cidr?: string;
  bridge_ports?: string;
  comments?: string;
}

export interface ProxmoxProviderData {
  pulledAt: string;
  connectionId?: string;
  nodes: ProxmoxNode[];
  vms: ProxmoxVM[];
  templates: ProxmoxVM[];
  containers: ProxmoxContainer[];
  storage: ProxmoxStorage[];
  networks: ProxmoxNetwork[];
}

/** Admin-configurable allow-list for Proxmox templates shown to end users. */
export interface ProxmoxAdminSettings {
  /** null = all templates allowed; array = explicit allowlist by template name */
  allowedTemplateNames: string[] | null;
  /** null = all nodes allowed; array = explicit allowlist by node name */
  allowedNodeNames: string[] | null;
  /** null = all storage pools allowed; array = explicit allowlist by storage name */
  allowedStorageNames: string[] | null;
  /** null = all network interfaces allowed; array = explicit allowlist by node:iface key */
  allowedNetworkNames: string[] | null;
}

/** Admin-configurable allow-list for VMware vSphere resources shown to end users. */
export interface VmwareAdminSettings {
  /** null = all datacenters allowed; array = explicit allowlist by datacenter id */
  allowedDatacenterIds: string[] | null;
  /** null = all clusters allowed; array = explicit allowlist by cluster id */
  allowedClusterIds: string[] | null;
  /** null = all hosts allowed; array = explicit allowlist by host id */
  allowedHostIds: string[] | null;
  /** null = all VMs allowed; array = explicit allowlist by VM id */
  allowedVMIds: string[] | null;
  /** null = all networks allowed; array = explicit allowlist by network name */
  allowedNetworkNames: string[] | null;
  /** null = all datastores allowed; array = explicit allowlist by datastore name */
  allowedDatastoreNames: string[] | null;
}

/** Admin-configurable allow-list for Azure resources shown to end users. */
export interface AzureAdminSettings {
  /** null = all VM images allowed; array = explicit allowlist by URN */
  allowedVMImageUrns: string[] | null;
  /** null = all locations allowed; array = explicit allowlist by location name */
  allowedLocationNames: string[] | null;
  /** null = all VM sizes allowed; array = explicit allowlist by size name */
  allowedVMSizeNames: string[] | null;
  /** null = all resource groups allowed; array = explicit allowlist by name */
  allowedResourceGroupNames: string[] | null;
  /** null = all VMs allowed; array = explicit allowlist by Azure resource ID */
  allowedVMIds: string[] | null;
  /** null = all virtual networks allowed; array = explicit allowlist by name */
  allowedVNetNames: string[] | null;
  /** null = all storage accounts allowed; array = explicit allowlist by name */
  allowedStorageAccountNames: string[] | null;
}

// ── VMware vSphere data types ─────────────────────────────────────────────────

export interface VmwareDatacenter {
  id: string;
  name: string;
  cluster_count?: number;
  host_count?: number;
  datastore_count?: number;
  network_count?: number;
}

export interface VmwareCluster {
  id: string;
  name: string;
  datacenter_id?: string;
  ha_enabled: boolean;
  drs_enabled: boolean;
  host_count: number;
}

export interface VmwareHost {
  id: string;
  name: string;
  cluster_id?: string;
  power_state: string;
  connection_state: string;
  cpu_count?: number;
  memory_size_mib?: number;
  vm_count?: number;
}

export interface VmwareVM {
  id: string;
  name: string;
  power_state: string;
  host_id?: string;
  cluster_id?: string;
  memory_size_mib: number;
  cpu_count: number;
  guest_os?: string;
  guest_full_name?: string;
  guest_hostname?: string;
  ip_address?: string;
  instance_uuid?: string;
  bios_uuid?: string;
  hardware_version?: string;
  cpu_cores_per_socket?: number;
  cpu_hot_add_enabled?: boolean;
  memory_hot_add_enabled?: boolean;
  disk_count?: number;
  disk_capacity_bytes?: number;
  datastore_names?: string[];
  nics_count?: number;
  cdrom_count?: number;
}

export interface VmwareNetwork {
  id: string;
  name: string;
  type: string;
  datacenter_id?: string;
}

export interface VmwareDatastore {
  id: string;
  name: string;
  type: string;
  capacity_mb: number;
  free_space_mb: number;
  accessible: boolean;
  datacenter_id?: string;
}

export interface VmwareProviderData {
  pulledAt: string;
  connectionId: string;
  datacenters: VmwareDatacenter[];
  clusters: VmwareCluster[];
  hosts: VmwareHost[];
  vms: VmwareVM[];
  networks: VmwareNetwork[];
  datastores: VmwareDatastore[];
}

// ── Azure data types ──────────────────────────────────────────────────────────

export interface AzureSubscription {
  id: string;
  display_name: string;
  state: string;
  tenant_id: string;
}

export interface AzureResourceGroup {
  id: string;
  name: string;
  location: string;
  provisioning_state: string;
  tags?: Record<string, string>;
}

export interface AzureVM {
  id: string;
  name: string;
  location: string;
  resource_group: string;
  vm_size: string;
  os_type: string;
  power_state?: string;
  provisioning_state: string;
  tags?: Record<string, string>;
}

export interface AzureVNet {
  id: string;
  name: string;
  location: string;
  resource_group: string;
  address_space: string[];
  provisioning_state: string;
}

export interface AzureStorageAccount {
  id: string;
  name: string;
  location: string;
  resource_group: string;
  kind: string;
  sku: string;
  provisioning_state: string;
}

export interface AzureLocation {
  id: string;
  name: string;
  display_name: string;
  region_type: string;
}

export interface AzureVMImage {
  id: string;
  name: string;
  publisher: string;
  offer: string;
  sku: string;
  version: string;
  os_type: string; // "Linux" | "Windows" | ""
  image_type: string; // "marketplace" | "custom" | "gallery"
  location: string;
  urn: string; // publisher:offer:sku:version (Terraform reference)
  description?: string;
}

export interface AzureVMSize {
  name: string; // e.g. "Standard_D4s_v5"
  tier: string; // "Standard" | "Basic"
  family: string; // e.g. "standardDSv5Family"
  vcpus: number;
  memory_gb: number;
  gpus: number;
  max_data_disks: number;
  max_nics: number;
  premium_io: boolean;
  ultra_ssd: boolean;
  accelerated_networking: boolean;
  zones: string[];
  location: string;
  price_per_hour: number | null; // Linux pay-as-you-go USD/hr (null if not available)
}

export interface AzureProviderData {
  pulledAt: string;
  connectionId: string;
  subscription_id: string;
  resource_groups: AzureResourceGroup[];
  vms: AzureVM[];
  vnets: AzureVNet[];
  storage_accounts: AzureStorageAccount[];
  locations: AzureLocation[];
  vm_images: AzureVMImage[];
  vm_sizes: AzureVMSize[];
}

// ── API response types ────────────────────────────────────────────────────────

interface ApiCloudConnection {
  id: number;
  provider_id: string;
  name: string;
  status: CloudConnectionStatus;
  credential: number | null;
  credential_name: string;
  error: string;
  organization: number | null;
  updated_at: string;
}

interface ApiConnectionListResponse {
  count: number;
  results: ApiCloudConnection[];
}

export interface ApiCloudProviderState {
  id: number;
  provider_id: string;
  organization: number | null;
  pulled_at: string | null;
  provider_data: unknown;
  admin_settings:
    | DigitalOceanAdminSettings
    | ProxmoxAdminSettings
    | VmwareAdminSettings
    | AzureAdminSettings
    | null;
  provider_settings: CloudProviderSettingsState | null;
}

export interface CloudInventorySuggestionResponse {
  provider: string;
  organization: number | null;
  connection_id: number | null;
  pulled_at: string | null;
  resource_counts: Record<string, number>;
  resource_count: number;
  ai_used: boolean;
  ai_status: string;
  ai_provider: string | null;
  ai_model: string | null;
  suggestion: GeneratedInventoryPlan;
}

function apiConnectionToEntry(conn: ApiCloudConnection): CloudConnectionEntry {
  return {
    id: String(conn.id),
    name: conn.name,
    providerId: conn.provider_id,
    status: conn.status,
    credentialId: conn.credential,
    credentialName: conn.credential_name,
    error: conn.error,
    organizationId: conn.organization ?? null,
    updatedAt: conn.updated_at,
  };
}

// ── Connection CRUD ───────────────────────────────────────────────────────────

/** Fetches all connections, optionally filtered to a single provider. */
export async function fetchCloudConnections(
  providerId?: string,
  organizationId?: number | null
): Promise<CloudConnectionEntry[]> {
  const params = new URLSearchParams();
  if (providerId) params.set('provider_id', providerId);
  if (organizationId !== undefined && organizationId !== null) {
    params.set('organization', String(organizationId));
  }
  const query = params.toString();
  const url = query
    ? `${awxAPI`/catalog_cloud/connections/`}?${query}`
    : awxAPI`/catalog_cloud/connections/`;
  const data = await requestGet<ApiConnectionListResponse>(url);
  return (data.results ?? []).map(apiConnectionToEntry);
}

/** Creates a new connection for the given provider and returns the saved entry. */
export async function createCloudConnection(
  providerId: string,
  entry: Pick<
    CloudConnectionEntry,
    'name' | 'status' | 'credentialId' | 'credentialName' | 'error'
  > & { organizationId?: number | null }
): Promise<CloudConnectionEntry> {
  const payload: Record<string, unknown> = {
    provider_id: providerId,
    name: entry.name,
    status: entry.status,
    credential: entry.credentialId,
    credential_name: entry.credentialName,
    error: entry.error,
  };
  if (entry.organizationId !== undefined) {
    payload.organization = entry.organizationId;
  }
  const conn = await postRequest<ApiCloudConnection, typeof payload>(
    awxAPI`/catalog_cloud/connections/`,
    payload
  );
  return apiConnectionToEntry(conn);
}

/**
 * Partially updates an existing connection.
 * `id` must be the numeric DB id represented as a string.
 */
export async function updateCloudConnectionApi(
  id: string,
  partial: Partial<
    Pick<CloudConnectionEntry, 'name' | 'status' | 'credentialId' | 'credentialName' | 'error'>
  >
): Promise<CloudConnectionEntry> {
  const payload: Record<string, unknown> = {};
  if (partial.name !== undefined) payload.name = partial.name;
  if (partial.status !== undefined) payload.status = partial.status;
  if (partial.credentialId !== undefined) payload.credential = partial.credentialId;
  if (partial.credentialName !== undefined) payload.credential_name = partial.credentialName;
  if (partial.error !== undefined) payload.error = partial.error;
  const conn = await requestPatch<ApiCloudConnection>(
    awxAPI`/catalog_cloud/connections/${id}/`,
    payload
  );
  return apiConnectionToEntry(conn);
}

/** Deletes a connection by its numeric DB id (passed as string). */
export async function removeCloudConnectionApi(id: string): Promise<void> {
  await requestDelete<void>(
    awxAPI`/catalog_cloud/connections/${id}/`,
    new AbortController().signal
  );
}

// ── Provider state ────────────────────────────────────────────────────────────

/**
 * Fetches the provider state record (pulled data, admin settings, provider
 * settings) for the given provider id.  Returns null on any error so callers
 * can treat it as "not yet saved".
 */
export function getProviderStateUrl(providerId: string, organizationId?: number | null): string {
  const url = awxAPI`/catalog_cloud/provider_state/${providerId}/`;
  if (organizationId !== undefined && organizationId !== null) {
    return `${url}?organization=${organizationId}`;
  }
  return url;
}

export async function fetchProviderState(
  providerId: string,
  organizationId?: number | null
): Promise<ApiCloudProviderState | null> {
  try {
    return await requestGet<ApiCloudProviderState>(getProviderStateUrl(providerId, organizationId));
  } catch {
    return null;
  }
}

/**
 * Partially updates provider state fields.  Only the keys included in
 * `partial` are sent to the server.
 */
export async function patchProviderState(
  providerId: string,
  partial: Partial<
    Pick<
      ApiCloudProviderState,
      'provider_data' | 'admin_settings' | 'provider_settings' | 'pulled_at'
    >
  >,
  organizationId?: number | null
): Promise<ApiCloudProviderState | null> {
  try {
    const payload = { ...partial } as typeof partial & { organization?: number };
    if (organizationId !== undefined && organizationId !== null) {
      payload.organization = organizationId;
    }
    return await requestPatch<ApiCloudProviderState>(
      getProviderStateUrl(providerId, organizationId),
      payload
    );
  } catch {
    return null;
  }
}

export function getProviderInventorySuggestionsUrl(
  providerId: string,
  organizationId?: number | null
): string {
  const url = awxAPI`/catalog_cloud/provider_state/${providerId}/inventory_suggestions/`;
  if (organizationId !== undefined && organizationId !== null) {
    return `${url}?organization=${organizationId}`;
  }
  return url;
}

export async function suggestCloudInventory(
  providerId: string,
  options: {
    organizationId?: number | null;
    connectionId?: string | number | null;
    sampleLimit?: number;
    useAi?: boolean;
  } = {}
): Promise<CloudInventorySuggestionResponse> {
  const payload: Record<string, unknown> = {
    sample_limit: options.sampleLimit ?? 200,
    use_ai: options.useAi ?? false,
  };
  if (options.organizationId !== undefined && options.organizationId !== null) {
    payload.organization = options.organizationId;
  }
  if (options.connectionId !== undefined && options.connectionId !== null) {
    payload.connection_id = options.connectionId;
  }
  return postRequest<CloudInventorySuggestionResponse, typeof payload>(
    getProviderInventorySuggestionsUrl(providerId, options.organizationId),
    payload
  );
}

// ── DigitalOcean admin allow-list settings ────────────────────────────────────

/**
 * Persisted admin controls for DigitalOcean.
 * `null` means "all items are allowed" (default state before any change).
 * An empty array means "none are allowed".
 * A non-empty array is the explicit allowed set.
 */
export interface DigitalOceanAdminSettings {
  allowedSizeSlugs: string[] | null;
  allowedVpcIds: string[] | null;
  allowedImageIds: number[] | null;
  allowedRegionSlugs: string[] | null;
}
