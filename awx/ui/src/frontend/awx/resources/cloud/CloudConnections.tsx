import { useCallback, useMemo, useState } from 'react';
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
  Spinner,
  TextInput,
} from '@patternfly/react-core';
import { postRequest, requestGet } from '../../../common/crud/Data';
import { isRequestError } from '../../../common/crud/RequestError';
import { useGet } from '../../../common/crud/useGet';
import { PageHeader, PageLayout, usePageAlertToaster } from '../../../../framework';
import { EmptyStateUnauthorized } from '../../../../framework/components/EmptyStateUnauthorized';
import { awxAPI } from '../../common/api/awx-utils';
import { AwxError } from '../../common/AwxError';
import { useAwxActiveUser } from '../../common/useAwxActiveUser';
import { CubesIcon } from '@patternfly/react-icons';
import { Credential } from '../../interfaces/Credential';
import {
  CloudConnectionEntry,
  CloudConnectionStatus,
  addCloudConnection,
  getCloudConnections,
  removeCloudConnection,
  updateCloudConnection,
} from './cloudConnectionStore';
import { cloudProviders } from './cloudProviders';
import DigitalOceanLogo from '../../../assets/digitalocean.svg';
import AWSLogo from '../../../assets/aws.svg';
import AzureLogo from '../../../assets/azure.svg';
import GCPLogo from '../../../assets/gcp.svg';
import ProxmoxLogo from '../../../assets/proxmox.svg';

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
};

const providerAliases: Record<string, string[]> = {
  digitalocean: ['digitalocean', 'digitaloceanterraform', 'do'],
  aws: ['aws', 'amazonwebservices', 'amazon'],
  azure: ['azure', 'azurerm', 'microsoftazure', 'azurermterraform'],
  gcp: ['gcp', 'googlecloud', 'googlecloudplatform'],
  proxmox: ['proxmox', 'proxmoxve', 'proxmoxvirtualenvironment', 'bpgproxmox'],
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
  const alertToaster = usePageAlertToaster();
  const { activeAwxUser } = useAwxActiveUser();
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [activeModalProviderId, setActiveModalProviderId] = useState<string | null>(null);
  const [connections, setConnections] = useState<Record<string, CloudConnectionEntry[]>>(() =>
    getCloudConnections()
  );

  const refreshConnections = useCallback(() => {
    setConnections(getCloudConnections());
  }, []);

  const { data, isLoading, error, refresh } = useGet<CredentialListResponse>(
    awxAPI`/credentials/?order_by=name&page_size=200`
  );
  const credentials = data?.results ?? [];
  const canManageCloud =
    Boolean(activeAwxUser?.is_superuser) || Boolean(activeAwxUser?.is_system_auditor);

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

  const getProviderCredentials = useCallback(
    (providerId: string) => {
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
    },
    [cloudCredentials]
  );

  if (!canManageCloud) {
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

  if (error) {
    return <AwxError error={error} handleRefresh={refresh} />;
  }

  const onConnect = async (providerId: string, entryId: string, credentialId: number) => {
    const credentialObject = credentials.find((c) => c.id === credentialId);
    if (!credentialObject?.summary_fields?.user_capabilities?.use) {
      updateCloudConnection(providerId, entryId, {
        status: 'misconfigured',
        error: t('Selected credential is not usable by the current user.'),
      });
      refreshConnections();
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
          { credential_id: number }
        >(awxAPI`/catalog_cloud/connectors/digitalocean/validate/`, {
          credential_id: credentialId,
        });
        if (!validation.validated) {
          throw new Error(validation.detail ?? t('DigitalOcean validation failed.'));
        }
      } else {
        await requestGet<Credential>(awxAPI`/credentials/${credentialId.toString()}/`);
      }
      updateCloudConnection(providerId, entryId, {
        status: 'connected',
        credentialId,
        credentialName: credentialObject.name,
        error: '',
      });
      refreshConnections();
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
      updateCloudConnection(providerId, entryId, {
        status: 'misconfigured',
        credentialId,
        credentialName: credentialObject.name,
        error: errorDetails,
      });
      refreshConnections();
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Failed to connect.'),
        children: errorDetails,
      });
    } finally {
      setConnectingId(null);
    }
  };

  const onDisconnect = (providerId: string, entryId: string) => {
    updateCloudConnection(providerId, entryId, {
      status: 'disconnected',
      error: '',
    });
    refreshConnections();
  };

  const onRemove = (providerId: string, entryId: string) => {
    removeCloudConnection(providerId, entryId);
    refreshConnections();
  };

  const onAddAndConnect = async (
    providerId: string,
    name: string,
    credentialId: number
  ) => {
    const credentialObject = credentials.find((c) => c.id === credentialId);
    const newEntry = addCloudConnection(providerId, {
      name,
      status: 'disconnected',
      credentialId,
      credentialName: credentialObject?.name ?? '',
      error: '',
    });
    refreshConnections();
    await onConnect(providerId, newEntry.id, credentialId);
  };

  return (
    <PageLayout>
      <PageHeader
        title={t('Cloud Connections')}
        description={t(
          'Configure provider connectivity. Each provider supports multiple named connections — useful for multiple accounts or nodes.'
        )}
      />
      <PageSection>
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <Spinner />
          </div>
        ) : (
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
        )}
      </PageSection>
      {activeModalProviderId && (
        <ConnectionModal
          providerId={activeModalProviderId}
          onClose={() => setActiveModalProviderId(null)}
          credentials={credentials}
          getProviderCredentials={getProviderCredentials}
          entries={connections[activeModalProviderId] ?? []}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
          onRemove={onRemove}
          onAddAndConnect={onAddAndConnect}
          connectingId={connectingId}
        />
      )}
    </PageLayout>
  );
}

