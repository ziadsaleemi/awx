import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { CubesIcon } from '@patternfly/react-icons';
import {
  DateTimeCell,
  ITableColumn,
  LoadingPage,
  PageLayout,
  PageTable,
  TextCell,
  useGetPageUrl,
  useInMemoryView,
  usePageNavigate,
} from '../../../../framework';
import { useGetItem } from '../../../common/crud/useGet';
import { StatusCell } from '../../../common/Status';
import { AwxError } from '../../common/AwxError';
import { awxAPI } from '../../common/api/awx-utils';
import { AwxRoute } from '../../main/AwxRoutes';
import { CatalogDeployment } from '../../interfaces/CatalogDeployment';

type HistoryEntry = CatalogDeployment['provisioning_history'][number] & { _idx: number };

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

export function CatalogDeploymentHistory() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const id = params.id ?? '';
  const getPageUrl = useGetPageUrl();
  const pageNavigate = usePageNavigate();

  const { data: deployment, error, isLoading, refresh } = useGetItem<CatalogDeployment>(
    awxAPI`/catalog_deployments`,
    id
  );

  const items = useMemo<HistoryEntry[]>(
    () =>
      (deployment?.provisioning_history ?? []).map((entry, idx) => ({ ...entry, _idx: idx })),
    [deployment]
  );

  const tableColumns = useMemo<ITableColumn<HistoryEntry>[]>(
    () => [
      {
        header: t('#'),
        cell: (entry) => <TextCell text={String(entry._idx + 1)} />,
        minWidth: 40,
      },
      {
        header: t('Action'),
        cell: (entry) => (
          <TextCell
            text={entry.action.charAt(0).toUpperCase() + entry.action.slice(1)}
          />
        ),
      },
      {
        header: t('Status'),
        cell: (entry) => <StatusCell status={entry.status} />,
      },
      {
        header: t('Started'),
        cell: (entry) => <DateTimeCell value={entry.created} />,
      },
      {
        header: t('Finished'),
        cell: (entry) =>
          entry.finished ? <DateTimeCell value={entry.finished} /> : <TextCell text="-" />,
      },
      {
        header: t('Duration'),
        cell: (entry) => <TextCell text={historyEntryDuration(entry)} />,
      },
      {
        header: t('Job'),
        cell: (entry) =>
          entry.job_id ? (
            <TextCell
              text={t('Job #{{id}}', { id: entry.job_id })}
              to={getPageUrl(AwxRoute.TerraformJobPage, { params: { id: String(entry.job_id) } })}
              onClick={() =>
                pageNavigate(AwxRoute.TerraformJobPage, {
                  params: { id: String(entry.job_id) },
                })
              }
            />
          ) : (
            <TextCell text="-" />
          ),
      },
    ],
    [t, getPageUrl, pageNavigate]
  );

  const view = useInMemoryView<HistoryEntry>({
    items,
    keyFn: (entry) => entry._idx,
    tableColumns,
    disableQueryString: true,
  });

  const expandedRow = useMemo(
    () => (entry: HistoryEntry) => {
      if (!entry.details || Object.keys(entry.details).length === 0) return null;
      return (
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
      );
    },
    []
  );

  if (error) return <AwxError error={error} handleRefresh={refresh} />;
  if (isLoading || !deployment) return <LoadingPage />;

  return (
    <PageLayout>
      <PageTable<HistoryEntry>
        tableColumns={tableColumns}
        errorStateTitle={t('Error loading history')}
        emptyStateTitle={t('No provisioning history yet.')}
        emptyStateIcon={CubesIcon}
        emptyStateDescription={t('This deployment has no provisioning history.')}
        expandedRow={expandedRow}
        disableListView
        disableCardView
        {...view}
        defaultSubtitle={t('Provisioning History')}
      />
    </PageLayout>
  );
}
