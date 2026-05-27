import { cloudProviders } from './cloudProviders';

const cloudConnectionsStorageKey = 'awx-cloud-connections';
const cloudProviderSettingsStorageKey = 'awx-cloud-provider-settings';
const cloudProviderDataStorageKey = 'awx-cloud-provider-data';
export const cloudConnectionsChangedEvent = 'awx-cloud-connections-changed';

export type CloudConnectionStatus = 'connected' | 'disconnected' | 'misconfigured';

export interface CloudConnectionState {
  provider: string;
  status: CloudConnectionStatus;
  credentialId: number | null;
  credentialName: string;
  error: string;
  updatedAt: string;
}

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

function makeDefaultConnectionState(provider: string): CloudConnectionState {
  return {
    provider,
    status: 'disconnected',
    credentialId: null,
    credentialName: '',
    error: '',
    updatedAt: '',
  };
}

function makeDefaultProviderSettingsState(): CloudProviderSettingsState {
  return {
    allowTemplatePull: true,
    allowedTemplatePatterns: '',
    allowedNetworks: '',
    lastTemplatePullAt: '',
  };
}

function isBrowser() {
  return typeof window !== 'undefined';
}

export function getCloudConnections() {
  const defaults = Object.fromEntries(
    cloudProviders.map((provider) => [provider.id, makeDefaultConnectionState(provider.id)])
  ) as Record<string, CloudConnectionState>;

  if (!isBrowser()) {
    return defaults;
  }

  const raw = window.localStorage.getItem(cloudConnectionsStorageKey);
  if (!raw) {
    return defaults;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<CloudConnectionState>>;
    const merged = { ...defaults };
    for (const provider of cloudProviders) {
      const state = parsed[provider.id];
      if (!state || typeof state !== 'object') {
        continue;
      }
      merged[provider.id] = {
        ...defaults[provider.id],
        ...state,
        provider: provider.id,
      };
    }
    return merged;
  } catch {
    return defaults;
  }
}

export function setCloudConnection(provider: string, state: Partial<CloudConnectionState>) {
  if (!isBrowser()) {
    return;
  }

  const current = getCloudConnections();
  const next: CloudConnectionState = {
    ...makeDefaultConnectionState(provider),
    ...current[provider],
    ...state,
    provider,
    updatedAt: new Date().toISOString(),
  };
  const all = {
    ...current,
    [provider]: next,
  };

  window.localStorage.setItem(cloudConnectionsStorageKey, JSON.stringify(all));
  window.dispatchEvent(new Event(cloudConnectionsChangedEvent));
}

export function getConnectedCloudProviders() {
  const connections = getCloudConnections();
  return cloudProviders
    .map((provider) => provider.id)
    .filter((provider) => connections[provider]?.status === 'connected');
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
  const parsed = raw
    ? ((JSON.parse(raw) as Record<string, CloudProviderSettingsState>) ?? {})
    : {};
  parsed[provider] = settings;
  window.localStorage.setItem(cloudProviderSettingsStorageKey, JSON.stringify(parsed));
}

export function getCloudProviderData(provider: string): DigitalOceanProviderData | null {
  if (!isBrowser()) {
    return null;
  }
  const raw = window.localStorage.getItem(cloudProviderDataStorageKey);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, DigitalOceanProviderData>;
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
  const parsed = raw ? ((JSON.parse(raw) as Record<string, DigitalOceanProviderData>) ?? {}) : {};
  parsed[provider] = data;
  window.localStorage.setItem(cloudProviderDataStorageKey, JSON.stringify(parsed));
}
