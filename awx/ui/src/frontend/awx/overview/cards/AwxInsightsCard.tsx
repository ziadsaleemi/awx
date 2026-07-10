/**
 * G2b - Real-time Actionable Insights Card
 *
 * Surfaces live reliability signals from automation data:
 *  - recent job failure rate and top failing templates
 *  - execution-time anomalies against recent runtime baseline
 *  - inventory drift from failed/stale inventory sources and active host failures
 *  - deterministic recommendations, with optional manual AI summary
 */

import { Alert, Button, CardBody, Spinner } from '@patternfly/react-core';
import { SyncAltIcon } from '@patternfly/react-icons';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { PageDashboardCard } from '../../../../framework/PageDashboard/PageDashboardCard';
import { postRequest } from '../../../common/crud/Data';
import { awxAPI } from '../../common/api/awx-utils';
import { useAIAssistantEnabled } from '../../common/AIAssistant';
import {
  OverviewCenteredSpinner,
  OverviewMetricGrid,
  OverviewMetricTile,
  OverviewRow,
  OverviewRows,
  OverviewSection,
  overviewCardBodyStyle,
} from './OverviewCardStyles';

interface JobStats {
  total: number;
  failed: number;
  successful: number;
}

interface TemplateJobCounts {
  name: string;
  total: number;
  failed: number;
}

interface UnifiedJob {
  id: number;
  name: string;
  type: string;
  status: string;
  elapsed?: number;
  finished?: string;
  modified?: string;
  created?: string;
  unified_job_template?: { name: string };
}

interface ProjectSummary {
  name: string;
  status?: string;
  last_job_failed?: boolean;
  last_update_failed?: boolean;
  last_updated?: string;
}

interface InventorySummary {
  name: string;
  has_inventory_sources?: boolean;
  inventory_sources_with_failures?: number;
  pending_deletion?: boolean;
  total_hosts?: number;
  total_inventory_sources?: number;
}

interface InventorySourceSummary {
  name: string;
  source?: string;
  status?: string;
  last_job_failed?: boolean;
  last_update_failed?: boolean;
  last_updated?: string;
  update_on_launch?: boolean;
  summary_fields?: {
    inventory?: {
      name: string;
      hosts_with_active_failures?: number;
      total_hosts?: number;
    };
  };
}

interface ListResponse<T> {
  count: number;
  results: T[];
}

interface RuntimeAnomaly {
  name: string;
  elapsed: number;
  baseline: number;
  status: string;
}

interface InventoryDriftSignal {
  name: string;
  reason: string;
  severity: 'danger' | 'warning' | 'info';
}

interface InsightSignal {
  title: string;
  severity: 'danger' | 'warning' | 'info';
}

interface AggregatedStats {
  jobs: JobStats;
  projects: JobStats;
  inventories: {
    total: number;
    sourceFailures: number;
    staleSources: number;
    hostsWithFailures: number;
  };
  topFailedTemplates: TemplateJobCounts[];
  runtimeAnomalies: RuntimeAnomaly[];
  inventoryDrift: InventoryDriftSignal[];
  recommendations: string[];
  signals: InsightSignal[];
  failureRate: number;
}

interface AIChatResponse {
  message: { role: string; content: string };
  model: string;
  provider: string;
}

const refreshInterval = 30_000;
const staleInventorySourceMs = 7 * 24 * 60 * 60 * 1000;
const failedStatuses = new Set(['failed', 'error']);
const unhealthyStatuses = new Set(['failed', 'error', 'missing']);

async function fetchJson<T>(url: string): Promise<ListResponse<T>> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return (await response.json()) as ListResponse<T>;
}

export function getListResults<T>(data?: Partial<ListResponse<T>> | null): T[] {
  return Array.isArray(data?.results) ? data.results : [];
}

function getDateValue(value?: string) {
  if (!value) return undefined;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : undefined;
}

function getJobTime(job: UnifiedJob) {
  return getDateValue(job.finished) ?? getDateValue(job.modified) ?? getDateValue(job.created);
}