function ConnectionModal(props: {
  providerId: string;
  onClose: () => void;
  credentials: Credential[];
  getProviderCredentials: (providerId: string) => Credential[];
  entries: CloudConnectionEntry[];
  onConnect: (providerId: string, entryId: string, credentialId: number) => Promise<void>;
  onDisconnect: (providerId: string, entryId: string) => void;
  onRemove: (providerId: string, entryId: string) => void;
  onAddAndConnect: (providerId: string, name: string, credentialId: number) => Promise<void>;
  connectingId: string | null;
}) {
  const { t } = useTranslation();
  const {
    providerId,
    onClose,
    getProviderCredentials,
    entries,
    onConnect,
    onDisconnect,
    onRemove,
    onAddAndConnect,
    connectingId,
  } = props;

  const provider = cloudProviders.find((p) => p.id === providerId);
  const providerLabel = provider?.label ?? providerId;
  const providerCredentials = getProviderCredentials(providerId);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCredentialId, setNewCredentialId] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const handleAdd = async () => {
    if (!newName.trim() || !newCredentialId) return;
    setIsAdding(true);
    try {
      await onAddAndConnect(providerId, newName.trim(), Number(newCredentialId));
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

        {/* Existing connections list */}
        {entries.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #ddd' }}>
                <th style={{ padding: '6px 8px' }}>{t('Name')}</th>
                <th style={{ padding: '6px 8px' }}>{t('Status')}</th>
                <th style={{ padding: '6px 8px' }}>{t('Credential')}</th>
                <th style={{ padding: '6px 8px' }} />
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const isThisConnecting = connectingId === entry.id;
                return (
                  <>
                    <tr key={entry.id} style={{ borderBottom: entry.error ? 'none' : '1px solid #eee' }}>
                      <td style={{ padding: '6px 8px', fontWeight: 500 }}>{entry.name}</td>
                      <td style={{ padding: '6px 8px' }}>
                        <StatusBadge status={entry.status} />
                      </td>
                      <td style={{ padding: '6px 8px', color: '#888' }}>
                        {entry.credentialName || '-'}
                      </td>
                      <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                        <Button
                          variant="secondary"
                          isSmall
                          isLoading={isThisConnecting}
                          isDisabled={!!connectingId || entry.status === 'connected'}
                          onClick={() => {
                            if (entry.credentialId) {
                              void onConnect(providerId, entry.id, entry.credentialId);
                            }
                          }}
                          style={{ marginRight: '0.4rem' }}
                        >
                          {t('Reconnect')}
                        </Button>
                        <Button
                          variant="secondary"
                          isSmall
                          isDisabled={!!connectingId || entry.status !== 'connected'}
                          onClick={() => onDisconnect(providerId, entry.id)}
                          style={{ marginRight: '0.4rem' }}
                        >
                          {t('Disconnect')}
                        </Button>
                        <Button
                          variant="plain"
                          isSmall
                          isDisabled={!!connectingId}
                          onClick={() => onRemove(providerId, entry.id)}
                          aria-label={t('Remove connection')}
                        >
                          ✕
                        </Button>
                      </td>
                    </tr>
                    {entry.error && (
                      <tr key={`${entry.id}-err`} style={{ borderBottom: '1px solid #eee' }}>
                        <td colSpan={4} style={{ padding: '0 8px 6px 8px' }}>
                          <span style={{ color: 'var(--pf-v5-global--danger-color--100)', fontSize: '0.8rem' }}>
                            {entry.error}
                          </span>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        )}

        {entries.length === 0 && !showAddForm && (
          <div style={{ color: '#888', textAlign: 'center', padding: '0.5rem 0' }}>
            {t('No connections yet. Click "Add connection" below.')}
          </div>
        )}

        {/* Add connection form */}
        {showAddForm ? (
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
            <div style={{ display: 'flex', gap: 8 }}>
              <Button
                variant="primary"
                isSmall
                isLoading={isAdding}
                isDisabled={!newName.trim() || !newCredentialId || isAdding}
                onClick={() => void handleAdd()}
              >
                {t('Connect')}
              </Button>
              <Button
                variant="link"
                isSmall
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
        ) : (
          <div>
            <Button
              variant="secondary"
              isSmall
              isDisabled={!!connectingId}
              onClick={() => setShowAddForm(true)}
            >
              {t('+ Add connection')}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

