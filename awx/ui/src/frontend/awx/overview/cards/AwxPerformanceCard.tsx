/**
 * G2c — Performance Metrics Panel
 *
 * Shows:
 *  - Slowest job templates (avg execution time)
 *  - Most failed hosts (from recent job events)
 *  - Current capacity and execution-load trend over a selected time window
 */

import { CardBody, Progress, ProgressSize } from '@patternfly/react-core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { PageDashboardCard } from '../../../../framework/PageDashboard/PageDashboardCard';
import { PageSingleSelect } from '../../../../framework/PageInputs/PageSingleSelect';
import { useGetPageUrl } from '../../../../framework/PageNavigation/useGetPageUrl';
import { awxAPI } from '../../common/api/awx-utils';
import { AwxRoute } from '../../main/AwxRoutes';
import {
  OverviewCenteredSpinner,
  OverviewMetricGrid,
  OverviewMetricTile,
  OverviewRow,
  OverviewRows,
  OverviewSection,
  OverviewTwoColumnGrid,
  overviewCardBodyStyle,
  overviewMutedTextStyle,
} from './OverviewCardStyles';

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
  id?: number;
  type?: string;
  unified_job_template?: { name: string };
  name?: string;
  elapsed?: number;
  status: string;
  created?: string;
  finished?: string;
  modified?: string;
  related?: {
    job_events?: string;
  };
}

interface UnifiedJobsResponse {
  count: number;
  results: UnifiedJob[];
}

interface JobEvent {
  event?: string;
  failed?: boolean;
  host_name?: string;
  created?: string;
  event_data?: {
    host?: string;
  };
}

interface JobEventsResponse {
  count: number;
  results: JobEvent[];
}

export type PerformanceWindow = 'day' | 'week' | 'month';

const windowMs: Record<PerformanceWindow, number> = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
};

const failedHostEvents = new Set([
  'runner_on_failed',
  'runner_on_error',
  'runner_on_unreachable',
  'runner_item_on_failed',
  'runner_on_async_failed',
]);

export function getWindowStart(now: Date, timeWindow: PerformanceWindow) {
  return new Date(now.getTime() - windowMs[timeWindow]);
}

function getDateValue(value?: string) {
  if (!value) return undefined;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : undefined;
}

function getJobTime(job: UnifiedJob) {
  return getDateValue(job.finished) ?? getDateValue(job.modified) ?? getDateValue(job.created);
}

function isInWindow(time: number | undefined, start: Date, now: Date) {
  return time !== undefined && time >= start.getTime() && time <= now.getTime();
}

export function getExecutionNodes(instances: Instance[] = []) {
  return instances.filter(
    (node) => node.enabled && (node.node_type === 'execution' || node.node_type === 'hybrid')
  );
}

export function getCapacitySummary(nodes: Instance[]) {
  const capacity = nodes.reduce((total, node) => total + (node.capacity || 0), 0);
  const consumed = nodes.reduce((total, node) => total + (node.consumed_capacity || 0), 0);
  const percent = capacity > 0 ? Math.round((consumed / capacity) * 100) : 0;
  return { capacity, consumed, percent };
}

export function getSlowestTemplates(jobs: UnifiedJob[], start: Date, now: Date) {
  const templateAvgTimes: Record<string, { totalElapsed: number; count: number }> = {};

  for (const job of jobs) {
    if (job.status !== 'successful' || !isInWindow(getJobTime(job), start, now)) continue;
    const elapsed = job.elapsed ?? 0;
    if (elapsed <= 0) continue;
    const name = job.unified_job_template?.name ?? job.name ?? 'Unknown';
    if (!templateAvgTimes[name]) templateAvgTimes[name] = { totalElapsed: 0, count: 0 };
    templateAvgTimes[name].totalElapsed += elapsed;
    templateAvgTimes[name].count++;
  }

  return Object.entries(templateAvgTimes)
    .map(([name, data]) => ({ name, avgSeconds: data.totalElapsed / data.count }))
    .sort((a, b) => b.avgSeconds - a.avgSeconds)
    .slice(0, 5);
}

function getEventTime(event: JobEvent) {
  return getDateValue(event.created);
}

