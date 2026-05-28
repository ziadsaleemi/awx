import { cloudProviders } from './cloudProviders';

const cloudConnectionsStorageKey = 'awx-cloud-connections-v2';
const cloudProviderSettingsStorageKey = 'awx-cloud-provider-settings';
const cloudProviderDataStorageKey = 'awx-cloud-provider-data';
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
  connectionId: string;
  nodes: ProxmoxNode[];
  vms: ProxmoxVM[];
  containers: ProxmoxContainer[];
  storage: ProxmoxStorage[];
  networks: ProxmoxNetwork[];
}

function isBrowser() {
  return typeof window !== 'undefined';
}

function readStore(): Record<string, CloudConnectionEntry[]> {
  if (!isBrowser()) return {};
  const raw = window.localStorage.getItem(cloudConnectionsStorageKey);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, CloudConnectionEntry[]>;
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, CloudConnectionEntry[]>) {
  if (!isBrowser()) return;
  window.localStorage.setItem(cloudConnectionsStorageKey, JSON.stringify(store));
  window.dispatchEvent(new Event(cloudConnectionsChangedEvent));
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Returns all connections grouped by providerId. Each provider maps to an array (may be empty). */
export function getCloudConnections(): Record<string, CloudConnectionEntry[]> {
  const stored = readStore();
  const result: Record<string, CloudConnectionEntry[]> = {};
  for (const provider of cloudProviders) {
    result[provider.id] = stored[provider.id] ?? [];
  }
  return result;
}

/** Adds a new connection entry for a provider and returns it. */
export function addCloudConnection(
  providerId: string,
  entry: Omit<CloudConnectionEntry, 'id' | 'providerId' | 'updatedAt'>
): CloudConnectionEntry {
  const id = generateId();
  const newEntry: CloudConnectionEntry = {
    ...entry,
    id,
    providerId,
    updatedAt: new Date().toISOString(),
  };
  const store = readStore();
  store[providerId] = [...(store[providerId] ?? []), newEntry];
  writeStore(store);
  return newEntry;
}

/** Updates an existing connection entry by id. */
export function updateCloudConnection(
  providerId: string,
  id: string,
  partial: Partial<Omit<CloudConnectionEntry, 'id' | 'providerId'>>
) {
  const store = readStore();
  const entries = store[providerId] ?? [];
  store[providerId] = entries.map((e) =>
    e.id === id ? { ...e, ...partial, id, providerId, updatedAt: new Date().toISOString() } : e
  );
  writeStore(store);
}

/** Removes a connection entry by id. */
export function removeCloudConnection(providerId: string, id: string) {
  const store = readStore();
  store[providerId] = (store[providerId] ?? []).filter((e) => e.id !== id);
  writeStore(store);
}

export function getConnectedCloudProviders() {
  const connections = getCloudConnections();
  return cloudProviders
    .map((p) => p.id)
    .filter((id) => connections[id]?.some((e) => e.status === 'connected'));
}

function makeDefaultProviderSettingsState(): CloudProviderSettingsState {
  return {
    allowTemplatePull: true,
    allowedTemplatePatterns: '',
    allowedNetworks: '',
    lastTemplatePullAt: '',
  };
}

export function getCloudProviderSettings(provider: string) {
  const defaults = makeDefaultProviderSettingsState();
  if (!isBrowser()) {
    return defaults;
  }

  const raw = window.localStorage.getItem(cloudProviderSettingsStorageKey);
  if (!raw) {
    return defaults;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<CloudProviderSettingsState>>;
    return {
      ...defaults,
      ...(parsed[provider] ?? {}),
    };
  } catch {
    return defaults;
  }
}

export function setCloudProviderSettings(provider: string, settings: CloudProviderSettingsState) {
  if (!isBrowser()) {
    return;
  }

  const raw = window.localStorage.getItem(cloudProviderSettingsStorageKey);
  const parsed = raw ? (JSON.parse(raw) as Record<string, CloudProviderSettingsState>) ?? {} : {};
  parsed[provider] = settings;
  window.localStorage.setItem(cloudProviderSettingsStorageKey, JSON.stringify(parsed));
}

export function getCloudProviderData(provider: string): unknown {
  if (!isBrowser()) {
    return null;
  }
  const raw = window.localStorage.getItem(cloudProviderDataStorageKey);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed[provider] ?? null;
  } catch {
    return null;
  }
}

export function setCloudProviderData(provider: string, data: DigitalOceanProviderData) {
  if (!isBrowser()) {
    return;
  }
  const raw = window.localStorage.getItem(cloudProviderDataStorageKey);
  const parsed = raw ? (JSON.parse(raw) as Record<string, DigitalOceanProviderData>) ?? {} : {};
  parsed[provider] = data;
  window.localStorage.setItem(cloudProviderDataStorageKey, JSON.stringify(parsed));
}
