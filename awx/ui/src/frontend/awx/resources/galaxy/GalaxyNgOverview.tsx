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
import { AwxRoute } from '../../main/AwxRoutes';

interface GalaxyNgStatus {
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
              href={data?.ui_url}
              label={t('Open Galaxy NG UI')}
              description={t('Review namespaces, collections, approvals, and import tasks.')}
            />
            <QuickLink
              to={getPageUrl(AwxRoute.Projects) || '/projects'}
              label={t('AWX Projects')}
              description={t('Use project sync with requirements.yml pointing at private hub.')}
            />
            <QuickLink
              to={settingsUrl}
              label={t('Hub connection')}
              description={t('Configure server URL, API token, basic auth, and path prefixes.')}
            />
            <QuickLink
              to={getPageUrl(AwxRoute.SettingsJobs) || '/settings/job-settings'}
              label={t('Job settings')}
              description={t('Set ansible-galaxy environment for project update jobs.')}
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
