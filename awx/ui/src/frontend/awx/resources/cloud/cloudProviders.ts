export interface CloudProvider {
  id: string;
  label: string;
}

export const cloudProviders: CloudProvider[] = [
  { id: 'digitalocean', label: 'DigitalOcean' },
  { id: 'aws', label: 'AWS' },
  { id: 'azure', label: 'Azure' },
  { id: 'gcp', label: 'GCP' },
  { id: 'proxmox', label: 'Proxmox VE' },
];

export function getCloudProviderLabel(providerId: string) {
  const provider = cloudProviders.find((item) => item.id === providerId);
  return provider?.label ?? providerId;
}
