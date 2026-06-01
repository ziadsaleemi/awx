/**
 * G5b — EDA (Event-Driven Ansible) Integration Status Card
 *
 * Shows the EDA controller connection status and lists recent EDA
 * activations that triggered AWX jobs. Provides a quick link to the
 * EDA controller and shows activation stats.
 *
 * EDA integration is detected via /api/v2/eda/status/. Recent rows come
 * from /api/v2/eda/activations/ so overview, AI, and API share one facade.
 */

import {
  Button,
  CardBody,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Label,
  Spinner,
  Stack,
  StackItem,
  Text,
  TextContent,
  TextVariants,
} from '@patternfly/react-core';
import { CheckCircleIcon, ExternalLinkAltIcon, TimesCircleIcon } from '@patternfly/react-icons';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { PageDashboardCard } from '../../../../framework/PageDashboard/PageDashboardCard';
import { requestGet } from '../../../common/crud/Data';
import { awxAPI } from '../../common/api/awx-utils';

interface EDAStatus {
  configured: boolean;
  status: string;
  controller_url: string;
  message: string;
  settings_url: string;
  activations_url: string;
}

interface EDAActivationsResponse {
  count: number;
  results: {
    id: number;
    name: string;
    status: string;
    started?: string;
    finished?: string;
    rulebook?: string;
    event_source?: string;
  }[];
}

function useEDAStatus() {
  const { data: status, isLoading: statusLoading } = useSWR<EDAStatus>(
    awxAPI`/eda/status/`,
    (url: string) =>
      requestGet<EDAStatus>(url).catch(() => ({
        configured: false,
        status: 'unavailable',
        controller_url: '',
        message: '',
        settings_url: '',
        activations_url: '',
      }))
  );

  const { data: activations, isLoading: activationsLoading } = useSWR<EDAActivationsResponse>(
    status?.configured ? awxAPI`/eda/activations/?page_size=10` : null,
    (url: string) =>
      requestGet<EDAActivationsResponse>(url).catch(() => ({ count: 0, results: [] }))
  );

  return {
    edaUrl: status?.controller_url,
    status: status?.status ?? 'unavailable',
    isConfigured: Boolean(status?.configured),
    activations: activations?.results ?? [],
    totalActivations: activations?.count ?? 0,
    isLoading: statusLoading || activationsLoading,
  };
}

export function EDAIntegrationCard() {
  const { t } = useTranslation();
  const { edaUrl, status, isConfigured, activations, totalActivations, isLoading } = useEDAStatus();

  return (
    <PageDashboardCard title={t('Event-Driven Ansible')} width="md" height="sm">
      <CardBody>
        {isLoading ? (
          <Spinner size="lg" />
        ) : (
          <Stack hasGutter>
            <StackItem>
              <DescriptionList isCompact isHorizontal>
                <DescriptionListGroup>
                  <DescriptionListTerm>{t('EDA Controller')}</DescriptionListTerm>
                  <DescriptionListDescription>
                    {isConfigured ? (
                      <Label color="green" icon={<CheckCircleIcon />}>
                        {t('Connected')}
                      </Label>
                    ) : (
                      <Label color="grey" icon={<TimesCircleIcon />}>
                        {status === 'unavailable' ? t('Unavailable') : t('Not configured')}
                      </Label>
                    )}
                  </DescriptionListDescription>
                </DescriptionListGroup>
                {isConfigured && (
                  <DescriptionListGroup>
                    <DescriptionListTerm>{t('Server URL')}</DescriptionListTerm>
                    <DescriptionListDescription>
                      <Button
                        variant="link"
                        isInline
                        icon={<ExternalLinkAltIcon />}
                        iconPosition="right"
                        component="a"
                        href={edaUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {edaUrl}
                      </Button>
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                )}
              </DescriptionList>
            </StackItem>

            {!isConfigured && (
              <StackItem>
                <TextContent>
                  <Text
                    component={TextVariants.small}
                    style={{ color: 'var(--pf-v5-global--Color--200)' }}
                  >
                    {t(
                      'Configure your EDA Controller URL under Administration → Settings → EDA to enable event-driven automation.'
                    )}
                  </Text>
                </TextContent>
              </StackItem>
            )}

            {isConfigured && activations.length > 0 && (
              <StackItem>
                <TextContent style={{ marginBottom: 6 }}>
                  <Text component={TextVariants.h4} style={{ fontSize: 13, fontWeight: 600 }}>
                    {t('Recent activations ({{count}} total)', { count: totalActivations })}
                  </Text>
                </TextContent>
                <table style={{ width: '100%', fontSize: 12 }}>
                  <tbody>
                    {activations.slice(0, 5).map((activation) => (
                      <tr key={activation.id}>
                        <td
                          style={{
                            padding: '2px 8px 2px 0',
                            maxWidth: 200,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={activation.name}
                        >
                          {activation.name}
                        </td>
                        <td>
                          <Label
                            color={
                              activation.status === 'successful'
                                ? 'green'
                                : activation.status === 'failed'
                                  ? 'red'
                                  : activation.status === 'running'
                                    ? 'blue'
                                    : 'grey'
                            }
                            isCompact
                          >
                            {activation.status}
                          </Label>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </StackItem>
            )}

            {isConfigured && activations.length === 0 && (
              <StackItem>
                <TextContent>
                  <Text
                    component={TextVariants.small}
                    style={{ color: 'var(--pf-v5-global--Color--200)' }}
                  >
                    {t('No recent EDA-linked AWX jobs found.')}
                  </Text>
                </TextContent>
              </StackItem>
            )}
          </Stack>
        )}
      </CardBody>
    </PageDashboardCard>
  );
}
