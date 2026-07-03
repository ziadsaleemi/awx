import { Button, Tooltip } from '@patternfly/react-core';
import { useTranslation } from 'react-i18next';
import { usePageNavigate } from '../../../framework';
import { useGet } from '../../common/crud/useGet';
import { AwxItemsResponse } from '../common/AwxItemsResponse';
import { awxAPI } from '../common/api/awx-utils';
import { Instance } from '../interfaces/Instance';
import { AwxRoute } from './AwxRoutes';

// Injected once into the document head; safe to call multiple times (idempotent).
function ensurePulseKeyframes() {
  const id = 'awx-usage-pulse-keyframes';
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = `
    @keyframes awx-bar-pulse {
      0%   { opacity: 1; }
      50%  { opacity: 0.45; }
      100% { opacity: 1; }
    }
  `;
  document.head.appendChild(style);
}

function nodeBarColor(pct: number): string {
  if (pct >= 90) return 'var(--pf-v5-global--danger-color--100)';
  if (pct >= 70) return 'var(--pf-v5-global--warning-color--100)';
  return 'var(--pf-v5-global--success-color--100)';
}

export function AwxSystemUsageBar() {
  const { t } = useTranslation();
  const pageNavigate = usePageNavigate();

  ensurePulseKeyframes();

  const { data } = useGet<AwxItemsResponse<Instance>>(
    awxAPI`/instances/`,
    { page_size: 200 },
    {
      refreshInterval: 30000,
    }
  );

  if (!data) return null;

  const instances = (data.results ?? []).filter(
    (i) => i.enabled && i.node_state !== 'deprovisioning'
  );

  const capacityNodes = instances.filter((i) => i.capacity > 0);
  const totalCapacity = capacityNodes.reduce((sum, i) => sum + i.capacity, 0);
  const consumedCapacity = capacityNodes.reduce((sum, i) => sum + i.consumed_capacity, 0);
  const jobsRunning = instances.reduce((sum, i) => sum + i.jobs_running, 0);
  const usedPct = totalCapacity > 0 ? Math.round((consumedCapacity / totalCapacity) * 100) : 0;

  const isCritical = usedPct >= 90;
  const barColor = nodeBarColor(usedPct);

  const executionNodes = instances.filter(
    (i) => i.node_type === 'execution' || i.node_type === 'hybrid'
  );
  const readyNodes = instances.filter((i) => ['installed', 'ready'].includes(i.node_state));
  const unavailableNodes = instances.filter((i) => !['installed', 'ready'].includes(i.node_state));
  const busiestNodes = [...capacityNodes]
    .sort((a, b) => {
      const aPct = a.capacity > 0 ? a.consumed_capacity / a.capacity : 0;
      const bPct = b.capacity > 0 ? b.consumed_capacity / b.capacity : 0;
      return b.jobs_running - a.jobs_running || bPct - aPct || a.hostname.localeCompare(b.hostname);
    })
    .slice(0, 5);

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
      <div>
        {t('Nodes')}: <strong>{instances.length}</strong> {t('visible')}, {readyNodes.length}{' '}
        {t('ready')}, {unavailableNodes.length} {t('unavailable')}
      </div>
      <div>
        {t('Execution capacity nodes')}: <strong>{executionNodes.length}</strong>
      </div>
      {busiestNodes.length > 0 ? (
        <div style={{ marginTop: 8, borderTop: '1px solid rgba(255,255,255,0.2)', paddingTop: 6 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('Busiest nodes')}</div>
          {busiestNodes.map((inst) => {
            const instPct =
              inst.capacity > 0 ? Math.round((inst.consumed_capacity / inst.capacity) * 100) : 0;
            return (
              <div
                key={inst.id}
                style={{
                  fontSize: '11px',
                  marginBottom: 2,
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <span>{inst.hostname}</span>
                <span>
                  {inst.jobs_running} {t('jobs')}, {instPct}%
                </span>
              </div>
            );
          })}
          {capacityNodes.length > busiestNodes.length && (
            <div style={{ fontSize: '11px', opacity: 0.8 }}>
              {t('+{{count}} more capacity node(s)', {
                count: capacityNodes.length - busiestNodes.length,
              })}
            </div>
          )}
        </div>
      ) : (
        <div style={{ marginTop: 8, borderTop: '1px solid rgba(255,255,255,0.2)', paddingTop: 6 }}>
          {t('No active execution capacity is reporting load.')}
        </div>
      )}
    </div>
  );

  return (
    <Tooltip content={tooltipContent} position="bottom">
      <Button
        data-cy="system-usage-bar"
        variant="plain"
        onClick={() => pageNavigate(AwxRoute.Instances)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'pointer',
          padding: '0 8px',
          userSelect: 'none',
          color: 'inherit',
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

        <div style={{ flexShrink: 0 }}>
          <div
            style={{
              width: 72,
              height: 6,
              borderRadius: 3,
              backgroundColor: 'rgba(255,255,255,0.25)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${usedPct}%`,
                backgroundColor: barColor,
                borderRadius: 3,
                transition: 'width 0.6s ease, background-color 0.4s ease',
                // #7 — pulse when at/above 90% capacity
                animation: isCritical ? 'awx-bar-pulse 1.2s ease-in-out infinite' : undefined,
              }}
            />
          </div>
        </div>

        <span
          style={{
            color: isCritical ? barColor : 'rgba(255,255,255,0.85)',
            fontSize: '12px',
            minWidth: 30,
            textAlign: 'right',
            fontWeight: isCritical ? 700 : undefined,
            transition: 'color 0.4s ease',
          }}
        >
          {usedPct}%
        </span>
      </Button>
    </Tooltip>
  );
}
