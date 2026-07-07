import {
  Alert,
  Card,
  CardBody,
  CardTitle,
  ClipboardCopy,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  PageSection,
  Stack,
  StackItem,
  Text,
  TextContent,
  TextVariants,
} from '@patternfly/react-core';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { PageHeader, PageLayout, useGetPageUrl } from '../../../../framework';
import { useGet } from '../../../common/crud/useGet';
import { awxAPI } from '../../common/api/awx-utils';
import { AwxRoute } from '../../main/AwxRoutes';
import { GalaxyNgHeaderActions } from './GalaxyNgHeaderActions';
import { GalaxyNgStatus } from './GalaxyNgOverview';

export function GalaxyNgApiToken() {
  const { t } = useTranslation();
  const getPageUrl = useGetPageUrl();
  const status = useGet<GalaxyNgStatus>(awxAPI`/galaxy_ng/status/`);
  const settingsUrl = getPageUrl(AwxRoute.SettingsGalaxyNG) || '/settings/galaxy-ng';

  return (
    <PageLayout>
      <PageHeader
        title={t('API Token')}
        description={t('Galaxy NG credentials AWX uses to read Automation Hub content APIs.')}
        headerActions={
          <GalaxyNgHeaderActions
            status={status.data}
            uiRoute="token/"
            page={t('Galaxy NG API token')}
            prompt={t(
              'Help me configure Galaxy NG API token access for AWX. Explain what is configured, what is missing, and how this affects namespaces, collections, repositories, remotes, and tasks.'
            )}
            context={{
              server_url: status.data?.server_url,
              auth_configured: status.data?.auth_configured,
              api_root_url: status.data?.api_root_url,
              content_url: status.data?.content_url,
            }}
          />
        }
      />
      <PageSection>
        <Stack hasGutter>
          {status.data && !status.data.configured ? (
            <StackItem>
              <Alert isInline variant="warning" title={t('Galaxy NG is not configured')}>
                {status.data.message}
              </Alert>
            </StackItem>
          ) : null}
          <StackItem>
            <Card>
              <CardTitle>{t('AWX Galaxy NG authentication')}</CardTitle>
              <CardBody>
                <DescriptionList isHorizontal isCompact>
                  <DescriptionListGroup>
                    <DescriptionListTerm>{t('Server')}</DescriptionListTerm>
                    <DescriptionListDescription>
                      {status.data?.server_url ? (
                        <ClipboardCopy isReadOnly hoverTip={t('Copy')} clickTip={t('Copied')}>
                          {status.data.server_url}
                        </ClipboardCopy>
                      ) : (
                        t('Not configured')
                      )}
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                  <DescriptionListGroup>
                    <DescriptionListTerm>{t('API root')}</DescriptionListTerm>
                    <DescriptionListDescription>
                      {status.data?.api_root_url || t('Not configured')}
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                  <DescriptionListGroup>
                    <DescriptionListTerm>{t('Content root')}</DescriptionListTerm>
                    <DescriptionListDescription>
                      {status.data?.content_url || t('Not configured')}
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                  <DescriptionListGroup>
                    <DescriptionListTerm>{t('Credential state')}</DescriptionListTerm>
                    <DescriptionListDescription>
                      {status.data?.auth_configured
                        ? t('Token or username/password configured')
                        : t('Anonymous/API public access')}
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                </DescriptionList>
              </CardBody>
            </Card>
          </StackItem>
          <StackItem>
            <Card>
              <CardTitle>{t('Manage token')}</CardTitle>
              <CardBody>
                <TextContent>
                  <Text component={TextVariants.p}>
                    {t(
                      'Store the Galaxy NG API token in AWX settings. AWX uses that token when loading Automation Hub namespaces, collections, repositories, remotes, signing services, and task data.'
                    )}
                  </Text>
                  <Text component={TextVariants.p}>
                    <Link to={settingsUrl}>{t('Open Galaxy NG settings')}</Link>
                  </Text>
                </TextContent>
              </CardBody>
            </Card>
          </StackItem>
        </Stack>
      </PageSection>
    </PageLayout>
  );
}
