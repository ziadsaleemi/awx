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
import { ModuleAIAssistantAction } from '../../common/ModuleAIAssistantAction';
import { awxAPI } from '../../common/api/awx-utils';
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

function QuickLink(props: { to?: string; label: string; description: string }) {
  return (
    <Stack hasGutter>
      <StackItem>{props.to ? <Link to={props.to}>{props.label}</Link> : props.label}</StackItem>
      <StackItem>
        <TextContent>
          <Text component={TextVariants.small}>{props.description}</Text>
        </TextContent>
      </StackItem>
    </Stack>
  );
}

export function QuayOverview() {
  const { t } = useTranslation();
  const getPageUrl = useGetPageUrl();
  const status = useGet<QuayStatus>(awxAPI`/quay/status/`);
  const data = status.data;
  const settingsUrl = getPageUrl(AwxRoute.SettingsQuay) || '/settings/quay';
  const repositoriesUrl = getPageUrl(AwxRoute.QuayRepositories) || '/quay/repositories';
  const imagesUrl =
    getPageUrl(AwxRoute.QuayExecutionEnvironmentImages) || '/quay/execution-environment-images';
  const ready = Boolean(
    data?.enabled && data.configured && data.namespace && !data.controller_error
  );

  return (
    <PageDashboard sectionStyle={{ padding: 16 }}>
      <PageDashboardCard
        id="quay-control-plane"
        title={t('Project Quay')}
        subtitle={t('Container registry for AWX execution environment images')}
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
            <Spinner size="md" />
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
                <div
                  style={{
                    display: 'grid',
                    gap: 16,
                    gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))',
                  }}
                >
                  <MetricTile
                    label={t('Registry')}
                    value={data?.registry || t('Not configured')}
                    detail={data?.server_url || t('No registry URL configured')}
                  />
                  <MetricTile
                    label={t('Namespace')}
                    value={data?.namespace || t('Not set')}
                    detail={t('Default organization or user namespace')}
                  />
                  <MetricTile
                    label={t('Repositories')}
                    value={data?.counts.repositories ?? 0}
                    detail={t('Readable from Project Quay API')}
                  />
                  <MetricTile
                    label={t('Push credentials')}
                    value={data?.push_configured ? t('Ready') : t('Missing')}
                    detail={t('Robot account or username/token for image pushes')}
                  />
                </div>
              </StackItem>
            </Stack>
          )}
        </CardBody>
      </PageDashboardCard>

      <PageDashboardCard
        id="quay-connection"
        title={t('Connection')}
        subtitle={t('AWX settings used to read Project Quay and generate push commands')}
        width="half"
        height="sm"
        linkText={t('Open settings')}
        to={settingsUrl}
      >
        <CardBody>
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
              <DescriptionListTerm>{t('API token')}</DescriptionListTerm>
              <DescriptionListDescription>
                {data?.auth_configured ? t('Configured') : t('Not configured')}
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
        id="quay-workflows"
        title={t('Execution environment workflows')}
        subtitle={t('Build images from AWX Projects and host them in Project Quay')}
        width="half"
        height="sm"
      >
        <CardBody>
          <Stack hasGutter>
            <QuickLink
              to={repositoriesUrl}
              label={t('Repositories')}
              description={t('Inspect Project Quay repositories visible to AWX.')}
            />
            <QuickLink
              to={imagesUrl}
              label={t('Execution Environments')}
              description={t('Generate build and push commands from an AWX Project checkout.')}
            />
            <QuickLink
              to={settingsUrl}
              label={t('Credentials and defaults')}
              description={t('Configure registry URL, namespace, API token, and push credentials.')}
            />
          </Stack>
        </CardBody>
      </PageDashboardCard>

      <PageDashboardCard
        id="quay-status"
        title={t('Registry status')}
        subtitle={t('Current Project Quay integration state')}
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
                  {data?.message || t('Loading Project Quay status.')}
                </Text>
                <Text component={TextVariants.small}>
                  {ready
                    ? t('Project Quay is ready for AWX execution environment image workflows.')
                    : t('Complete Project Quay settings before building or pushing images.')}
                </Text>
              </TextContent>
            </FlexItem>
          </Flex>
        </CardBody>
      </PageDashboardCard>
    </PageDashboard>
  );
}
