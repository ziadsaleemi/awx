import {
  formatDuration,
  getCapacitySummary,
  getExecutionNodes,
  getFailedHosts,
  getRuntimeTrend,
  getSlowestTemplates,
  getWindowStart,
} from './AwxPerformanceCard';

describe('AwxPerformanceCard metrics', () => {
  const now = new Date('2026-06-01T12:00:00Z');
  const start = getWindowStart(now, 'week');

  it('filters execution nodes and summarizes current capacity', () => {
    const nodes = getExecutionNodes([
      {
        hostname: 'control',
        capacity: 100,
        consumed_capacity: 90,
        enabled: true,
        node_type: 'control',
      },
      {
        hostname: 'exec-1',
        capacity: 100,
        consumed_capacity: 30,
        enabled: true,
        node_type: 'execution',
      },
      {
        hostname: 'exec-2',
        capacity: 50,
        consumed_capacity: 30,
        enabled: true,
        node_type: 'hybrid',
      },
      {
        hostname: 'disabled',
        capacity: 100,
        consumed_capacity: 100,
        enabled: false,
        node_type: 'execution',
      },
    ]);

    expect(nodes.map((node) => node.hostname)).to.deep.equal(['exec-1', 'exec-2']);
    expect(getCapacitySummary(nodes)).to.deep.equal({ capacity: 150, consumed: 60, percent: 40 });
  });

  it('computes slowest successful templates inside the selected window', () => {
    const templates = getSlowestTemplates(
      [
        {
          status: 'successful',
          elapsed: 30,
          finished: '2026-06-01T11:00:00Z',
          unified_job_template: { name: 'Fast' },
        },
        {
          status: 'successful',
          elapsed: 120,
          finished: '2026-06-01T10:00:00Z',
          unified_job_template: { name: 'Slow' },
        },
        {
          status: 'failed',
          elapsed: 999,
          finished: '2026-06-01T09:00:00Z',
          unified_job_template: { name: 'Failed' },
        },
        {
          status: 'successful',
          elapsed: 1000,
          finished: '2026-05-01T09:00:00Z',
          unified_job_template: { name: 'Old' },
        },
      ],
      start,
      now
    );

    expect(templates).to.deep.equal([
      { name: 'Slow', avgSeconds: 120 },
      { name: 'Fast', avgSeconds: 30 },
    ]);
  });

  it('computes most failed hosts from failed job events inside the selected window', () => {
    const hosts = getFailedHosts(
      [
        {
          event: 'runner_on_failed',
          failed: true,
          host_name: 'web-1',
          created: '2026-06-01T11:00:00Z',
        },
        {
          event: 'runner_on_unreachable',
          failed: false,
          event_data: { host: 'web-1' },
          created: '2026-06-01T10:00:00Z',
        },
        {
          event: 'runner_on_failed',
          failed: true,
          host_name: 'db-1',
          created: '2026-06-01T09:00:00Z',
        },
        {
          event: 'runner_on_failed',
          failed: true,
          host_name: 'old-host',
          created: '2026-05-01T09:00:00Z',
        },
      ],
      start,
      now
    );

    expect(hosts.map((host) => ({ host: host.host, failures: host.failures }))).to.deep.equal([
      { host: 'web-1', failures: 2 },
      { host: 'db-1', failures: 1 },
    ]);
  });

  it('builds runtime trend buckets and direction', () => {
    const trend = getRuntimeTrend(
      [
        { status: 'successful', elapsed: 60, finished: '2026-05-26T12:00:00Z' },
        { status: 'successful', elapsed: 60, finished: '2026-05-28T12:00:00Z' },
        { status: 'successful', elapsed: 300, finished: '2026-06-01T10:00:00Z' },
      ],
      'week',
      now
    );

    expect(trend.buckets).to.have.length(6);
    expect(trend.totalElapsed).to.equal(420);
    expect(trend.direction).to.equal('up');
    expect(formatDuration(trend.totalElapsed)).to.equal('7m');
  });
});