function getEventHost(event: JobEvent) {
  return event.host_name || event.event_data?.host;
}

export function getFailedHosts(events: JobEvent[], start: Date, now: Date) {
  const hostFailures: Record<string, { failures: number; lastSeen?: number }> = {};

  for (const event of events) {
    if (!event.failed && !failedHostEvents.has(event.event ?? '')) continue;
    const time = getEventTime(event);
    if (!isInWindow(time, start, now)) continue;
    const host = getEventHost(event);
    if (!host) continue;
    if (!hostFailures[host]) hostFailures[host] = { failures: 0 };
    hostFailures[host].failures++;
    hostFailures[host].lastSeen = Math.max(hostFailures[host].lastSeen ?? 0, time ?? 0);
  }

  return Object.entries(hostFailures)
    .map(([host, data]) => ({ host, ...data }))
    .sort((a, b) => b.failures - a.failures || (b.lastSeen ?? 0) - (a.lastSeen ?? 0))
    .slice(0, 5);
}

export function getRuntimeTrend(jobs: UnifiedJob[], timeWindow: PerformanceWindow, now: Date) {
  const start = getWindowStart(now, timeWindow);
  const bucketCount = 6;
  const bucketSize = windowMs[timeWindow] / bucketCount;
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    start: new Date(start.getTime() + bucketSize * index),
    end: new Date(start.getTime() + bucketSize * (index + 1)),
    totalElapsed: 0,
    jobCount: 0,
  }));

  for (const job of jobs) {
    const time = getJobTime(job);
    if (!isInWindow(time, start, now)) continue;
    const elapsed = job.elapsed ?? 0;
    const index = Math.min(
      bucketCount - 1,
      Math.max(0, Math.floor(((time as number) - start.getTime()) / bucketSize))
    );
    buckets[index].totalElapsed += elapsed > 0 ? elapsed : 0;
    buckets[index].jobCount++;
  }

  const firstHalf = buckets
    .slice(0, bucketCount / 2)
    .reduce((sum, bucket) => sum + bucket.totalElapsed, 0);
  const secondHalf = buckets
    .slice(bucketCount / 2)
    .reduce((sum, bucket) => sum + bucket.totalElapsed, 0);
  const percentChange =
    firstHalf > 0
      ? Math.round(((secondHalf - firstHalf) / firstHalf) * 100)
      : secondHalf > 0
        ? 100
        : 0;
  const direction = percentChange > 10 ? 'up' : percentChange < -10 ? 'down' : 'flat';

  return { buckets, direction, percentChange, totalElapsed: firstHalf + secondHalf };
}

