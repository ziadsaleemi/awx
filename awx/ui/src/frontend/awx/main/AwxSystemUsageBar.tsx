import { Tooltip } from '@patternfly/react-core';
import { useTranslation } from 'react-i18next';
import { useGet } from '../../common/crud/useGet';
import { AwxItemsResponse } from '../common/AwxItemsResponse';
import { awxAPI } from '../common/api/awx-utils';
import { Instance } from '../interfaces/Instance';

export function AwxSystemUsageBar() {
  const { t } = useTranslation();

  const { data } = useGet<AwxItemsResponse<Instance>>(awxAPI`/instances/`, { page_size: 50 }, {
    refreshInterval: 30000,
  });

  if (!data) return null;

  const instances = (data.results ?? []).filter(
    (i) => i.enabled && i.node_state !== 'deprovisioning'
  );

  const totalCapacity = instances.reduce((sum, i) => sum + i.capacity, 0);
  const consumedCapacity = instances.reduce((sum, i) => sum + i.consumed_capacity, 0);
  const jobsRunning = instances.reduce((sum, i) => sum + i.jobs_running, 0);
  const usedPct = totalCapacity > 0 ? Math.round((consumedCapacity / totalCapacity) * 100) : 0;

  const barColor =
    usedPct >= 90
      ? 'var(--pf-v5-global--danger-color--100)'
      : usedPct >= 70
        ? 'var(--pf-v5-global--warning-color--100)'
        : 'var(--pf-v5-global--success-color--100)';

  const tooltipContent = (
    <div style={{ minWidth: 200 }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{t('System Load')}</div>
      <div>
        {t('Jobs running')}: <strong>{jobsRunning}</strong>
      </div>
      <div>
        {t('Capacity used')}: <strong>{consumedCapacity}</strong> / {totalCapacity} (
        <strong>{usedPct}%</strong>)
      </div>
      {instances.length > 1 && (
        <div style={{ marginTop: 8, borderTop: '1px solid rgba(255,255,255,0.2)', paddingTop: 6 }}>
          {instances.map((inst) => {
            const instPct =
              inst.capacity > 0
                ? Math.round((inst.consumed_capacity / inst.capacity) * 100)
                : 0;
            return (
              <div
                key={inst.id}
                style={{ fontSize: '11px', marginBottom: 2, display: 'flex', justifyContent: 'space-between', gap: 12 }}
              >
                <span>{inst.hostname}</span>
                <span>
                  {inst.jobs_running} {t('jobs')}, {instPct}%
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <Tooltip content={tooltipContent} position="bottom">
      <div
        data-cy="system-usage-bar"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'default',
          padding: '0 8px',
          userSelect: 'none',
        }}
      >
        <span
          style={{
            color: 'rgba(255,255,255,0.85)',
            fontSize: '12px',
            whiteSpace: 'nowrap',
          }}
        >
          {jobsRunning} {jobsRunning === 1 ? t('job') : t('jobs')}
        </span>
        {/* Mini progress bar */}
        <div
          style={{
            width: 72,
            height: 6,
            borderRadius: 3,
            backgroundColor: 'rgba(255,255,255,0.25)',
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${usedPct}%`,
              backgroundColor: barColor,
              borderRadius: 3,
              transition: 'width 0.6s ease, background-color 0.4s ease',
            }}
          />
        </div>
        <span
          style={{
            color: 'rgba(255,255,255,0.85)',
            fontSize: '12px',
            minWidth: 30,
            textAlign: 'right',
          }}
        >
          {usedPct}%
        </span>
      </div>
    </Tooltip>
  );
}
