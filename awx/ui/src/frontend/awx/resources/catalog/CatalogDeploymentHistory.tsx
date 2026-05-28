import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { Label } from '@patternfly/react-core';
import { LoadingPage, useGetPageUrl } from '../../../../framework';
import { useGetItem } from '../../../common/crud/useGet';
import { AwxError } from '../../common/AwxError';
import { awxAPI } from '../../common/api/awx-utils';
import { AwxRoute } from '../../main/AwxRoutes';
import { CatalogDeployment } from '../../interfaces/CatalogDeployment';

function formatDuration(startIso: string, finishIso?: string): string {
  const start = new Date(startIso).valueOf();
  const end = finishIso ? new Date(finishIso).valueOf() : Date.now();
  const totalSeconds = Math.max(0, Math.floor((end - start) / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function historyEntryDuration(entry: { created: string; finished?: string; status: string }): string {
  if (!entry.finished && entry.status !== 'running') return '-';
  return formatDuration(entry.created, entry.finished);
}

function statusVariant(status: string): 'blue' | 'green' | 'red' | 'orange' | 'grey' {
  switch (status) {
    case 'successful': return 'green';
    case 'failed':     return 'red';
    case 'running':    return 'blue';
    case 'canceled':   return 'orange';
    default:           return 'grey';
  }
}

export function CatalogDeploymentHistory() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const id = params.id ?? '';
  const getPageUrl = useGetPageUrl();

  const { data: deployment, error, isLoading, refresh } = useGetItem<CatalogDeployment>(
    awxAPI`/catalog_deployments`,
    id
  );

  const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({});
  const toggleRow = (idx: number) =>
    setExpandedRows((prev) => ({ ...prev, [idx]: !prev[idx] }));

  if (error) return <AwxError error={error} handleRefresh={refresh} />;
  if (isLoading || !deployment) return <LoadingPage />;

  const history = deployment.provisioning_history ?? [];

  if (!history.length) {
    return (
      <div style={{ padding: '1.5rem', color: '#888' }}>
        {t('No provisioning history yet.')}
      </div>
    );
  }

  return (
    <div style={{ padding: '1rem', overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '2px solid #ddd' }}>
            <th style={{ padding: '6px 8px', width: '1.5rem' }} />
            <th style={{ padding: '6px 8px' }}>#</th>
            <th style={{ padding: '6px 8px' }}>{t('Action')}</th>
            <th style={{ padding: '6px 8px' }}>{t('Status')}</th>
            <th style={{ padding: '6px 8px' }}>{t('Started')}</th>
            <th style={{ padding: '6px 8px' }}>{t('Finished')}</th>
            <th style={{ padding: '6px 8px' }}>{t('Duration')}</th>
            <th style={{ padding: '6px 8px' }}>{t('Job')}</th>
          </tr>
        </thead>
        <tbody>
          {history.map((entry, idx) => {
            const hasDetails = entry.details && Object.keys(entry.details).length > 0;
            const isExpanded = !!expandedRows[idx];
            return (
              <>
                <tr
                  key={`row-${idx}`}
                  style={{ borderBottom: isExpanded ? 'none' : '1px solid #eee' }}
                >
                  <td style={{ padding: '6px 8px' }}>
                    {hasDetails && (
                      <button
                        onClick={() => toggleRow(idx)}
                        aria-label={isExpanded ? t('Collapse') : t('Expand')}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: 0,
                          fontSize: '0.75rem',
                          color: '#666',
                        }}
                      >
                        {isExpanded ? '▼' : '▶'}
                      </button>
                    )}
                  </td>
                  <td style={{ padding: '6px 8px', color: '#888' }}>{idx + 1}</td>
                  <td style={{ padding: '6px 8px', textTransform: 'capitalize' }}>{entry.action}</td>
                  <td style={{ padding: '6px 8px' }}>
                    <Label color={statusVariant(entry.status)} isCompact>
                      {entry.status}
                    </Label>
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    {new Date(entry.created).toLocaleString()}
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    {entry.finished ? new Date(entry.finished).toLocaleString() : '-'}
                  </td>
                  <td style={{ padding: '6px 8px', fontVariantNumeric: 'tabular-nums' }}>
                    {historyEntryDuration(entry)}
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    {entry.job_id ? (
                      <a
                        href={getPageUrl(AwxRoute.Jobs)}
                        onClick={(e) => {
                          e.preventDefault();
                          /* navigate to job detail */
                        }}
                      >
                        {t('Job #{{id}}', { id: entry.job_id })}
                      </a>
                    ) : (
                      '-'
                    )}
                  </td>
                </tr>
                {isExpanded && hasDetails && (
                  <tr
                    key={`details-${idx}`}
                    style={{ borderBottom: '1px solid #eee', background: '#f9f9f9' }}
                  >
                    <td />
                    <td colSpan={7} style={{ padding: '4px 8px 10px 24px' }}>
                      <pre
                        style={{
                          fontFamily: 'monospace',
                          fontSize: '0.8rem',
                          margin: 0,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}
                      >
                        {JSON.stringify(entry.details, null, 2)}
                      </pre>
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
