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
  Spinner,
  Stack,
  StackItem,
} from '@patternfly/react-core';
import { useTranslation } from 'react-i18next';
import { useGetPageUrl } from '../../../../framework';
import { PageDashboard } from '../../../../framework/PageDashboard/PageDashboard';
import { PageDashboardCard } from '../../../../framework/PageDashboard/PageDashboardCard';
import { useGet } from '../../../common/crud/useGet';
import { awxAPI } from '../../common/api/awx-utils';
import { ModuleAIAssistantAction } from '../../common/ModuleAIAssistantAction';
import {
  ContentStatusLabel,
  ContentStatusStrip,
  ContentSummaryGrid,
  ContentWorkflowGroups,
} from '../content/ContentManagementCards';
import { AwxRoute } from '../../main/AwxRoutes';

export interface GalaxyNgStatus {
  enabled: boolean;
  configured: boolean;
  status: string;
  server_url: string;
  api_root_url: string;
  api_browser_url: string;
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
    <PageDashboard sectionStyle={{ padding: 24 }}>
      <PageDashboardCard
        id="galaxy-ng-control-plane"
        title={t('Automation Hub')}
        subtitle={t(
          'Galaxy NG private automation hub for collections, namespaces, repositories, and import tasks'
        )}
        width="full"
        linkText={t('Open settings')}
        to={settingsUrl}
        headerControls={
          <Flex
            spaceItems={{ default: 'spaceItemsSm' }}
            alignItems={{ default: 'alignItemsCenter' }}
          >
            <FlexItem>
              <ContentStatusLabel
                enabled={Boolean(data?.enabled)}
                enabledText={t('Module enabled')}
                disabledText={t('Module disabled')}
              />
            </FlexItem>
            <FlexItem>
              <ContentStatusLabel
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
            <div
              style={{
                alignItems: 'center',
                display: 'flex',
                minHeight: 120,
              }}
            >
              <Spinner size="md" />
            </div>
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
              {!online ? (
                <StackItem>
                  <Alert
                    variant="warning"
                    isInline
                    title={t('Galaxy NG is not ready for AWX content workflows')}
                  >
                    {data?.message || t('Configure Galaxy NG settings before using this module.')}
                  </Alert>
                </StackItem>
              ) : null}
              <StackItem>
                <ContentSummaryGrid
                  metrics={[
                    {
                      label: t('Collections'),
                      value: data?.counts.collections ?? 0,
                      detail: t('Available automation content'),
                    },
                    {
                      label: t('Namespaces'),
                      value: data?.counts.namespaces ?? 0,
                      detail: t('Private hub namespaces'),
                    },
                    {
                      label: t('Repositories'),
                      value: data?.counts.repositories ?? 0,
                      detail: t('Pulp Ansible repositories'),
                    },
                    {
                      label: t('Remotes'),
                      value: data?.counts.remotes ?? 0,
                      detail: t('External collection sources'),
                    },
                    {
                      label: t('Approvals'),
                      value: data?.counts.collection_approvals ?? 0,
                      detail: t('Staged versions waiting review'),
                    },
                    {
                      label: t('Tasks'),
                      value: data?.counts.tasks ?? 0,
                      detail: t('Import, sync, copy, and publish activity'),
                    },
                  ]}
                  minWidth={135}
                />
              </StackItem>
              <StackItem>
                <ContentStatusStrip
                  items={[
                    {
                      label: t('API auth'),
                      value: data?.auth_configured ? t('Configured') : t('Public only'),
                      ok: Boolean(data?.auth_configured),
                    },
                    {
                      label: t('Remote registries'),
                      value: data?.counts.remote_registries ?? 0,
                    },
                    {
                      label: t('Signature keys'),
                      value: data?.counts.signature_keys ?? 0,
                    },
                    {
                      label: t('TLS verify'),
                      value: data?.verify_ssl ? t('Enabled') : t('Disabled'),
                    },
                  ]}
                />
              </StackItem>
              <StackItem>
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
                    <DescriptionListTerm>{t('Status')}</DescriptionListTerm>
                    <DescriptionListDescription>
                      {data?.pulp_status && Object.keys(data.pulp_status).length
                        ? t('Pulp API responded.')
                        : data?.message || t('No Pulp status payload available.')}
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                </DescriptionList>
              </StackItem>
            </Stack>
          )}
        </CardBody>
      </PageDashboardCard>

      <PageDashboardCard
        id="galaxy-ng-workflows"
        title={t('Automation Hub workspace')}
        subtitle={t('Manage content lifecycle, distribution, trust, and operations')}
        width="full"
      >
        <CardBody>
          <ContentWorkflowGroups
            groups={[
              {
                title: t('Content lifecycle'),
                description: t('Author, import, approve, and consume automation collections.'),
                links: [
                  {
                    to: getPageUrl(AwxRoute.GalaxyNGNamespaces),
                    label: t('Namespaces'),
                    description: t('Review private automation hub namespaces.'),
                  },
                  {
                    to: getPageUrl(AwxRoute.GalaxyNGCollections),
                    label: t('Collections'),
                    description: t('Browse collections available to AWX.'),
                  },
                  {
                    to: getPageUrl(AwxRoute.GalaxyNGProjectImports),
                    label: t('Project Imports'),
                    description: t('Build and publish collection artifacts from AWX Projects.'),
                  },
                  {
                    to: getPageUrl(AwxRoute.GalaxyNGCollectionApprovals),
                    label: t('Collection Approvals'),
                    description: t('Promote staged versions into approved content.'),
                  },
                ],
              },
              {
                title: t('Distribution'),
                description: t('Sync, mirror, and serve collection and image sources.'),
                links: [
                  {
                    to: getPageUrl(AwxRoute.GalaxyNGRepositories),
                    label: t('Repositories'),
                    description: t('Inspect Pulp Ansible repositories.'),
                  },
                  {
                    to: getPageUrl(AwxRoute.GalaxyNGRemotes),
                    label: t('Remotes'),
                    description: t('Inspect remote Automation Hub collection sources.'),
                  },
                  {
                    to: getPageUrl(AwxRoute.GalaxyNGRemoteRegistries),
                    label: t('Remote Registries'),
                    description: t('Inspect external container registries.'),
                  },
                  {
                    to: getPageUrl(AwxRoute.QuayExecutionEnvironmentImages),
                    label: t('Project Quay Execution Environments'),
                    description: t('Build EE images in the separate Project Quay module.'),
                  },
                ],
              },
              {
                title: t('Trust and operations'),
                description: t('Signing, task state, and live API access.'),
                links: [
                  {
                    to: getPageUrl(AwxRoute.GalaxyNGSignatureKeys),
                    label: t('Signature Keys'),
                    description: t('Review signing services for automation content.'),
                  },
                  {
                    to: getPageUrl(AwxRoute.GalaxyNGTasks),
                    label: t('Task Management'),
                    description: t('Track import, sync, copy, and publish task state.'),
                  },
                  {
                    to: getPageUrl(AwxRoute.GalaxyNGApiToken),
                    label: t('API Token'),
                    description: t('Review AWX authentication for Galaxy NG APIs.'),
                  },
                  {
                    href: getBrowserUrl(data?.ui_url),
                    label: t('Open Galaxy NG UI'),
                    description: t('Open the live Automation Hub UI served by the deploy stack.'),
                  },
                  {
                    href: getBrowserUrl(
                      data?.api_browser_url || getApiBrowserUrl(data?.api_root_url)
                    ),
                    label: t('Open Galaxy NG API'),
                    description: t('Open the live API browser for direct hub operations.'),
                  },
                ],
              },
            ]}
          />
        </CardBody>
      </PageDashboardCard>
    </PageDashboard>
  );
}
