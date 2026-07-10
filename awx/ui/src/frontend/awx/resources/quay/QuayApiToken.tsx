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
  Label,
  PageSection,
  Stack,
  StackItem,
  Text,
  TextContent,
  TextVariants,
} from '@patternfly/react-core';
import { CheckCircleIcon, ExclamationCircleIcon } from '@patternfly/react-icons';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { PageHeader, PageLayout, useGetPageUrl } from '../../../../framework';
import { useGet } from '../../../common/crud/useGet';
import { ModuleAIAssistantAction } from '../../common/ModuleAIAssistantAction';
import { awxAPI } from '../../common/api/awx-utils';
import { AwxRoute } from '../../main/AwxRoutes';
import { QuayStatus } from './QuayOverview';

interface QuayTokenPlan {
  source: string;
  configured: boolean;
  status: string;
  server_url: string;
  namespace: string;
  auth_configured: boolean;
  settings_url: string;
  required_scopes: string[];
  token_setting: string;
  push_settings: string[];
  oauth_application: {
    name: string;
    description: string;
    create_method: string;
    create_url: string;
    payload: Record<string, string>;
  };
  app_specific_token: {
    create_method: string;
    create_url: string;
    payload: Record<string, string>;
  };
  validation_commands: {
    label: string;
    command: string;
  }[];
  notes: string[];
}

function StatusLabel(props: { configured?: boolean }) {
  const { t } = useTranslation();
  return props.configured ? (
    <Label color="green" icon={<CheckCircleIcon />}>
      {t('Configured')}
    </Label>
  ) : (
    <Label color="orange" icon={<ExclamationCircleIcon />}>
      {t('Missing')}
    </Label>
  );
}

function JsonClipboard(props: { value: unknown }) {
  return (
    <ClipboardCopy isReadOnly hoverTip="Copy" clickTip="Copied">
      {JSON.stringify(props.value, null, 2)}
    </ClipboardCopy>
  );
}

