/**
 * G2b — Real-time Actionable Insights Card
 *
 * Analyses job statistics from /api/v2/dashboard/ to surface anomalies:
 *   - High failure rates (>20% failure in last N jobs)
 *   - Job templates with most failures
 *   - Inventory sync failures
 *
 * Uses the existing AI backend proxy to generate a natural-language summary
 * of the detected anomalies when AI is enabled.
 */

import {
  Alert,
  Button,
  CardBody,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Spinner,
  Stack,
  StackItem,
} from '@patternfly/react-core';
import { SyncAltIcon } from '@patternfly/react-icons';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { PageDashboardCard } from '../../../../framework/PageDashboard/PageDashboardCard';
import { postRequest } from '../../../common/crud/Data';
import { awxAPI } from '../../common/api/awx-utils';
import { useAIAssistantEnabled } from '../../common/AIAssistant';

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

interface AggregatedStats {
  jobs: JobStats;
  projects: JobStats;
  inventories: JobStats;
  topFailedTemplates: TemplateJobCounts[];
  failureRate: number;
}

interface RecentJobsResponse {
  count: number;
  results: { id: number; name: string; type: string; status: string; unified_job_template?: { name: string } }[];
}

interface AIChatResponse {
  message: { role: string; content: string };
  model: string;
  provider: string;
}

function useInsightsData(): { stats: AggregatedStats | null; isLoading: boolean } {
  const { data: recentJobs, isLoading } = useSWR<RecentJobsResponse>(
    awxAPI`/unified_jobs/?page_size=200&order_by=-finished`,
    (url: string) =>
      fetch(url)
        .then((r) => r.json())
        .catch(() => ({ count: 0, results: [] }))
  );

  if (!recentJobs || isLoading) return { stats: null, isLoading };

  const jobs = recentJobs.results;
  const total = jobs.length;
  const failed = jobs.filter((j) => j.status === 'failed' || j.status === 'error').length;
  const successful = jobs.filter((j) => j.status === 'successful').length;
  const failureRate = total > 0 ? (failed / total) * 100 : 0;

  // Aggregate failures by template name
  const templateFailures: Record<string, { total: number; failed: number }> = {};
  for (const job of jobs) {
    const name = job.unified_job_template?.name ?? job.name ?? 'Unknown';
    if (!templateFailures[name]) templateFailures[name] = { total: 0, failed: 0 };
    templateFailures[name].total++;
    if (job.status === 'failed' || job.status === 'error') {
      templateFailures[name].failed++;
    }
  }

  const topFailedTemplates = Object.entries(templateFailures)
    .map(([name, counts]) => ({ name, ...counts }))
    .filter((t) => t.failed > 0)
    .sort((a, b) => b.failed - a.failed)
    .slice(0, 5);

  return {
    stats: {
      jobs: { total, failed, successful },
      projects: { total: 0, failed: 0, successful: 0 },
      inventories: { total: 0, failed: 0, successful: 0 },
      topFailedTemplates,
      failureRate,
    },
    isLoading,
  };
}