export function formatSeconds(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

export function getJobStatistics(jobs: UnifiedJob[]) {
  const total = jobs.length;
  const failed = jobs.filter((job) => failedStatuses.has(job.status)).length;
  const successful = jobs.filter((job) => job.status === 'successful').length;
  const failureRate = total > 0 ? (failed / total) * 100 : 0;
  const templateFailures: Record<string, { total: number; failed: number }> = {};

  for (const job of jobs) {
    const name = job.unified_job_template?.name ?? job.name ?? 'Unknown';
    if (!templateFailures[name]) templateFailures[name] = { total: 0, failed: 0 };
    templateFailures[name].total++;
    if (failedStatuses.has(job.status)) templateFailures[name].failed++;
  }

  const topFailedTemplates = Object.entries(templateFailures)
    .map(([name, counts]) => ({ name, ...counts }))
    .filter((template) => template.failed > 0)
    .sort((a, b) => b.failed - a.failed || b.total - a.total)
    .slice(0, 5);

  return {
    jobs: { total, failed, successful },
    failureRate,
    topFailedTemplates,
  };
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function getRuntimeAnomalies(jobs: UnifiedJob[]) {
  const completedJobs = jobs
    .filter((job) => (job.elapsed ?? 0) > 0 && Boolean(getJobTime(job)))
    .sort((a, b) => (getJobTime(b) ?? 0) - (getJobTime(a) ?? 0));
  const runtimes = completedJobs.map((job) => job.elapsed ?? 0);
  const runtimeMedian = median(runtimes);
  const runtimeAverage =
    runtimes.length > 0 ? runtimes.reduce((sum, elapsed) => sum + elapsed, 0) / runtimes.length : 0;
  const baseline = Math.max(runtimeMedian, runtimeAverage, 1);
  const anomalyFloor = Math.max(baseline * 2, 60);

  return completedJobs
    .filter((job) => (job.elapsed ?? 0) >= anomalyFloor)
    .map((job) => ({
      name: job.unified_job_template?.name ?? job.name ?? 'Unknown',
      elapsed: job.elapsed ?? 0,
      baseline,
      status: job.status,
    }))
    .sort((a, b) => b.elapsed - a.elapsed)
    .slice(0, 3);
}

export function getInventoryDrift(
  inventories: InventorySummary[],
  inventorySources: InventorySourceSummary[],
  now: Date
) {
  const drift: InventoryDriftSignal[] = [];

  for (const source of inventorySources) {
    if (
      source.last_job_failed ||
      source.last_update_failed ||
      unhealthyStatuses.has(source.status ?? '')
    ) {
      drift.push({
        name: source.name,
        reason: 'inventory source update failed',
        severity: 'danger',
      });
      continue;
    }

    const lastUpdated = getDateValue(source.last_updated);
    if (
      source.source &&
      source.source !== 'file' &&
      source.source !== 'scm' &&
      (!lastUpdated || now.getTime() - lastUpdated > staleInventorySourceMs)
    ) {
      drift.push({
        name: source.name,
        reason: 'dynamic inventory source is stale',
        severity: 'warning',
      });
    }
  }

  for (const inventory of inventories) {
    if ((inventory.inventory_sources_with_failures ?? 0) > 0) {
      drift.push({
        name: inventory.name,
        reason: `${inventory.inventory_sources_with_failures ?? 0} source failure(s)`,
        severity: 'danger',
      });
    }
    if (inventory.pending_deletion) {
      drift.push({
        name: inventory.name,
        reason: 'inventory pending deletion',
        severity: 'warning',
      });
    }
  }

  const activeHostFailures = new Map<string, number>();
  for (const source of inventorySources) {
    const inventory = source.summary_fields?.inventory;
    if (!inventory || !inventory.hosts_with_active_failures) continue;
    activeHostFailures.set(
      inventory.name,
      Math.max(activeHostFailures.get(inventory.name) ?? 0, inventory.hosts_with_active_failures)
    );
  }

  for (const [name, failures] of activeHostFailures) {
    drift.push({
      name,
      reason: `${failures} host(s) have active failures`,
      severity: 'warning',
    });
  }

  return drift
    .sort((a, b) => {
      const severityOrder = { danger: 0, warning: 1, info: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity] || a.name.localeCompare(b.name);
    })
    .slice(0, 5);
}

export function getRecommendations(stats: {
  failureRate: number;
  projectFailureCount?: number;
  topFailedTemplates: TemplateJobCounts[];
  runtimeAnomalies: RuntimeAnomaly[];
  inventoryDrift: InventoryDriftSignal[];
}) {
  const recommendations: string[] = [];

  if (stats.failureRate > 20) {
    recommendations.push('Pause noncritical launches and triage the current failure spike.');
  }
  if (stats.topFailedTemplates.length > 0) {
    recommendations.push(`Inspect "${stats.topFailedTemplates[0].name}" before the next run.`);
  }
  if ((stats.projectFailureCount ?? 0) > 0) {
    recommendations.push('Sync failed or missing projects before dependent launches.');
  }
  if (stats.runtimeAnomalies.length > 0) {
    recommendations.push(
      `Review runtime growth for "${stats.runtimeAnomalies[0].name}" and recent task output.`
    );
  }
  if (stats.inventoryDrift.length > 0) {
    recommendations.push(
      `Sync or repair "${stats.inventoryDrift[0].name}" to clear inventory drift.`
    );
  }

  return recommendations.slice(0, 4);
}

export function buildInsightSignals(stats: AggregatedStats) {
  const signals: InsightSignal[] = [];

  if (stats.failureRate > 20) {
    signals.push({
      severity: 'warning',
      title: `High failure rate: ${stats.failureRate.toFixed(1)}% of recent jobs failed`,
    });
  }
  if (stats.topFailedTemplates.length > 0) {
    signals.push({
      severity: 'warning',
      title: `Top failing template: "${stats.topFailedTemplates[0].name}" (${stats.topFailedTemplates[0].failed} failures)`,
    });
  }
  if (stats.projects.failed > 0) {
    signals.push({
      severity: 'warning',
      title: `Project sync issues: ${stats.projects.failed} project(s) unhealthy`,
    });
  }
  if (stats.runtimeAnomalies.length > 0) {
    signals.push({
      severity: 'warning',
      title: `Runtime anomaly: "${stats.runtimeAnomalies[0].name}" ran ${formatSeconds(
        stats.runtimeAnomalies[0].elapsed
      )}`,
    });
  }
  if (stats.inventoryDrift.length > 0) {
    signals.push({
      severity: stats.inventoryDrift[0].severity,
      title: `Inventory drift: ${stats.inventoryDrift[0].name} - ${stats.inventoryDrift[0].reason}`,
    });
  }

  return signals;
}

function useInsightsData(): {
  stats: AggregatedStats | null;
  isLoading: boolean;
  hasError: boolean;
} {
  const swrOptions = { refreshInterval };
  const recentJobsState = useSWR<ListResponse<UnifiedJob>>(
    awxAPI`/unified_jobs/?page_size=200&order_by=-finished`,
    fetchJson,
    swrOptions
  );
  const projectsState = useSWR<ListResponse<ProjectSummary>>(
    awxAPI`/projects/?page_size=100&order_by=-modified`,
    fetchJson,
    swrOptions
  );
  const inventoriesState = useSWR<ListResponse<InventorySummary>>(
    awxAPI`/inventories/?page_size=100&order_by=-modified`,
    fetchJson,
    swrOptions
  );
  const inventorySourcesState = useSWR<ListResponse<InventorySourceSummary>>(
    awxAPI`/inventory_sources/?page_size=100&order_by=-modified`,
    fetchJson,
    swrOptions
  );

  const recentJobs = recentJobsState.data;
  const projects = projectsState.data;
  const inventories = inventoriesState.data;
  const inventorySources = inventorySourcesState.data;
  const isLoading =
    recentJobsState.isLoading ||
    projectsState.isLoading ||
    inventoriesState.isLoading ||
    inventorySourcesState.isLoading;
  const hasError = Boolean(
    recentJobsState.error ||
      projectsState.error ||
      inventoriesState.error ||
      inventorySourcesState.error
  );

  const stats = useMemo<AggregatedStats | null>(() => {
    if (!recentJobs || !projects || !inventories || !inventorySources || isLoading || hasError) {
      return null;
    }

    const recentJobResults = getListResults(recentJobs);
    const projectResults = getListResults(projects);
    const inventoryResults = getListResults(inventories);
    const inventorySourceResults = getListResults(inventorySources);
    const jobStatistics = getJobStatistics(recentJobResults);
    const runtimeAnomalies = getRuntimeAnomalies(recentJobResults);
    const inventoryDrift = getInventoryDrift(inventoryResults, inventorySourceResults, new Date());
    const projectFailures = projectResults.filter(
      (project) =>
        project.last_job_failed ||
        project.last_update_failed ||
        unhealthyStatuses.has(project.status ?? '')
    ).length;
    const inventorySourceFailures = inventorySourceResults.filter(
      (source) =>
        source.last_job_failed ||
        source.last_update_failed ||
        unhealthyStatuses.has(source.status ?? '')
    ).length;
    const staleSources = inventoryDrift.filter((signal) => signal.reason.includes('stale')).length;
    const hostsWithFailures = inventorySourceResults.reduce(
      (total, source) =>
        total + (source.summary_fields?.inventory?.hosts_with_active_failures ?? 0),
      0
    );

    const partialStats = {
      ...jobStatistics,
      runtimeAnomalies,
      inventoryDrift,
    };
    const aggregatedStats: AggregatedStats = {
      ...partialStats,
      projects: {
        total: projectResults.length,
        failed: projectFailures,
        successful: projectResults.filter((project) => project.status === 'successful').length,
      },
      inventories: {
        total: inventoryResults.length,
        sourceFailures: inventorySourceFailures,
        staleSources,
        hostsWithFailures,
      },
      recommendations: getRecommendations({
        ...partialStats,
        projectFailureCount: projectFailures,
      }),
      signals: [],
    };

    return {
      ...aggregatedStats,
      signals: buildInsightSignals(aggregatedStats),
    };
  }, [hasError, inventories, inventorySources, isLoading, projects, recentJobs]);

  return { stats, isLoading, hasError };
}

function getSignalAccent(severity: InsightSignal['severity']) {
  if (severity === 'danger') return 'var(--pf-v5-global--danger-color--100)';
  if (severity === 'warning') return 'var(--pf-v5-global--warning-color--100)';
  return 'var(--pf-v5-global--info-color--100)';
}

export function AwxInsightsCard() {
  const { t } = useTranslation();
  const { stats, isLoading, hasError } = useInsightsData();
  const { enabled: aiEnabled, configured: aiConfigured } = useAIAssistantEnabled();
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const aiRequestInFlight = useRef(false);

  const generateInsights = useCallback(async () => {
    if (!stats || !aiEnabled || !aiConfigured || aiRequestInFlight.current) return;
    aiRequestInFlight.current = true;
    setAiLoading(true);
    setAiError(null);
    try {
      const prompt = `Analyze the following Capstan reliability signals and provide 2-3 concise, actionable recommendations for the platform administrator.

Recent jobs:
- Total jobs: ${stats.jobs.total}
- Successful: ${stats.jobs.successful}
- Failed: ${stats.jobs.failed}
- Failure rate: ${stats.failureRate.toFixed(1)}%

Top failing job templates:
${stats.topFailedTemplates.map((template) => `  - "${template.name}": ${template.failed} failures out of ${template.total} runs`).join('\n')}

Runtime anomalies:
${stats.runtimeAnomalies.map((job) => `  - "${job.name}": ${formatSeconds(job.elapsed)} runtime, baseline ${formatSeconds(job.baseline)}`).join('\n')}

Inventory drift:
${stats.inventoryDrift.map((signal) => `  - "${signal.name}": ${signal.reason}`).join('\n')}

Current recommendations:
${stats.recommendations.map((recommendation) => `  - ${recommendation}`).join('\n')}

Be specific, brief, and actionable. Format as a short bulleted list.`;

      const resp = await postRequest<
        AIChatResponse,
        { messages: { role: string; content: string }[]; system_override: string }
      >(awxAPI`/ai/chat/`, {
        messages: [{ role: 'user', content: prompt }],
        system_override:
          'You are a Capstan reliability engineer. Provide concise, actionable recommendations based on job, project, runtime, and inventory signals. Use plain text with bullet points. No markdown headings or code blocks.',
      });
      setAiSummary(resp.message.content);
    } catch {
      setAiError(t('AI insights are temporarily unavailable.'));
    } finally {
      aiRequestInFlight.current = false;
      setAiLoading(false);
    }
  }, [aiConfigured, aiEnabled, stats, t]);

  return (
    <PageDashboardCard
      title={t('Automation Insights')}
      width="half"
      height="lg"
      maxHeight="lg"
      style={{ minWidth: 0 }}
      headerControls={
        aiEnabled && aiConfigured ? (
          <Button
            variant="plain"
            aria-label={t('Refresh AI insights')}
            title={t('Refresh AI insights')}
            isDisabled={aiLoading || isLoading}
            onClick={() => {
              setAiSummary(null);
              setAiError(null);
              void generateInsights();
            }}
          >
            <SyncAltIcon />
          </Button>
        ) : undefined
      }
    >
      <CardBody
        style={{
          ...overviewCardBodyStyle,
          overflow: 'visible',
        }}
      >
        {isLoading ? (
          <OverviewCenteredSpinner />
        ) : hasError ? (
          <Alert
            variant="warning"
            isInline
            isPlain
            title={t('Automation insights data is temporarily unavailable')}
          />
        ) : (
          <>
            <OverviewMetricGrid minWidth={130}>
              <OverviewMetricTile
                value={stats?.jobs.total ?? 0}
                label={t('Recent jobs')}
                detail={t('Last 200 jobs')}
              />
              <OverviewMetricTile
                value={`${(stats?.failureRate ?? 0).toFixed(1)}%`}
                label={t('Failure rate')}
                detail={t('{{count}} failed', { count: stats?.jobs.failed ?? 0 })}
                tone={(stats?.failureRate ?? 0) > 20 ? 'danger' : 'success'}
              />
              <OverviewMetricTile
                value={stats?.runtimeAnomalies.length ?? 0}
                label={t('Runtime anomalies')}
                detail={t('Slow outliers')}
                tone={(stats?.runtimeAnomalies.length ?? 0) > 0 ? 'warning' : 'success'}
              />
              <OverviewMetricTile
                value={stats?.inventoryDrift.length ?? 0}
                label={t('Inventory drift')}
                detail={t('Inventory signals')}
                tone={(stats?.inventoryDrift.length ?? 0) > 0 ? 'warning' : 'success'}
              />
            </OverviewMetricGrid>

            <OverviewSection title={t('Reliability signals')}>
              <OverviewRows>
                {stats?.signals.length ? (
                  stats.signals.slice(0, 4).map((signal) => (
                    <OverviewRow key={signal.title} accentColor={getSignalAccent(signal.severity)}>
                      {signal.title}
                    </OverviewRow>
                  ))
                ) : (
                  <OverviewRow accentColor="var(--pf-v5-global--success-color--100)">
                    {t('No active reliability anomalies detected')}
                  </OverviewRow>
                )}
              </OverviewRows>
            </OverviewSection>

            {!!stats?.recommendations.length && (
              <OverviewSection title={t('Recommended actions')}>
                <OverviewRows>
                  {stats.recommendations.map((recommendation) => (
                    <OverviewRow
                      key={recommendation}
                      accentColor="var(--pf-v5-global--primary-color--100)"
                    >
                      {recommendation}
                    </OverviewRow>
                  ))}
                </OverviewRows>
              </OverviewSection>
            )}

            {aiEnabled && aiConfigured && (
              <OverviewSection title={aiSummary || aiLoading || aiError ? t('AI summary') : null}>
                {aiLoading ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <Spinner size="sm" />
                    <span>{t('Generating AI insights...')}</span>
                  </div>
                ) : aiSummary ? (
                  <OverviewRow accentColor="var(--pf-v5-global--primary-color--100)">
                    <div style={{ whiteSpace: 'pre-wrap' }}>{aiSummary}</div>
                  </OverviewRow>
                ) : aiError ? (
                  <Alert variant="info" isInline isPlain title={aiError} />
                ) : null}
              </OverviewSection>
            )}
          </>
        )}
      </CardBody>
    </PageDashboardCard>
  );
}