export function QuayApiToken() {
  const { t } = useTranslation();
  const getPageUrl = useGetPageUrl();
  const status = useGet<QuayStatus>(awxAPI`/quay/status/`);
  const tokenPlan = useGet<QuayTokenPlan>(awxAPI`/quay/api-token-plan/`);
  const settingsUrl = getPageUrl(AwxRoute.SettingsQuay) || '/settings/quay';
  const data = tokenPlan.data;

  return (
    <PageLayout>
      <PageHeader
        title={t('API Token')}
        description={t(
          'Create, validate, and store the Project Quay management token used by Capstan.'
        )}
        headerActions={
          <ModuleAIAssistantAction
            module="quay"
            page={t('Project Quay API token')}
            prompt={t(
              'Help me configure Project Quay API token access for Capstan. Explain the required scopes, validation commands, token storage setting, and difference between API management token and robot push credentials.'
            )}
            context={{
              server_url: data?.server_url,
              namespace: data?.namespace,
              auth_configured: data?.auth_configured,
              required_scopes: data?.required_scopes,
            }}
          />
        }
      />
      <PageSection>
        <Stack hasGutter>
          {status.data && !status.data.configured ? (
            <StackItem>
              <Alert isInline variant="warning" title={t('Project Quay is not configured')}>
                {status.data.message}
              </Alert>
            </StackItem>
          ) : null}
          <StackItem>
            <Card>
              <CardTitle>{t('Capstan Quay management authentication')}</CardTitle>
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
                    <DescriptionListTerm>{t('Namespace')}</DescriptionListTerm>
                    <DescriptionListDescription>
                      {data?.namespace || t('Not configured')}
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                  <DescriptionListGroup>
                    <DescriptionListTerm>{t('Credential state')}</DescriptionListTerm>
                    <DescriptionListDescription>
                      <StatusLabel configured={data?.auth_configured} />
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                  <DescriptionListGroup>
                    <DescriptionListTerm>{t('Capstan setting')}</DescriptionListTerm>
                    <DescriptionListDescription>
                      {data?.token_setting || 'QUAY_API_TOKEN'}
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                </DescriptionList>
              </CardBody>
            </Card>
          </StackItem>
          <StackItem>
            <Card>
              <CardTitle>{t('Required scopes')}</CardTitle>
              <CardBody>
                <Stack hasGutter>
                  <StackItem>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {(data?.required_scopes || status.data?.management_required_scopes || []).map(
                        (scope) => (
                          <Label key={scope} color="blue">
                            {scope}
                          </Label>
                        )
                      )}
                    </div>
                  </StackItem>
                  <StackItem>
                    <TextContent>
                      <Text component={TextVariants.small}>
                        {t(
                          'These scopes allow Capstan to read repositories, create repositories, manage repository visibility, manage repository permissions, manage robot accounts, and delete image tags.'
                        )}
                      </Text>
                    </TextContent>
                  </StackItem>
                </Stack>
              </CardBody>
            </Card>
          </StackItem>
          <StackItem>
            <Card>
              <CardTitle>{t('Token creation API references')}</CardTitle>
              <CardBody>
                <Stack hasGutter>
                  <StackItem>
                    <DescriptionList isHorizontal isCompact>
                      <DescriptionListGroup>
                        <DescriptionListTerm>
                          {t('Organization OAuth application')}
                        </DescriptionListTerm>
                        <DescriptionListDescription>
                          {data?.oauth_application.create_url ? (
                            <ClipboardCopy isReadOnly hoverTip={t('Copy')} clickTip={t('Copied')}>
                              {data.oauth_application.create_url}
                            </ClipboardCopy>
                          ) : (
                            t('Configure Project Quay URL and namespace first.')
                          )}
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                      <DescriptionListGroup>
                        <DescriptionListTerm>{t('User app token')}</DescriptionListTerm>
                        <DescriptionListDescription>
                          {data?.app_specific_token.create_url ? (
                            <ClipboardCopy isReadOnly hoverTip={t('Copy')} clickTip={t('Copied')}>
                              {data.app_specific_token.create_url}
                            </ClipboardCopy>
                          ) : (
                            t('Configure Project Quay URL first.')
                          )}
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                    </DescriptionList>
                  </StackItem>
                  <StackItem>
                    <TextContent>
                      <Text component={TextVariants.small}>{t('OAuth application payload')}</Text>
                    </TextContent>
                    <JsonClipboard value={data?.oauth_application.payload || {}} />
                  </StackItem>
                  <StackItem>
                    <TextContent>
                      <Text component={TextVariants.small}>{t('User app token payload')}</Text>
                    </TextContent>
                    <JsonClipboard value={data?.app_specific_token.payload || {}} />
                  </StackItem>
                </Stack>
              </CardBody>
            </Card>
          </StackItem>
          <StackItem>
            <Card>
              <CardTitle>{t('Validate before storing')}</CardTitle>
              <CardBody>
                <Stack hasGutter>
                  {(data?.validation_commands || [])
                    .filter((command) => command.command)
                    .map((command) => (
                      <StackItem key={command.label}>
                        <TextContent>
                          <Text component={TextVariants.small}>{command.label}</Text>
                        </TextContent>
                        <ClipboardCopy isReadOnly hoverTip={t('Copy')} clickTip={t('Copied')}>
                          {command.command}
                        </ClipboardCopy>
                      </StackItem>
                    ))}
                  <StackItem>
                    <Alert
                      isInline
                      variant="info"
                      title={t('Store the validated token in Capstan settings.')}
                    >
                      <TextContent>
                        <Text component={TextVariants.p}>
                          <Link to={settingsUrl}>{t('Open Project Quay settings')}</Link>
                        </Text>
                        {(data?.notes || []).map((note) => (
                          <Text key={note} component={TextVariants.small}>
                            {note}
                          </Text>
                        ))}
                      </TextContent>
                    </Alert>
                  </StackItem>
                </Stack>
              </CardBody>
            </Card>
          </StackItem>
        </Stack>
      </PageSection>
    </PageLayout>
  );
}
