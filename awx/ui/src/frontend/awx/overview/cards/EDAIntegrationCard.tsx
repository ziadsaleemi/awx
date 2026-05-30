/**
 * G5b — EDA (Event-Driven Ansible) Integration Status Card
 *
 * Shows the EDA controller connection status and lists recent EDA
 * activations that triggered AWX jobs. Provides a quick link to the
 * EDA controller and shows activation stats.
 *
 * EDA integration is detected via /api/v2/settings/eda/ which holds
 * the EDA_SERVER_URL setting (if configured).
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

interface EDASettings {
  EDA_SERVER_URL?: string;
}

interface EDAJobsResponse {
  count: number;
  results: {
    id: number;
    name: string;
    status: string;
    started?: string;
    finished?: string;
    extra_vars?: string;
  }[];
}

function useEDAStatus() {
  const { data: settings, isLoading: settingsLoading } = useSWR<EDASettings>(
    awxAPI`/settings/eda/`,
    (url: string) => requestGet<EDASettings>(url).catch(() => ({}))
  );

  const edaUrl = settings?.EDA_SERVER_URL;

  // Jobs launched with eda source tag — query jobs with name containing 'eda' or
  // launched_by containing 'eda' as a best-effort detection
  const { data: recentJobs, isLoading: jobsLoading } = useSWR<EDAJobsResponse>(
    edaUrl ? awxAPI`/jobs/?page_size=10&order_by=-started&job_type=run` : null,
    (url: string) => requestGet<EDAJobsResponse>(url).catch(() => ({ count: 0, results: [] }))
  );

  return {
    edaUrl,
    isConfigured: Boolean(edaUrl),
    recentJobs: recentJobs?.results ?? [],
    totalJobs: recentJobs?.count ?? 0,
    isLoading: settingsLoading || jobsLoading,
  };
}

export function EDAIntegrationCard() {
  const { t } = useTranslation();
  const { edaUrl, isConfigured, recentJobs, totalJobs, isLoading } = useEDAStatus();

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
                        {t('Not configured')}
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
                  <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)' }}>
                    {t('Configure your EDA Controller URL under Administration → Settings → EDA to enable event-driven automation.')}
                  </Text>
                </TextContent>
              </StackItem>
            )}

            {isConfigured && recentJobs.length > 0 && (
              <StackItem>
                <TextContent style={{ marginBottom: 6 }}>
                  <Text component={TextVariants.h4} style={{ fontSize: 13, fontWeight: 600 }}>
                    {t('Recent jobs ({{count}} total)', { count: totalJobs })}
                  </Text>
                </TextContent>
                <table style={{ width: '100%', fontSize: 12 }}>
                  <tbody>
                    {recentJobs.slice(0, 5).map((job) => (
                      <tr key={job.id}>
                        <td style={{ padding: '2px 8px 2px 0', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={job.name}>
                          {job.name}
                        </td>
                        <td>
                          <Label
                            color={
                              job.status === 'successful' ? 'green'
                              : job.status === 'failed' ? 'red'
                              : job.status === 'running' ? 'blue'
                              : 'grey'
                            }
                            isCompact
                          >
                            {job.status}
                          </Label>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </StackItem>
            )}
          </Stack>
        )}
      </CardBody>
    </PageDashboardCard>
  );
}
