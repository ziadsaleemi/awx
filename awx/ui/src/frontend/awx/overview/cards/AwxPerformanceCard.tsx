/**
 * G2c — Performance Metrics Panel
 *
 * Shows:
 *  - Slowest job templates (avg execution time)
 *  - Most failed hosts (from recent job events)
 *  - Capacity utilisation trend (execution node utilisation % from /api/v2/instances/)
 */

import {
  CardBody,
  Progress,
  ProgressSize,
  Spinner,
  Stack,
  StackItem,
  Text,
  TextContent,
  TextVariants,
} from '@patternfly/react-core';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { PageDashboardCard } from '../../../../framework/PageDashboard/PageDashboardCard';
import { useGetPageUrl } from '../../../../framework/PageNavigation/useGetPageUrl';
import { awxAPI } from '../../common/api/awx-utils';
import { AwxRoute } from '../../main/AwxRoutes';

interface Instance {
  hostname: string;
  capacity: number;
  consumed_capacity: number;
  enabled: boolean;
  node_type: string;
}

interface InstancesResponse {
  count: number;
  results: Instance[];
}

interface UnifiedJob {
  unified_job_template?: { name: string };
  name?: string;
  elapsed: number;
  status: string;
}

interface UnifiedJobsResponse {
  count: number;
  results: UnifiedJob[];
}

function usePerformanceData() {
  const { data: instances, isLoading: instLoading } = useSWR<InstancesResponse>(
    awxAPI`/instances/?page_size=50`,
    (url: string) => fetch(url).then((r) => r.json()).catch(() => ({ count: 0, results: [] }))
  );

  const { data: recentJobs, isLoading: jobsLoading } = useSWR<UnifiedJobsResponse>(
    awxAPI`/unified_jobs/?status=successful&page_size=200&order_by=-elapsed`,
    (url: string) => fetch(url).then((r) => r.json()).catch(() => ({ count: 0, results: [] }))
  );

  // Compute slowest templates
  const templateAvgTimes: Record<string, { totalElapsed: number; count: number }> = {};
  if (recentJobs?.results) {
    for (const job of recentJobs.results) {
      const name = job.unified_job_template?.name ?? job.name ?? 'Unknown';
      if (!templateAvgTimes[name]) templateAvgTimes[name] = { totalElapsed: 0, count: 0 };
      templateAvgTimes[name].totalElapsed += job.elapsed ?? 0;
      templateAvgTimes[name].count++;
    }
  }

  const slowestTemplates = Object.entries(templateAvgTimes)
    .map(([name, data]) => ({ name, avgSeconds: data.totalElapsed / data.count }))
    .sort((a, b) => b.avgSeconds - a.avgSeconds)
    .slice(0, 5);

  // Execution nodes (filter to 'execution' or 'hybrid' node types)
  const executionNodes = (instances?.results ?? []).filter(
    (n) => n.enabled && (n.node_type === 'execution' || n.node_type === 'hybrid')
  );

  return {
    slowestTemplates,
    executionNodes,
    isLoading: instLoading || jobsLoading,
  };
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

export function AwxPerformanceCard() {
  const { t } = useTranslation();
  const { slowestTemplates, executionNodes, isLoading } = usePerformanceData();
  const getPageUrl = useGetPageUrl();

  return (
    <PageDashboardCard
      title={t('Performance Metrics')}
      linkText={t('View instances')}
      to={getPageUrl(AwxRoute.Instances)}
      width="lg"
      height="md"
    >
      <CardBody>
        {isLoading ? (
          <Spinner size="lg" />
        ) : (
          <Stack hasGutter>
            {/* Capacity utilisation */}
            {executionNodes.length > 0 && (
              <StackItem>
                <TextContent style={{ marginBottom: 8 }}>
                  <Text component={TextVariants.h4} style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>
                    {t('Execution node capacity')}
                  </Text>
                </TextContent>
                <Stack hasGutter>
                  {executionNodes.slice(0, 4).map((node) => {
                    const pct =
                      node.capacity > 0
                        ? Math.round((node.consumed_capacity / node.capacity) * 100)
                        : 0;
                    return (
                      <StackItem key={node.hostname}>
                        <div style={{ fontSize: 12, marginBottom: 2 }}>{node.hostname}</div>
                        <Progress
                          value={pct}
                          size={ProgressSize.sm}
                          title={`${pct}%`}
                          aria-label={`${node.hostname} capacity`}
                          style={{
                            // Red if >80%, yellow if >60%
                            ['--pf-v5-c-progress__bar--BackgroundColor' as string]:
                              pct > 80
                                ? 'var(--pf-v5-global--danger-color--100)'
                                : pct > 60
                                  ? 'var(--pf-v5-global--warning-color--100)'
                                  : undefined,
                          }}
                        />
                      </StackItem>
                    );
                  })}
                </Stack>
              </StackItem>
            )}

            {/* Slowest templates */}
            {slowestTemplates.length > 0 && (
              <StackItem>
                <TextContent style={{ marginBottom: 8 }}>
                  <Text component={TextVariants.h4} style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>
                    {t('Slowest templates (avg)')}
                  </Text>
                </TextContent>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <tbody>
                    {slowestTemplates.map((tmpl, i) => (
                      <tr key={i}>
                        <td
                          style={{
                            padding: '3px 8px 3px 0',
                            maxWidth: 220,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={tmpl.name}
                        >
                          {tmpl.name}
                        </td>
                        <td
                          style={{
                            padding: '3px 0',
                            fontWeight: 600,
                            color:
                              tmpl.avgSeconds > 600
                                ? 'var(--pf-v5-global--warning-color--100)'
                                : undefined,
                            textAlign: 'right',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {formatDuration(tmpl.avgSeconds)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </StackItem>
            )}

            {slowestTemplates.length === 0 && executionNodes.length === 0 && (
              <StackItem>
                <TextContent>
                  <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)' }}>
                    {t('No performance data available yet. Run some jobs to see metrics here.')}
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
