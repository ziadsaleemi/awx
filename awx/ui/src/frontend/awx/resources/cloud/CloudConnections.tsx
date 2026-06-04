import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  FormGroup,
  FormSelect,
  FormSelectOption,
  Gallery,
  GalleryItem,
  Label,
  Modal,
  PageSection,
  TextInput,
} from '@patternfly/react-core';
import { postRequest, requestGet } from '../../../common/crud/Data';
import { isRequestError } from '../../../common/crud/RequestError';
import { useGet } from '../../../common/crud/useGet';
import { PageHeader, PageLayout, usePageAlertToaster } from '../../../../framework';
import { EmptyStateUnauthorized } from '../../../../framework/components/EmptyStateUnauthorized';
import { awxAPI } from '../../common/api/awx-utils';
import { CubesIcon, PlusCircleIcon, TrashIcon } from '@patternfly/react-icons';
import { Credential } from '../../interfaces/Credential';
import {
  CloudConnectionEntry,
  CloudConnectionStatus,
  cloudConnectionsChangedEvent,
  createCloudConnection,
  fetchCloudConnections,
  removeCloudConnectionApi,
  updateCloudConnectionApi,
} from './cloudConnectionStore';
import { cloudProviders } from './cloudProviders';
import { useCloudOrganization } from './useCloudOrganization';
import DigitalOceanLogo from '../../../assets/digitalocean.svg';
import AWSLogo from '../../../assets/aws.svg';
import AzureLogo from '../../../assets/azure.svg';
import GCPLogo from '../../../assets/gcp.svg';
import ProxmoxLogo from '../../../assets/proxmox.svg';
import VmwareLogo from '../../../assets/vmware.svg';

interface CredentialListResponse {
  count: number;
  results: Credential[];
}

interface ConnectorValidationResponse {
  validated: boolean;
  status?: string;
  detail?: string;
  account_email?: string;
}

function normalizeProviderToken(value: string | undefined) {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const providerLogos: Record<string, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  digitalocean: DigitalOceanLogo,
  aws: AWSLogo,
  azure: AzureLogo,
  gcp: GCPLogo,
  proxmox: ProxmoxLogo,
  vmware: VmwareLogo,
};

const providerAliases: Record<string, string[]> = {
  digitalocean: ['digitalocean', 'digitaloceanterraform', 'do'],
  aws: ['aws', 'amazonwebservices', 'amazon'],
  azure: ['azure', 'azurerm', 'microsoftazure', 'azurermterraform'],
  gcp: ['gcp', 'googlecloud', 'googlecloudplatform'],
  proxmox: ['proxmox', 'proxmoxve', 'proxmoxvirtualenvironment', 'bpgproxmox'],
  vmware: ['vmware', 'vsphere', 'vmwarevsphere'],
};

const providerCredentialNamespaces: Record<string, string> = {
  digitalocean: 'digitalocean_terraform',
  aws: 'aws_terraform',
  azure: 'azure_rm_terraform',
  gcp: 'gcp_terraform',
  proxmox: 'proxmox_ve',
  vmware: 'vmware_vsphere_terraform',
};

const StyledConnectionCard = styled(Card)`
  background-color: #222428 !important;
  border: 1px solid var(--pf-v5-global--BorderColor--100) !important;
  box-shadow: var(--pf-v5-global--BoxShadow--sm) !important;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important;
  cursor: pointer;
  height: 100%;
  display: flex;
  flex-direction: column;

  &:hover {
    transform: translateY(-4px);
    border-color: var(--pf-v5-global--primary-color--100) !important;
    box-shadow: var(--pf-v5-global--BoxShadow--lg) !important;
  }
`;

function StatusBadge(props: { status: CloudConnectionStatus }) {
  const { t } = useTranslation();
  if (props.status === 'connected') {
    return <Label color="green">{t('Connected')}</Label>;
  }
  if (props.status === 'misconfigured') {
    return <Label color="orange">{t('Misconfigured')}</Label>;
  }
  return <Label color="grey">{t('Disconnected')}</Label>;
}

function overallStatus(entries: CloudConnectionEntry[]): CloudConnectionStatus {
  if (entries.some((e) => e.status === 'connected')) return 'connected';
  if (entries.some((e) => e.status === 'misconfigured')) return 'misconfigured';
  return 'disconnected';
}

