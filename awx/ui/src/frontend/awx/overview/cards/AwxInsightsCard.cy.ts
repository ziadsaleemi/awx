import {
  buildInsightSignals,
  formatSeconds,
  getInventoryDrift,
  getJobStatistics,
  getRecommendations,
  getRuntimeAnomalies,
} from './AwxInsightsCard';

describe('AwxInsightsCard metrics', () => {
  it('aggregates recent job failures by template', () => {
    const stats = getJobStatistics([
      {
        id: 1,
        name: 'Deploy',
        type: 'job',
        status: 'successful',
        unified_job_template: { name: 'Apache deploy' },
      },
      {
        id: 2,
        name: 'Deploy',
        type: 'job',
        status: 'failed',
        unified_job_template: { name: 'Apache deploy' },
      },
      {
        id: 3,
        name: 'Provision',
        type: 'job',
        status: 'error',
        unified_job_template: { name: 'VM provision' },
      },
    ]);

    expect(stats.jobs).to.deep.equal({ total: 3, failed: 2, successful: 1 });
    expect(stats.failureRate).to.equal((2 / 3) * 100);
    expect(stats.topFailedTemplates).to.deep.equal([
      { name: 'Apache deploy', total: 2, failed: 1 },
      { name: 'VM provision', total: 1, failed: 1 },
    ]);
  });

  it('detects execution-time anomalies against the runtime baseline', () => {
    const anomalies = getRuntimeAnomalies([
      {
        id: 1,
        name: 'Fast 1',
        type: 'job',
        status: 'successful',
        elapsed: 60,
        finished: '2026-06-01T12:00:00Z',
      },
      {
        id: 2,
        name: 'Fast 2',
        type: 'job',
        status: 'successful',
        elapsed: 65,
        finished: '2026-06-01T11:00:00Z',
      },
      {
        id: 3,
        name: 'Slow',
        type: 'job',
        status: 'successful',
        elapsed: 600,
        finished: '2026-06-01T10:00:00Z',
        unified_job_template: { name: 'Slow deploy' },
      },
    ]);

    expect(anomalies).to.have.length(1);
    expect(anomalies[0].name).to.equal('Slow deploy');
    expect(anomalies[0].elapsed).to.equal(600);
    expect(formatSeconds(anomalies[0].elapsed)).to.equal('10m');
  });

  it('detects inventory drift from failed, stale, and active-failure sources', () => {
    const drift = getInventoryDrift(
      [
        {
          name: 'Prod inventory',
          inventory_sources_with_failures: 1,
          total_hosts: 20,
          total_inventory_sources: 2,
        },
      ],
      [
        {
          name: 'Azure prod',
          source: 'azure_rm',
          status: 'successful',
          last_updated: '2026-05-20T12:00:00Z',
          summary_fields: {
            inventory: {
              name: 'Prod inventory',
              hosts_with_active_failures: 3,
              total_hosts: 20,
            },
          },
        },
        {
          name: 'Broken source',
          source: 'ec2',
          status: 'failed',
          last_update_failed: true,
        },
      ],
      new Date('2026-06-01T12:00:00Z')
    );

    expect(drift.map((signal) => `${signal.name}:${signal.reason}`)).to.deep.equal([
      'Broken source:inventory source update failed',
      'Prod inventory:1 source failure(s)',
      'Azure prod:dynamic inventory source is stale',
      'Prod inventory:3 host(s) have active failures',
    ]);
  });

  it('builds local signals and recommendations without AI calls', () => {
    const stats = {
      jobs: { total: 10, failed: 4, successful: 6 },
      projects: { total: 1, failed: 0, successful: 1 },
      inventories: { total: 1, sourceFailures: 1, staleSources: 0, hostsWithFailures: 0 },
      failureRate: 40,
      topFailedTemplates: [{ name: 'Apache deploy', total: 5, failed: 4 }],
      runtimeAnomalies: [
        { name: 'Apache deploy', elapsed: 700, baseline: 100, status: 'successful' },
      ],
      inventoryDrift: [
        { name: 'Prod inventory', reason: '1 source failure(s)', severity: 'danger' as const },
      ],
      recommendations: [],
      signals: [],
    };

    const recommendations = getRecommendations(stats);
    const signals = buildInsightSignals({ ...stats, recommendations, signals: [] });

    expect(recommendations).to.deep.equal([
      'Pause noncritical launches and triage the current failure spike.',
      'Inspect "Apache deploy" before the next run.',
      'Review runtime growth for "Apache deploy" and recent task output.',
      'Sync or repair "Prod inventory" to clear inventory drift.',
    ]);
    expect(signals.map((signal) => signal.title)).to.deep.equal([
      'High failure rate: 40.0% of recent jobs failed',
      'Top failing template: "Apache deploy" (4 failures)',
      'Runtime anomaly: "Apache deploy" ran 11m 40s',
      'Inventory drift: Prod inventory - 1 source failure(s)',
    ]);
  });
});