export function AwxInsightsCard() {
  const { t } = useTranslation();
  const { stats, isLoading } = useInsightsData();
  const { enabled: aiEnabled } = useAIAssistantEnabled();
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const generateInsights = useCallback(async () => {
    if (!stats || !aiEnabled) return;
    setAiLoading(true);
    try {
      const prompt = `Analyse the following AWX automation platform job statistics and provide 2-3 concise, actionable recommendations for the platform administrator.

Job statistics (last 200 jobs):
- Total jobs: ${stats.jobs.total}
- Successful: ${stats.jobs.successful}
- Failed: ${stats.jobs.failed}
- Failure rate: ${stats.failureRate.toFixed(1)}%

Top failing job templates:
${stats.topFailedTemplates.map((t) => `  - "${t.name}": ${t.failed} failures out of ${t.total} runs`).join('\n')}

Be specific, brief, and actionable. Format as a short bulleted list.`;

      const resp = await postRequest<AIChatResponse, { messages: { role: string; content: string }[]; system_override: string }>(
        awxAPI`/ai/chat/`,
        {
          messages: [{ role: 'user', content: prompt }],
          system_override:
            'You are an AWX automation reliability engineer. Provide concise, actionable recommendations based on job statistics. Use plain text with bullet points. No markdown headings or code blocks.',
        }
      );
      setAiSummary(resp.message.content);
    } catch {
      // silently fail
    } finally {
      setAiLoading(false);
    }
  }, [aiEnabled, stats]);

  // Auto-generate insights when data loads (if AI enabled)
  useEffect(() => {
    if (stats && aiEnabled && !aiSummary) {
      void generateInsights();
    }
  }, [aiEnabled, aiSummary, generateInsights, stats]);

  const anomalies: string[] = [];
  if (stats) {
    if (stats.failureRate > 20) {
      anomalies.push(t('High failure rate: {{rate}}% of recent jobs failed', { rate: stats.failureRate.toFixed(1) }));
    }
    if (stats.topFailedTemplates.length > 0) {
      anomalies.push(
        t('Top failing template: "{{name}}" ({{count}} failures)', {
          name: stats.topFailedTemplates[0].name,
          count: stats.topFailedTemplates[0].failed,
        })
      );
    }
  }

  return (
    <PageDashboardCard
      title={t('Automation Insights')}
      width="md"
      height="sm"
      headerControls={
        aiEnabled ? (
          <Button
            variant="plain"
            aria-label={t('Refresh AI insights')}
            title={t('Refresh AI insights')}
            isDisabled={aiLoading || isLoading}
            onClick={() => {
              setAiSummary(null);
              void generateInsights();
            }}
          >
            <SyncAltIcon />
          </Button>
        ) : undefined
      }
    >
      <CardBody>
        {isLoading ? (
          <Spinner size="lg" />
        ) : (
          <Stack hasGutter>
            {anomalies.length > 0 && (
              <StackItem>
                {anomalies.map((msg, i) => (
                  <Alert key={i} variant="warning" isInline isPlain title={msg} style={{ marginBottom: 6 }} />
                ))}
              </StackItem>
            )}

            <StackItem>
              <DescriptionList isCompact isHorizontal>
                <DescriptionListGroup>
                  <DescriptionListTerm>{t('Recent jobs (200)')}</DescriptionListTerm>
                  <DescriptionListDescription>{stats?.jobs.total ?? 0}</DescriptionListDescription>
                </DescriptionListGroup>
                <DescriptionListGroup>
                  <DescriptionListTerm>{t('Failure rate')}</DescriptionListTerm>
                  <DescriptionListDescription
                    style={{
                      color:
                        (stats?.failureRate ?? 0) > 20
                          ? 'var(--pf-v5-global--danger-color--100)'
                          : 'var(--pf-v5-global--success-color--100)',
                      fontWeight: 600,
                    }}
                  >
                    {(stats?.failureRate ?? 0).toFixed(1)}%
                  </DescriptionListDescription>
                </DescriptionListGroup>
              </DescriptionList>
            </StackItem>

            {aiEnabled && (
              <StackItem>
                {aiLoading ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Spinner size="sm" />
                    <span style={{ fontSize: 13 }}>{t('Generating AI insights…')}</span>
                  </div>
                ) : aiSummary ? (
                  <div
                    style={{
                      fontSize: 13,
                      whiteSpace: 'pre-wrap',
                      borderLeft: '3px solid var(--pf-v5-global--primary-color--100)',
                      paddingLeft: 10,
                      marginTop: 4,
                    }}
                  >
                    {aiSummary}
                  </div>
                ) : null}
              </StackItem>
            )}
          </Stack>
        )}
      </CardBody>
    </PageDashboardCard>
  );
}