export function CloudConnections() {
  const { t } = useTranslation();
  const { canReadCloud, canManageCloud, organizationId } = useCloudOrganization();
  const [activeModalProviderId, setActiveModalProviderId] = useState<string | null>(null);
  const [connections, setConnections] = useState<Record<string, CloudConnectionEntry[]>>({});

  const refreshConnections = useCallback(() => {
    void fetchCloudConnections(undefined, organizationId).then((entries) => {
      const grouped: Record<string, CloudConnectionEntry[]> = {};
      for (const e of entries) {
        if (!grouped[e.providerId]) grouped[e.providerId] = [];
        grouped[e.providerId].push(e);
      }
      setConnections(grouped);
    });
  }, [organizationId]);

  useEffect(() => {
    refreshConnections();
  }, [refreshConnections]);

  if (!canReadCloud) {
    return (
      <PageLayout>
        <PageHeader
          title={t('Cloud Connections')}
          description={t('Cloud provider connection management for administrators.')}
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
        title={t('Cloud Connections')}
        description={t(
          'Configure provider connectivity. Each provider supports multiple named connections — useful for multiple accounts or nodes.'
        )}
      />
      <PageSection>
        <Gallery hasGutter minWidths={{ default: '280px' }}>
          {cloudProviders.map((provider) => {
            const entries = connections[provider.id] ?? [];
            const status = overallStatus(entries);
            const ProviderLogo = providerLogos[provider.id] ?? CubesIcon;
            const connectedCount = entries.filter((e) => e.status === 'connected').length;
            return (
              <GalleryItem key={provider.id}>
                <StyledConnectionCard onClick={() => setActiveModalProviderId(provider.id)}>
                  <CardHeader>
                    <div
                      style={{
                        width: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        textAlign: 'center',
                        gap: '0.75rem',
                        paddingTop: '0.25rem',
                      }}
                    >
                      <ProviderLogo style={{ width: 72, height: 72 }} />
                      <CardTitle>{provider.label}</CardTitle>
                    </div>
                  </CardHeader>
                  <CardBody
                    style={{
                      flexGrow: 1,
                      textAlign: 'center',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem',
                    }}
                  >
                    <StatusBadge status={status} />
                    <div style={{ fontSize: '0.82rem', color: 'var(--pf-global--Color--200)' }}>
                      {entries.length === 0
                        ? t('No connections — click to add.')
                        : t('{{connected}} of {{total}} connected', {
                            connected: connectedCount,
                            total: entries.length,
                          })}
                    </div>
                  </CardBody>
                </StyledConnectionCard>
              </GalleryItem>
            );
          })}
        </Gallery>
      </PageSection>
      {activeModalProviderId && (
        <ConnectionModal
          providerId={activeModalProviderId}
          userOrgId={organizationId}
          canManageCloud={canManageCloud}
          onClose={() => {
            setActiveModalProviderId(null);
            refreshConnections();
          }}
        />
      )}
    </PageLayout>
  );
}

export function ConnectionModal(props: {
  providerId: string;
  onClose: () => void;
  userOrgId?: number | null;
  canManageCloud?: boolean;
}) {
  const { t } = useTranslation();
  const alertToaster = usePageAlertToaster();
  const { providerId, onClose, userOrgId, canManageCloud = true } = props;

  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [entries, setEntries] = useState<CloudConnectionEntry[]>([]);

  const refreshModalConnections = useCallback(() => {
    void fetchCloudConnections(providerId, userOrgId).then(setEntries);
  }, [providerId, userOrgId]);

  useEffect(() => {
    refreshModalConnections();
  }, [refreshModalConnections]);

  const credentialListUrl = useMemo(() => {
    const params = new URLSearchParams({ order_by: 'name', page_size: '200' });
    const namespace = providerCredentialNamespaces[providerId];
    if (namespace) params.set('credential_type__namespace', namespace);
    return `${awxAPI`/credentials/`}?${params.toString()}`;
  }, [providerId]);

  const { data } = useGet<CredentialListResponse>(credentialListUrl);
  const credentials = useMemo(() => data?.results ?? [], [data?.results]);

  const cloudCredentials = useMemo(() => {
    const filtered = credentials.filter((credential) => {
      const typeKind = normalizeProviderToken(credential.credential_type__kind);
      const kind = normalizeProviderToken(credential.kind);
      const typeName = normalizeProviderToken(credential.summary_fields?.credential_type?.name);
      return (
        typeKind === 'cloud' ||
        kind === 'cloud' ||
        Boolean(credential.cloud) ||
        typeName.includes('cloud')
      );
    });
    return filtered.length ? filtered : credentials;
  }, [credentials]);

  const providerCredentials = useMemo(() => {
    const aliases = providerAliases[providerId] ?? [providerId];
    return cloudCredentials.filter((credential) => {
      const searchFields = [
        credential.credential_type__namespace,
        credential.credential_type__kind,
        credential.kind,
        credential.summary_fields?.credential_type?.name,
        credential.name,
      ];
      const haystack = searchFields.map((v) => normalizeProviderToken(v)).join(' ');
      return aliases.some((alias) => haystack.includes(normalizeProviderToken(alias)));
    });
  }, [cloudCredentials, providerId]);

  const provider = cloudProviders.find((p) => p.id === providerId);
  const providerLabel = provider?.label ?? providerId;

  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCredentialId, setNewCredentialId] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const onConnect = async (entryId: string, credentialId: number) => {
    const credentialObject = credentials.find((c) => c.id === credentialId);
    if (!credentialObject?.summary_fields?.user_capabilities?.use) {
      await updateCloudConnectionApi(entryId, {
        status: 'misconfigured',
        error: t('Selected credential is not usable by the current user.'),
      });
      refreshModalConnections();
      window.dispatchEvent(new Event(cloudConnectionsChangedEvent));
      alertToaster.addAlert({
        variant: 'danger',
        title: t('You do not have permission to use this credential.'),
      });
      return;
    }

    setConnectingId(entryId);
    try {
      if (providerId === 'digitalocean') {
        const validation = await postRequest<
          ConnectorValidationResponse,
          { credential_id: number; connection_id: string; organization?: number | null }
        >(awxAPI`/catalog_cloud/connectors/digitalocean/validate/`, {
          credential_id: credentialId,
          connection_id: entryId,
          organization: userOrgId ?? null,
        });
        if (!validation.validated) {
          throw new Error(validation.detail ?? t('DigitalOcean validation failed.'));
        }
      } else {
        await requestGet<Credential>(awxAPI`/credentials/${credentialId.toString()}/`);
      }
      await updateCloudConnectionApi(entryId, {
        status: 'connected',
        credentialId,
        credentialName: credentialObject.name,
        error: '',
      });
      refreshModalConnections();
      window.dispatchEvent(new Event(cloudConnectionsChangedEvent));
      alertToaster.addAlert({
        variant: 'success',
        title: t('Connected.'),
      });
    } catch (err) {
      const errorDetails =
        isRequestError(err) && err.details
          ? err.details
          : err instanceof Error
            ? err.message
            : String(err);
      await updateCloudConnectionApi(entryId, {
        status: 'misconfigured',
        credentialId,
        credentialName: credentialObject.name,
        error: errorDetails,
      });
      refreshModalConnections();
      window.dispatchEvent(new Event(cloudConnectionsChangedEvent));
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Failed to connect.'),
        children: errorDetails,
      });
    } finally {
      setConnectingId(null);
    }
  };

  const onDisconnect = async (entryId: string) => {
    await updateCloudConnectionApi(entryId, { status: 'disconnected', error: '' });
    refreshModalConnections();
    window.dispatchEvent(new Event(cloudConnectionsChangedEvent));
  };

  const onRemove = async (entryId: string) => {
    await removeCloudConnectionApi(entryId);
    refreshModalConnections();
    window.dispatchEvent(new Event(cloudConnectionsChangedEvent));
  };

  const onAddAndConnect = async (name: string, credentialId: number) => {
    const cred = credentials.find((c) => c.id === credentialId);
    const newEntry = await createCloudConnection(providerId, {
      name,
      status: 'disconnected',
      credentialId,
      credentialName: cred?.name ?? '',
      error: '',
      organizationId: userOrgId ?? null,
    });
    refreshModalConnections();
    await onConnect(newEntry.id, credentialId);
  };

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
      title={t('{{provider}} Connections', { provider: providerLabel })}
      isOpen
      onClose={onClose}
      variant="medium"
      actions={[
        <Button key="close" variant="primary" onClick={onClose}>
          {t('Close')}
        </Button>,
      ]}
    >
      <div style={{ display: 'grid', gap: 16 }}>
        {providerId === 'digitalocean' && (
          <Alert isInline variant="info" title={t('DigitalOcean token requirement')}>
            {t(
              'Use a DigitalOcean Personal Access Token (API token) in do_token. Spaces keys or other secrets will not authenticate the connector.'
            )}
          </Alert>
        )}
        {providerId === 'proxmox' && (
          <Alert isInline variant="info" title={t('Proxmox VE credential')}>
            {t(
              'Select a Proxmox VE credential. Each connection maps to one Proxmox node or cluster and injects TF_VAR_pm_* variables into Terraform jobs.'
            )}
          </Alert>
        )}
        {providerId === 'vmware' && (
          <Alert isInline variant="info" title={t('VMware vSphere credential')}>
            {t('Select a VMware vSphere credential. Each connection maps to one vCenter instance.')}
          </Alert>
        )}

        {/* Existing connections list */}
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
                  <td style={{ padding: '8px', fontWeight: 500 }}>{entry.name}</td>
                  <td style={{ padding: '8px' }}>
                    <StatusBadge status={entry.status} />
                  </td>
                  <td style={{ padding: '8px', color: '#888' }}>{entry.credentialName || '-'}</td>
                  <td style={{ padding: '8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {entry.status === 'connected' ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        isDisabled={!canManageCloud}
                        onClick={() => void onDisconnect(entry.id)}
                        style={{ marginRight: '0.4rem' }}
                      >
                        {t('Disconnect')}
                      </Button>
                    ) : (
                      entry.credentialId !== null &&
                      entry.credentialId !== undefined && (
                        <Button
                          variant="primary"
                          size="sm"
                          isLoading={connectingId === entry.id}
                          isDisabled={!canManageCloud || connectingId !== null}
                          onClick={() => void onConnect(entry.id, entry.credentialId!)}
                          style={{ marginRight: '0.4rem' }}
                        >
                          {t('Connect')}
                        </Button>
                      )
                    )}
                    <Button
                      variant="plain"
                      size="sm"
                      isDisabled={!canManageCloud || !!connectingId}
                      onClick={() => void onRemove(entry.id)}
                      aria-label={t('Remove connection')}
                    >
                      <TrashIcon />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {entries.length === 0 && !showAddForm && (
          <div
            style={{
              color: '#888',
              textAlign: 'center',
              padding: '0.75rem 0',
              display: 'grid',
              justifyItems: 'center',
              gap: 12,
            }}
          >
            <div>{t('No connections yet.')}</div>
            {canManageCloud && (
              <Button
                variant="primary"
                icon={<PlusCircleIcon />}
                onClick={() => setShowAddForm(true)}
              >
                {t('Add connection')}
              </Button>
            )}
          </div>
        )}

        {/* Add connection form */}
        {canManageCloud && showAddForm ? (
          <div
            style={{
              border: '1px solid var(--pf-v5-global--BorderColor--100)',
              borderRadius: 6,
              padding: '1rem',
              display: 'grid',
              gap: 12,
            }}
          >
            <FormGroup label={t('Connection name')} fieldId={`${providerId}-new-name`} isRequired>
              <TextInput
                id={`${providerId}-new-name`}
                value={newName}
                onChange={(_, value) => setNewName(value)}
                placeholder={t('e.g. Production node')}
                isDisabled={isAdding}
              />
            </FormGroup>
            <FormGroup label={t('Credential')} fieldId={`${providerId}-new-credential`} isRequired>
              <FormSelect
                id={`${providerId}-new-credential`}
                value={newCredentialId}
                onChange={(_, value) => setNewCredentialId(String(value))}
                isDisabled={isAdding}
              >
                <FormSelectOption value="" label={t('Select a credential')} isPlaceholder />
                {providerCredentials.map((credential) => (
                  <FormSelectOption
                    key={credential.id}
                    value={credential.id.toString()}
                    label={credential.name}
                  />
                ))}
              </FormSelect>
            </FormGroup>
            {providerCredentials.length === 0 && (
              <Alert
                isInline
                variant="warning"
                title={t('No {{provider}} credentials found.', { provider: providerLabel })}
              >
                {t('Create a {{provider}} credential, then return here to add a connection.', {
                  provider: providerLabel,
                })}
              </Alert>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <Button
                variant="primary"
                size="sm"
                isLoading={isAdding}
                isDisabled={!newName.trim() || !newCredentialId || isAdding}
                onClick={() => void handleAdd()}
              >
                {t('Add & connect')}
              </Button>
              <Button
                variant="link"
                size="sm"
                isDisabled={isAdding}
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
        ) : canManageCloud && entries.length > 0 ? (
          <div>
            <Button variant="link" icon={<PlusCircleIcon />} onClick={() => setShowAddForm(true)}>
              {t('Add connection')}
            </Button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
