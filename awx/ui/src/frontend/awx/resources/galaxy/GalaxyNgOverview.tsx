import {
  Alert,
  CardBody,
  ClipboardCopy,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Flex,
  FlexItem,
  Gallery,
  GalleryItem,
  Label,
  Spinner,
  Stack,
  StackItem,
  Text,
  TextContent,
  TextVariants,
  Title,
} from '@patternfly/react-core';
import { CheckCircleIcon, CubesIcon, TimesCircleIcon } from '@patternfly/react-icons';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useGetPageUrl } from '../../../../framework';
import { PageDashboard } from '../../../../framework/PageDashboard/PageDashboard';
import { PageDashboardCard } from '../../../../framework/PageDashboard/PageDashboardCard';
import { useGet } from '../../../common/crud/useGet';
import { awxAPI } from '../../common/api/awx-utils';
import { ModuleAIAssistantAction } from '../../common/ModuleAIAssistantAction';
import { AwxRoute } from '../../main/AwxRoutes';

export interface GalaxyNgStatus {
  enabled: boolean;
  configured: boolean;
  status: string;
  server_url: string;
  api_root_url: string;
  content_url: string;
  ui_url: string;
  auth_configured: boolean;
  verify_ssl: boolean;
  request_timeout: number;
  api_path_prefix: string;
  content_path_prefix: string;
  settings_url: string;
  message: string;
  counts: {
    namespaces: number;
    collections: number;
    repositories: number;
    remotes: number;
    remote_registries: number;
    signature_keys: number;
    collection_approvals: number;
    tasks: number;
  };
  pulp_status: Record<string, unknown>;
  controller_error: string;
}

function StatusLabel(props: { enabled: boolean; enabledText: string; disabledText: string }) {
  return props.enabled ? (
    <Label color="green" icon={<CheckCircleIcon />}>
      {props.enabledText}
    </Label>
  ) : (
    <Label color="grey" icon={<TimesCircleIcon />}>
      {props.disabledText}
    </Label>
  );
}

function MetricTile(props: { label: string; value: string | number; detail?: string }) {
  return (
    <div
      style={{
        border: '1px solid var(--pf-v5-global--BorderColor--100)',
        minHeight: 112,
        minWidth: 0,
        padding: 16,
        width: '100%',
      }}
    >
      <Stack hasGutter>
        <StackItem>
          <Title
            headingLevel="h3"
            size="2xl"
            style={{ lineHeight: 1.15, overflowWrap: 'anywhere', wordBreak: 'break-word' }}
          >
            {props.value}
          </Title>
        </StackItem>
        <StackItem>
          <TextContent>
            <Text component={TextVariants.small}>{props.label}</Text>
            {props.detail ? (
              <Text
                component={TextVariants.small}
                style={{ opacity: 0.75, overflowWrap: 'anywhere', wordBreak: 'break-word' }}
              >
                {props.detail}
              </Text>
            ) : null}
          </TextContent>
        </StackItem>
      </Stack>
    </div>
  );
}

function QuickLink(props: { href?: string; to?: string; label: string; description: string }) {
  return (
    <GalleryItem>
      <Stack hasGutter>
        <StackItem>
          {props.to ? (
            <Link to={props.to}>{props.label}</Link>
          ) : props.href ? (
            <a href={props.href} target="_blank" rel="noreferrer">
              {props.label}
            </a>
          ) : (
            props.label
          )}
        </StackItem>
        <StackItem>
          <TextContent>
            <Text component={TextVariants.small}>{props.description}</Text>
          </TextContent>
        </StackItem>
      </Stack>
    </GalleryItem>
  );
}

