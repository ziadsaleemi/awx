import { useMemo, useState } from 'react';
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
  CloudConnectionStatus,
  getCloudConnections,
  setCloudConnection,
} from './cloudConnectionStore';
import { cloudProviders } from './cloudProviders';

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

const DigitalOceanLogo = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    width="72"
    height="72"
    viewBox="0 0 100 100"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M50 0C22.3858 0 0 22.3858 0 50C0 77.6142 22.3858 100 50 100C77.6142 100 100 77.6142 100 50H78C78 65.464 65.464 78 50 78C34.536 78 22 65.464 22 50C22 34.536 34.536 22 50 22V0Z"
      fill="#0080FF"
    />
    <rect x="58" y="22" width="16" height="16" fill="#0080FF" />
    <rect x="78" y="42" width="16" height="16" fill="#0080FF" />
  </svg>
);

const AwsLogo = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    width="72"
    height="72"
    viewBox="0 0 100 100"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M50 10C27.9086 10 10 27.9086 10 50C10 72.0914 27.9086 90 50 90C72.0914 90 90 72.0914 90 50C90 27.9086 72.0914 10 50 10ZM50 78C34.536 78 22 65.464 22 50C22 34.536 34.536 22 50 22C65.464 22 78 34.536 78 50C78 65.464 65.464 78 50 78Z"
      fill="#FF9900"
    />
    <path d="M38 46H62V54H38V46Z" fill="#FF9900" />
    <path d="M46 64C56 68 64 60 64 60" stroke="#FF9900" strokeWidth="4" strokeLinecap="round" />
  </svg>
);

const AzureLogo = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    width="72"
    height="72"
    viewBox="0 0 100 100"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path d="M50 10L10 78H36L50 48L64 78H90L50 10Z" fill="#007FFF" />
  </svg>
);

const GcpLogo = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    width="72"
    height="72"
    viewBox="0 0 100 100"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M50 10C27.9086 10 10 27.9086 10 50C10 72.0914 27.9086 90 50 90C72.0914 90 90 72.0914 90 50C90 27.9086 72.0914 10 50 10Z"
      fill="#4285F4"
    />
    <path d="M50 30H78V50H50V30Z" fill="#34A853" />
    <path d="M50 50H78V70H50V50Z" fill="#FBBC05" />
    <path d="M22 50H50V70H22V50Z" fill="#EA4335" />
  </svg>
);

const providerLogos: Record<string, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  digitalocean: DigitalOceanLogo,
  aws: AwsLogo,
  azure: AzureLogo,
  gcp: GcpLogo,
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

