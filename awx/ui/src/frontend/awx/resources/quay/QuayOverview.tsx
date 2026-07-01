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
import { ModuleAIAssistantAction } from '../../common/ModuleAIAssistantAction';
import { awxAPI } from '../../common/api/awx-utils';
import {
  ContentStatusLabel,
  ContentStatusStrip,
  ContentSummaryGrid,
  ContentWorkflowGroups,
} from '../content/ContentManagementCards';
import { AwxRoute } from '../../main/AwxRoutes';

export interface QuayStatus {
  enabled: boolean;
  configured: boolean;
  status: string;
  server_url: string;
  registry: string;
  namespace: string;
  auth_configured: boolean;
  push_configured: boolean;
  push_username_configured: boolean;
  push_token_configured: boolean;
  can_manage: boolean;
  management_configured: boolean;
  management_required_scopes: string[];
  verify_ssl: boolean;
  request_timeout: number;
  settings_url: string;
  message: string;
  counts: {
    repositories: number;
    tags: number;
  };
  controller_error: string;
}

export function QuayOverview() {
  const { t } = useTranslation();
  const getPageUrl = useGetPageUrl();
  const status = useGet<QuayStatus>(awxAPI`/quay/status/`);
  const data = status.data;
  const settingsUrl = getPageUrl(AwxRoute.SettingsQuay) || '/settings/quay';
  const repositoriesUrl = getPageUrl(AwxRoute.QuayRepositories) || '/quay/repositories';
  const repositoryPermissionsUrl = getPageUrl(AwxRoute.QuayRepositoryPermissions);
  const robotsUrl = getPageUrl(AwxRoute.QuayRobots);
  const apiTokenUrl = getPageUrl(AwxRoute.QuayApiToken);
  const imagesUrl =
    getPageUrl(AwxRoute.QuayExecutionEnvironmentImages) || '/quay/execution-environment-images';
  const ready = Boolean(
    data?.enabled && data.configured && data.namespace && !data.controller_error
  );

  return (
    <PageDashboard sectionStyle={{ padding: 24 }}>
      <PageDashboardCard
        id="quay-control-plane"
        title={t('Project Quay')}
        subtitle={t('Container registry for AWX execution environment images')}
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
                enabled={ready}
                enabledText={t('Quay connected')}
                disabledText={t('Quay not ready')}
              />
            </FlexItem>
            <FlexItem>
              <ModuleAIAssistantAction
                module="quay"
                page={t('Project Quay overview')}
                prompt={t(
                  'Help me operate Project Quay for AWX execution environments. Use this registry status, namespace, repository counts, and AWX settings to explain what is configured, what is missing, and what I should do next.'
                )}
                context={{
                  registry: data?.registry,
                  namespace: data?.namespace,
                  configured: data?.configured,
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
            <Alert variant="warning" isInline title={t('Could not load Project Quay status.')} />
          ) : (
            <Stack hasGutter>
              {data?.controller_error ? (
                <StackItem>
                  <Alert variant="warning" isInline title={t('Project Quay request failed.')}>
                    {data.controller_error}
                  </Alert>
                </StackItem>
              ) : null}
              <StackItem>
                <ContentSummaryGrid
                  metrics={[
                    {
                      label: t('Repositories'),
                      value: data?.counts.repositories ?? 0,
                      detail: t('Visible through the Quay API'),
                    },
                    {
                      label: t('Namespace'),
                      value: data?.namespace || t('Not set'),
                      detail: t('Default Quay organization or user'),
                    },
                    {
                      label: t('Tags'),
                      value: data?.counts.tags ?? 0,
                      detail: t('Hosted image versions'),
                    },
                    {
                      label: t('Image push'),
                      value: data?.push_configured ? t('Ready') : t('Missing'),
                      detail: t('Used by AWX build and push plans'),
                    },
                  ]}
                />
              </StackItem>
              <StackItem>
                <ContentStatusStrip
                  items={[
                    {
                      label: t('API token'),
                      value: data?.auth_configured ? t('Configured') : t('Missing'),
                      ok: Boolean(data?.auth_configured),
                    },
                    {
                      label: t('Management'),
                      value: data?.management_configured ? t('Enabled') : t('Read only'),
                      ok: Boolean(data?.management_configured),
                    },
                    {
                      label: t('TLS verify'),
                      value: data?.verify_ssl ? t('Enabled') : t('Disabled'),
                    },
                    {
                      label: t('Timeout'),
                      value: t('{{seconds}}s', { seconds: data?.request_timeout ?? 0 }),
                    },
                  ]}
                />
              </StackItem>
              <StackItem>
                <DescriptionList isHorizontal isCompact>
                  <DescriptionListGroup>
                    <DescriptionListTerm>{t('Registry URL')}</DescriptionListTerm>
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
                    <DescriptionListTerm>{t('Namespace')}</DescriptionListTerm>
                    <DescriptionListDescription>
                      {data?.namespace || t('Not set')}
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                  <DescriptionListGroup>
                    <DescriptionListTerm>{t('Push credentials')}</DescriptionListTerm>
                    <DescriptionListDescription>
                      {data?.push_configured ? t('Configured') : t('Not configured')}
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                  <DescriptionListGroup>
                    <DescriptionListTerm>{t('Status')}</DescriptionListTerm>
                    <DescriptionListDescription>
                      {ready
                        ? t('Project Quay is ready for AWX execution environment image workflows.')
                        : data?.message || t('Complete Project Quay settings before use.')}
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                </DescriptionList>
              </StackItem>
            </Stack>
          )}
        </CardBody>
      </PageDashboardCard>

      <PageDashboardCard
        id="quay-workflows"
        title={t('Registry workspace')}
        subtitle={t('Build, govern, and use execution environment images from AWX')}
        width="full"
      >
        <CardBody>
          <ContentWorkflowGroups
            groups={[
              {
                title: t('Operate images'),
                description: t('Inventory and build paths used by AWX execution environments.'),
                links: [
                  {
                    to: repositoriesUrl,
                    label: t('Repositories'),
                    description: t('Inspect repositories visible to AWX.'),
                  },
                  {
                    to: imagesUrl,
                    label: t('Execution Environments'),
                    description: t('Build and push images from an AWX Project checkout.'),
                  },
                ],
              },
              {
                title: t('Secure access'),
                description: t('Management surfaces for repository and robot access.'),
                links: [
                  ...(repositoryPermissionsUrl
                    ? [
                        {
                          to: repositoryPermissionsUrl,
                          label: t('Repository Permissions'),
                          description: t('Grant user, team, and robot repository access.'),
                        },
                      ]
                    : []),
                  ...(robotsUrl
                    ? [
                        {
                          to: robotsUrl,
                          label: t('Robot Accounts'),
                          description: t('Create and rotate robot accounts.'),
                        },
                      ]
                    : []),
                  {
                    to: settingsUrl,
                    label: t('Credentials and defaults'),
                    description: t('Configure registry, namespace, API token, and push token.'),
                  },
                  ...(apiTokenUrl
                    ? [
                        {
                          to: apiTokenUrl,
                          label: t('API Token'),
                          description: t('Generate and validate the scoped Quay API token.'),
                        },
                      ]
                    : []),
                ],
              },
            ]}
          />
        </CardBody>
      </PageDashboardCard>
    </PageDashboard>
  );
}