function addQueryParams(url: string, params: Record<string, string>) {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${new URLSearchParams(params).toString()}`;
}

async function fetchFailedJobEvents(urls: string[]) {
  const responses = await Promise.all(
    urls.map((url) =>
      fetch(addQueryParams(url, { page_size: '200', order_by: '-created' }))
        .then((r) => (r.ok ? r.json() : { count: 0, results: [] }))
        .catch(() => ({ count: 0, results: [] }))
    )
  );
  return responses.flatMap((response: JobEventsResponse) => response.results ?? []);
}

function usePerformanceData(timeWindow: PerformanceWindow) {
  const now = new Date();
  const windowStart = getWindowStart(now, timeWindow);

  const { data: instances, isLoading: instLoading } = useSWR<InstancesResponse>(
    awxAPI`/instances/?page_size=50`,
    (url: string) =>
      fetch(url)
        .then((r) => r.json())
        .catch(() => ({ count: 0, results: [] }))
  );

  const { data: recentJobs, isLoading: jobsLoading } = useSWR<UnifiedJobsResponse>(
    awxAPI`/unified_jobs/?page_size=200&order_by=-finished`,
    (url: string) =>
      fetch(url)
        .then((r) => r.json())
        .catch(() => ({ count: 0, results: [] }))
  );

  const jobs = recentJobs?.results ?? [];
  const failedEventUrls = jobs
    .filter((job) => job.status === 'failed' || job.status === 'error')
    .map((job) => job.related?.job_events)
    .filter((url): url is string => Boolean(url))
    .slice(0, 8);
  const failedEventsKey = failedEventUrls.length ? failedEventUrls.join('\n') : null;

  const { data: failedEvents = [], isLoading: eventsLoading } = useSWR<JobEvent[]>(
    failedEventsKey,
    (key: string) => fetchFailedJobEvents(key.split('\n').filter(Boolean))
  );

  const executionNodes = getExecutionNodes(instances?.results ?? []);

  return {
    capacitySummary: getCapacitySummary(executionNodes),
    executionNodes,
    failedHosts: getFailedHosts(failedEvents, windowStart, now),
    runtimeTrend: getRuntimeTrend(jobs, timeWindow, now),
    slowestTemplates: getSlowestTemplates(jobs, windowStart, now),
    isLoading: instLoading || jobsLoading || eventsLoading,
  };
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function formatBucketLabel(date: Date, timeWindow: PerformanceWindow) {
  if (timeWindow === 'day') {
    return date.toLocaleTimeString(undefined, { hour: 'numeric' });
  }
  return date.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
}

export function AwxPerformanceCard() {
  const { t } = useTranslation();
  const [timeWindow, setTimeWindow] = useState<PerformanceWindow | null>('week');
  const activeWindow = timeWindow ?? 'week';
  const {
    capacitySummary,
    executionNodes,
    failedHosts,
    runtimeTrend,
    slowestTemplates,
    isLoading,
  } = usePerformanceData(activeWindow);
  const getPageUrl = useGetPageUrl();

  const trendSummary =
    runtimeTrend.direction === 'up'
      ? t('Up {{change}}% vs earlier in this window', { change: runtimeTrend.percentChange })
      : runtimeTrend.direction === 'down'
        ? t('Down {{change}}% vs earlier in this window', {
            change: Math.abs(runtimeTrend.percentChange),
          })
        : t('Flat vs earlier in this window');
  const capacityTone =
    capacitySummary.percent > 80 ? 'danger' : capacitySummary.percent > 60 ? 'warning' : 'success';
  const trendTone =
    runtimeTrend.direction === 'up'
      ? 'warning'
      : runtimeTrend.direction === 'down'
        ? 'success'
        : 'default';

  return (
    <PageDashboardCard
      title={t('Performance Metrics')}
      linkText={t('View instances')}
      to={getPageUrl(AwxRoute.Instances)}
      width="full"
      height="lg"
      headerControls={
        <PageSingleSelect<PerformanceWindow>
          placeholder={t('Select window')}
          value={timeWindow}
          onSelect={setTimeWindow}
          options={[
            { label: t('Past 24 hours'), value: 'day' },
            { label: t('Past week'), value: 'week' },
            { label: t('Past month'), value: 'month' },
          ]}
          isRequired
        />
      }
    >
      <CardBody style={overviewCardBodyStyle}>
        {isLoading ? (
          <OverviewCenteredSpinner />
        ) : (
          <>
            <OverviewMetricGrid minWidth={170}>
              <OverviewMetricTile
                value={`${capacitySummary.percent}%`}
                label={t('Capacity used')}
                detail={t('{{used}} of {{total}} consumed', {
                  used: capacitySummary.consumed.toLocaleString(),
                  total: capacitySummary.capacity.toLocaleString(),
                })}
                tone={capacityTone}
              />
              <OverviewMetricTile
                value={executionNodes.length.toLocaleString()}
                label={t('Execution nodes')}
                detail={t('Enabled execution or hybrid nodes')}
              />
              <OverviewMetricTile
                value={formatDuration(runtimeTrend.totalElapsed)}
                label={t('Execution load')}
                detail={trendSummary}
                tone={trendTone}
              />
              <OverviewMetricTile
                value={failedHosts.length.toLocaleString()}
                label={t('Failed hosts')}
                detail={t('Recent host failure signals')}
                tone={failedHosts.length > 0 ? 'warning' : 'success'}
              />
            </OverviewMetricGrid>

            <OverviewTwoColumnGrid>
              <OverviewSection title={t('Execution node capacity')}>
                {executionNodes.length > 0 ? (
                  <OverviewRows>
                    {executionNodes.slice(0, 5).map((node) => {
                      const pct =
                        node.capacity > 0
                          ? Math.round((node.consumed_capacity / node.capacity) * 100)
                          : 0;
                      return (
                        <OverviewRow key={node.hostname} right={`${pct}%`}>
                          <div style={{ fontSize: 12, fontWeight: 600 }}>{node.hostname}</div>
                          <Progress
                            value={pct}
                            size={ProgressSize.sm}
                            title={`${pct}%`}
                            aria-label={`${node.hostname} capacity`}
                            style={{
                              marginTop: 6,
                              ['--pf-v5-c-progress__bar--BackgroundColor' as string]:
                                pct > 80
                                  ? 'var(--pf-v5-global--danger-color--100)'
                                  : pct > 60
                                    ? 'var(--pf-v5-global--warning-color--100)'
                                    : undefined,
                            }}
                          />
                        </OverviewRow>
                      );
                    })}
                  </OverviewRows>
                ) : (
                  <div style={{ ...overviewMutedTextStyle, fontSize: 13 }}>
                    {t('No enabled execution nodes found.')}
                  </div>
                )}
              </OverviewSection>

              <OverviewSection title={t('Execution load trend')}>
                {runtimeTrend.totalElapsed > 0 ? (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: `repeat(${runtimeTrend.buckets.length}, minmax(0, 1fr))`,
                      gap: 8,
                      alignItems: 'end',
                      minHeight: 126,
                    }}
                  >
                    {runtimeTrend.buckets.map((bucket) => {
                      const maxElapsed = Math.max(
                        ...runtimeTrend.buckets.map((trendBucket) => trendBucket.totalElapsed),
                        1
                      );
                      const pct = Math.max(6, Math.round((bucket.totalElapsed / maxElapsed) * 100));
                      return (
                        <div
                          key={bucket.start.toISOString()}
                          style={{
                            display: 'grid',
                            gap: 6,
                            alignItems: 'end',
                            minWidth: 0,
                          }}
                        >
                          <div
                            title={`${formatDuration(bucket.totalElapsed)} / ${bucket.jobCount} jobs`}
                            style={{
                              height: `${pct}px`,
                              minHeight: 6,
                              background: 'var(--pf-v5-global--primary-color--100)',
                            }}
                          />
                          <div
                            style={{
                              ...overviewMutedTextStyle,
                              fontSize: 11,
                              textAlign: 'center',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {formatBucketLabel(bucket.start, activeWindow)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ ...overviewMutedTextStyle, fontSize: 13 }}>
                    {t('No execution load in this window.')}
                  </div>
                )}
              </OverviewSection>
            </OverviewTwoColumnGrid>

            <OverviewTwoColumnGrid>
              <OverviewSection title={t('Slowest templates (avg)')}>
                {slowestTemplates.length > 0 ? (
                  <OverviewRows>
                    {slowestTemplates.map((tmpl) => (
                      <OverviewRow key={tmpl.name} right={formatDuration(tmpl.avgSeconds)}>
                        {tmpl.name}
                      </OverviewRow>
                    ))}
                  </OverviewRows>
                ) : (
                  <div style={{ ...overviewMutedTextStyle, fontSize: 13 }}>
                    {t('No successful template runtime data in this window.')}
                  </div>
                )}
              </OverviewSection>

              <OverviewSection title={t('Most failed hosts')}>
                {failedHosts.length > 0 ? (
                  <OverviewRows>
                    {failedHosts.map((host) => (
                      <OverviewRow
                        key={host.host}
                        right={t('{{count}} failures', { count: host.failures })}
                        accentColor="var(--pf-v5-global--warning-color--100)"
                      >
                        {host.host}
                      </OverviewRow>
                    ))}
                  </OverviewRows>
                ) : (
                  <div style={{ ...overviewMutedTextStyle, fontSize: 13 }}>
                    {t('No host failures in this window.')}
                  </div>
                )}
              </OverviewSection>
            </OverviewTwoColumnGrid>
          </>
        )}
      </CardBody>
    </PageDashboardCard>
  );
}