function getBrowserUrl(url?: string) {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    const currentHost = typeof window !== 'undefined' ? window.location.hostname : '';
    if (
      parsed.hostname === 'host.docker.internal' &&
      (currentHost === 'localhost' || currentHost === '127.0.0.1')
    ) {
      parsed.hostname = currentHost;
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function getApiBrowserUrl(apiRootUrl?: string) {
  if (!apiRootUrl) return undefined;
  try {
    return new URL('v3/swagger-ui/', apiRootUrl).toString();
  } catch {
    return apiRootUrl;
  }
}

export function GalaxyNgOverview() {
  const { t } = useTranslation();
  const getPageUrl = useGetPageUrl();
  const status = useGet<GalaxyNgStatus>(awxAPI`/galaxy_ng/status/`);
  const data = status.data;
  const settingsUrl = getPageUrl(AwxRoute.SettingsGalaxyNG) || '/settings/galaxy-ng';
  const online = Boolean(data?.enabled && data.configured && !data.controller_error);

  return (
    <PageDashboard sectionStyle={{ padding: 16 }}>
      <PageDashboardCard
        id="galaxy-ng-control-plane"
        title={t('Galaxy NG')}
        subtitle={t(
          'Private automation hub for collections, namespaces, repositories, and import tasks'
        )}
        width="full"
        height="sm"
        headerControls={
          <Flex
            spaceItems={{ default: 'spaceItemsSm' }}
            alignItems={{ default: 'alignItemsCenter' }}
          >
            <FlexItem>
              <StatusLabel
                enabled={Boolean(data?.enabled)}
                enabledText={t('Module enabled')}
                disabledText={t('Module disabled')}
              />
            </FlexItem>
            <FlexItem>
              <StatusLabel
                enabled={online}
                enabledText={t('Hub connected')}
                disabledText={t('Hub not connected')}
              />
            </FlexItem>
            <FlexItem>
              <ModuleAIAssistantAction
                module="galaxy_ng"
                page={t('Galaxy NG overview')}
                prompt={t(
                  'Review this Galaxy NG Automation Hub overview for AWX. Explain connection health, content counts, missing setup, and next actions for collections, repositories, remotes, approvals, signing, and API token access.'
                )}
                context={{
                  configured: data?.configured,
                  server_url: data?.server_url,
                  counts: data?.counts,
                  controller_error: data?.controller_error,
                }}
              />
            </FlexItem>
          </Flex>
        }
      >
        <CardBody>
          {status.isLoading ? (
            <Spinner size="md" />
          ) : status.error ? (
            <Alert variant="warning" isInline title={t('Could not load Galaxy NG status.')} />
          ) : (
            <Stack hasGutter>
              {data?.controller_error ? (
                <StackItem>
                  <Alert variant="warning" isInline title={t('Galaxy NG request failed.')}>
                    {data.controller_error}
                  </Alert>
                </StackItem>
              ) : null}
              <StackItem>
                <div
                  style={{
                    display: 'grid',
                    gap: 16,
                    gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))',
                  }}
                >
                  <MetricTile
                    label={t('Namespaces')}
                    value={data?.counts.namespaces ?? 0}
                    detail={data?.server_url || t('No server configured')}
                  />
                  <MetricTile
                    label={t('Collections')}
                    value={data?.counts.collections ?? 0}
                    detail={t('Synced from Galaxy NG API')}
                  />
                  <MetricTile
                    label={t('Repositories')}
                    value={data?.counts.repositories ?? 0}
                    detail={t('Pulp Ansible repositories')}
                  />
                  <MetricTile
                    label={t('Remotes')}
                    value={data?.counts.remotes ?? 0}
                    detail={t('External collection sources')}
                  />
                  <MetricTile
                    label={t('Remote registries')}
                    value={data?.counts.remote_registries ?? 0}
                    detail={t('External container sources')}
                  />
                  <MetricTile
                    label={t('Signature keys')}
                    value={data?.counts.signature_keys ?? 0}
                    detail={t('Signing services')}
                  />
                  <MetricTile
                    label={t('Approvals')}
                    value={data?.counts.collection_approvals ?? 0}
                    detail={t('Collections waiting in staging')}
                  />
                  <MetricTile
                    label={t('Import tasks')}
                    value={data?.counts.tasks ?? 0}
                    detail={data?.auth_configured ? t('Authenticated') : t('Anonymous/API public')}
                  />
                </div>
              </StackItem>
            </Stack>
          )}
        </CardBody>
      </PageDashboardCard>

      <PageDashboardCard
        id="galaxy-ng-connection"
        title={t('Connection')}
        subtitle={t('AWX connection settings used to reach Galaxy NG')}
        width="half"
        height="sm"
        linkText={t('Open settings')}
        to={settingsUrl}
      >
        <CardBody>
          <DescriptionList isHorizontal isCompact>
            <DescriptionListGroup>
              <DescriptionListTerm>{t('Server')}</DescriptionListTerm>
              <DescriptionListDescription>
                {data?.server_url ? (
                  <ClipboardCopy isReadOnly hoverTip={t('Copy')} clickTip={t('Copied')}>
                    {data.server_url}
                  </ClipboardCopy>
                ) : (
                  t('Not configured')
                )}
              </DescriptionListDescription>
            </DescriptionListGroup>
            <DescriptionListGroup>
              <DescriptionListTerm>{t('API root')}</DescriptionListTerm>
              <DescriptionListDescription>
                {data?.api_root_url || t('Not configured')}
              </DescriptionListDescription>
            </DescriptionListGroup>
            <DescriptionListGroup>
              <DescriptionListTerm>{t('Content root')}</DescriptionListTerm>
              <DescriptionListDescription>
                {data?.content_url || t('Not configured')}
              </DescriptionListDescription>
            </DescriptionListGroup>
            <DescriptionListGroup>
              <DescriptionListTerm>{t('TLS verify')}</DescriptionListTerm>
              <DescriptionListDescription>
                {data?.verify_ssl ? t('Enabled') : t('Disabled')}
              </DescriptionListDescription>
            </DescriptionListGroup>
          </DescriptionList>
        </CardBody>
      </PageDashboardCard>

      <PageDashboardCard
        id="galaxy-ng-workflows"
        title={t('Content workflows')}
        subtitle={t('Use Galaxy NG as AWX private automation hub content source')}
        width="half"
        height="sm"
      >
        <CardBody>
          <Gallery hasGutter minWidths={{ default: '220px' }}>
            <QuickLink
              to={getPageUrl(AwxRoute.GalaxyNGNamespaces) || '/galaxy-ng/namespaces'}
              label={t('Namespaces')}
              description={t('Review private automation hub namespaces visible to AWX.')}
            />
            <QuickLink
              to={getPageUrl(AwxRoute.GalaxyNGCollections) || '/galaxy-ng/collections'}
              label={t('Collections')}
              description={t('Review private automation hub collections visible to AWX.')}
            />
            <QuickLink
              to={getPageUrl(AwxRoute.GalaxyNGProjectImports) || '/galaxy-ng/project-imports'}
              label={t('Project Imports')}
              description={t('Build and publish collection artifacts from synced AWX Projects.')}
            />
            <QuickLink
              to={getPageUrl(AwxRoute.GalaxyNGRepositories) || '/galaxy-ng/repositories'}
              label={t('Repositories')}
              description={t('Inspect Pulp Ansible repositories backing content distribution.')}
            />
            <QuickLink
              to={getPageUrl(AwxRoute.GalaxyNGRemotes) || '/galaxy-ng/remotes'}
              label={t('Remotes')}
              description={t('Inspect remote Automation Hub sources used for collection sync.')}
            />
            <QuickLink
              to={getPageUrl(AwxRoute.GalaxyNGRemoteRegistries) || '/galaxy-ng/remote-registries'}
              label={t('Remote Registries')}
              description={t(
                'Inspect external registries Galaxy NG can pull container content from.'
              )}
            />
            <QuickLink
              to={getPageUrl(AwxRoute.GalaxyNGSignatureKeys) || '/galaxy-ng/signature-keys'}
              label={t('Signature Keys')}
              description={t('Review signing services used to verify automation content.')}
            />
            <QuickLink
              to={
                getPageUrl(AwxRoute.GalaxyNGCollectionApprovals) ||
                '/galaxy-ng/collection-approvals'
              }
              label={t('Collection Approvals')}
              description={t(
                'Review staged collection versions before promotion to approved content.'
              )}
            />
            <QuickLink
              to={getPageUrl(AwxRoute.GalaxyNGTasks) || '/galaxy-ng/tasks'}
              label={t('Tasks')}
              description={t('Track import, sync, copy, and publish task state.')}
            />
            <QuickLink
              to={getPageUrl(AwxRoute.GalaxyNGApiToken) || '/galaxy-ng/api-token'}
              label={t('API Token')}
              description={t('See how AWX authenticates to Galaxy NG APIs.')}
            />
            <QuickLink
              to={
                getPageUrl(AwxRoute.QuayExecutionEnvironmentImages) ||
                '/quay/execution-environment-images'
              }
              label={t('Execution Environments')}
              description={t('Use Project Quay for AWX execution environment image hosting.')}
            />
            <QuickLink
              href={getBrowserUrl(getApiBrowserUrl(data?.api_root_url))}
              label={t('Open Galaxy NG API')}
              description={t('Open the live Galaxy NG API browser for direct hub operations.')}
            />
          </Gallery>
        </CardBody>
      </PageDashboardCard>

      <PageDashboardCard
        id="galaxy-ng-status"
        title={t('Pulp status')}
        subtitle={t('Live status returned by the Galaxy NG/Pulp API')}
        width="full"
        height="xs"
      >
        <CardBody>
          <Flex
            alignItems={{ default: 'alignItemsCenter' }}
            spaceItems={{ default: 'spaceItemsMd' }}
          >
            <FlexItem>
              <CubesIcon />
            </FlexItem>
            <FlexItem grow={{ default: 'grow' }}>
              <TextContent>
                <Text component={TextVariants.p}>
                  {data?.message || t('Loading Galaxy NG status.')}
                </Text>
                <Text component={TextVariants.small}>
                  {data?.pulp_status && Object.keys(data.pulp_status).length
                    ? t('Pulp API responded.')
                    : t('No Pulp status payload available.')}
                </Text>
              </TextContent>
            </FlexItem>
          </Flex>
        </CardBody>
      </PageDashboardCard>
    </PageDashboard>
  );
}