export function CloudConnections() {
  const { t } = useTranslation();
  const alertToaster = usePageAlertToaster();
  const { activeAwxUser } = useAwxActiveUser();
  const [connectingProvider, setConnectingProvider] = useState('');
  const [activeModalProviderId, setActiveModalProviderId] = useState<string | null>(null);
  const [credentialsByProvider, setCredentialsByProvider] = useState<Record<string, string>>(() => {
    const stored = getCloudConnections();
    return Object.fromEntries(
      cloudProviders.map((provider) => [
        provider.id,
        String(stored[provider.id]?.credentialId ?? ''),
      ])
    );
  });

  const { data, isLoading, error, refresh } = useGet<CredentialListResponse>(
    awxAPI`/credentials/?order_by=name&page_size=200`
  );
  const credentials = data?.results ?? [];
  const connectionState = getCloudConnections();
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

    // Some API responses may omit cloud discriminator fields for certain custom credential types.
    return filtered.length ? filtered : credentials;
  }, [credentials]);

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

  const getProviderCredentials = (providerId: string) => {
    const providerAliases: Record<string, string[]> = {
      digitalocean: ['digitalocean', 'digitaloceanterraform', 'do'],
      aws: ['aws', 'amazonwebservices', 'amazon'],
      azure: ['azure', 'azurerm', 'microsoftazure'],
      gcp: ['gcp', 'googlecloud', 'googlecloudplatform'],
    };
    const aliases = providerAliases[providerId] ?? [providerId];
    const filtered = cloudCredentials.filter((credential) => {
      const searchFields = [
        credential.credential_type__namespace,
        credential.credential_type__kind,
        credential.kind,
        credential.summary_fields?.credential_type?.name,
        credential.name,
      ];
      const haystack = searchFields.map((value) => normalizeProviderToken(value)).join(' ');
      return aliases.some((alias) => haystack.includes(normalizeProviderToken(alias)));
    });
    return filtered;
  };

  const onConnect = async (providerId: string) => {
    const selectedCredential = credentialsByProvider[providerId];
    if (!selectedCredential) {
      setCloudConnection(providerId, {
        status: 'misconfigured',
        credentialId: null,
        credentialName: '',
        error: t('No credential selected.'),
      });
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Select a credential before connecting.'),
      });
      return;
    }

    const credentialId = Number(selectedCredential);
    const selectedCredentialObject = credentials.find(
      (credential) => credential.id === credentialId
    );
    if (!selectedCredentialObject?.summary_fields?.user_capabilities?.use) {
      setCloudConnection(providerId, {
        status: 'misconfigured',
        credentialId,
        credentialName: selectedCredentialObject?.name ?? '',
        error: t('Selected credential is not usable by the current user.'),
      });
      alertToaster.addAlert({
        variant: 'danger',
        title: t('You do not have permission to use this credential.'),
      });
      return;
    }

    const credentialName = selectedCredentialObject.name;

    setConnectingProvider(providerId);
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
      setCloudConnection(providerId, {
        status: 'connected',
        credentialId,
        credentialName,
        error: '',
      });
      alertToaster.addAlert({
        variant: 'success',
        title: t('{{provider}} connected.', {
          provider:
            cloudProviders.find((provider) => provider.id === providerId)?.label ?? providerId,
        }),
      });
    } catch (error) {
      const errorDetails =
        isRequestError(error) && error.details
          ? error.details
          : error instanceof Error
            ? error.message
            : String(error);
      setCloudConnection(providerId, {
        status: 'misconfigured',
        credentialId,
        credentialName,
        error: errorDetails,
      });
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Failed to connect {{provider}}.', {
          provider:
            cloudProviders.find((provider) => provider.id === providerId)?.label ?? providerId,
        }),
        children: errorDetails,
      });
    } finally {
      setConnectingProvider('');
    }
  };

  const onDisconnect = (providerId: string) => {
    setCloudConnection(providerId, {
      status: 'disconnected',
      credentialId: null,
      credentialName: '',
      error: '',
    });
    alertToaster.addAlert({
      variant: 'info',
      title: t('{{provider}} disconnected.', {
        provider:
          cloudProviders.find((provider) => provider.id === providerId)?.label ?? providerId,
      }),
    });
  };

  return (
    <PageLayout>
      <PageHeader
        title={t('Cloud Connections')}
        description={t(
          'Configure provider connectivity by selecting a cloud credential per provider. Successful checks show a green connected status.'
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
              const state = connectionState[provider.id];
              const ProviderLogo = providerLogos[provider.id] ?? CubesIcon;
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
                      <div
                        style={{
                          minHeight: '2.5rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <StatusBadge status={state.status} />
                      </div>
                      {state.status === 'connected' && state.credentialName ? (
                        <div
                          style={{
                            fontSize: '0.82rem',
                            color: 'var(--pf-global--Color--200)',
                            marginTop: '0.4rem',
                          }}
                        >
                          {t('Credential: {{name}}', { name: state.credentialName })}
                        </div>
                      ) : (
                        <div
                          style={{
                            fontSize: '0.82rem',
                            color: 'var(--pf-global--Color--200)',
                            marginTop: '0.4rem',
                          }}
                        >
                          {t('Click to connect.')}
                        </div>
                      )}
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
          connectionState={connectionState}
          credentialsByProvider={credentialsByProvider}
          setCredentialsByProvider={setCredentialsByProvider}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
          connectingProvider={connectingProvider}
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
  connectionState: ReturnType<typeof getCloudConnections>;
  credentialsByProvider: Record<string, string>;
  setCredentialsByProvider: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onConnect: (providerId: string) => Promise<void>;
  onDisconnect: (providerId: string) => void;
  connectingProvider: string;
}) {
  const { t } = useTranslation();
  const {
    providerId,
    onClose,
    credentials,
    getProviderCredentials,
    connectionState,
    credentialsByProvider,
    setCredentialsByProvider,
    onConnect,
    onDisconnect,
    connectingProvider,
  } = props;

  const provider = cloudProviders.find((p) => p.id === providerId);
  const providerLabel = provider?.label ?? providerId;
  const providerCredentials = getProviderCredentials(providerId);
  const state = connectionState[providerId];
  const selectedCredentialId = Number(credentialsByProvider[providerId] ?? '0');
  const selectedCredential = credentials.find((item) => item.id === selectedCredentialId);
  const canUseSelectedCredential =
    !selectedCredential || Boolean(selectedCredential.summary_fields?.user_capabilities?.use);

  const isConnecting = connectingProvider === providerId;

  return (
    <Modal
      title={t('Connect {{provider}}', { provider: providerLabel })}
      isOpen
      onClose={onClose}
      variant="medium"
      actions={[
        <Button
          key="connect"
          variant="primary"
          onClick={() => void onConnect(providerId)}
          isLoading={isConnecting}
          isDisabled={!canUseSelectedCredential || isConnecting}
        >
          {t('Connect')}
        </Button>,
        <Button
          key="disconnect"
          variant="secondary"
          onClick={() => {
            onDisconnect(providerId);
            onClose();
          }}
          isDisabled={isConnecting || state.status === 'disconnected'}
        >
          {t('Disconnect')}
        </Button>,
        <Button key="cancel" variant="link" onClick={onClose} isDisabled={isConnecting}>
          {t('Cancel')}
        </Button>,
      ]}
    >
      <div style={{ display: 'grid', gap: 16 }}>
        <div>
          <StatusBadge status={state.status} />
        </div>

        {providerId === 'digitalocean' && (
          <Alert isInline variant="info" title={t('DigitalOcean token requirement')}>
            {t(
              'Use a DigitalOcean Personal Access Token (API token) in do_token. Spaces keys or other secrets will not authenticate the connector.'
            )}
          </Alert>
        )}

        <FormGroup label={t('Credential')} fieldId={`${providerId}-credential`}>
          <FormSelect
            id={`${providerId}-credential`}
            value={credentialsByProvider[providerId] ?? ''}
            onChange={(_, value) =>
              setCredentialsByProvider((current) => ({
                ...current,
                [providerId]: String(value),
              }))
            }
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

        {state.error && (
          <Alert isInline variant="danger" title={t('Connection error')}>
            {state.error}
            {providerId === 'digitalocean' &&
              state.error.includes('Unable to authenticate you') && (
                <div style={{ marginTop: 8 }}>
                  {t(
                    'Fix: create a new Personal Access Token in DigitalOcean (API section), update do_token on this credential, then reconnect.'
                  )}
                </div>
              )}
          </Alert>
        )}

        {!canUseSelectedCredential && (
          <Alert isInline variant="warning" title={t('Credential is not usable')}>
            {t('Select a credential with use permission to connect this provider.')}
          </Alert>
        )}
      </div>
    </Modal>
  );
}
