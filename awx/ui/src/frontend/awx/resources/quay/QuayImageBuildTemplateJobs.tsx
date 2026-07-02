import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import {
  DateTimeCell,
  ElapsedTimeCell,
  ITableColumn,
  IToolbarFilter,
  PageTable,
  ToolbarFilterType,
  useGetPageUrl,
} from '../../../../framework';
import { StatusCell } from '../../../common/Status';
import { awxAPI } from '../../common/api/awx-utils';
import { useAwxView } from '../../common/useAwxView';
import { QuayImageBuildJob } from '../../interfaces/QuayImageBuildJob';
import { AwxRoute } from '../../main/AwxRoutes';

export function QuayImageBuildTemplateJobs() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const getPageUrl = useGetPageUrl();

  const toolbarFilters = useMemo<IToolbarFilter[]>(
    () => [
      {
        key: 'status',
        label: t('Status'),
        type: ToolbarFilterType.SingleSelect,
        query: 'status',
        options: [
          { value: 'new', label: t('New') },
          { value: 'pending', label: t('Pending') },
          { value: 'waiting', label: t('Waiting') },
          { value: 'running', label: t('Running') },
          { value: 'successful', label: t('Successful') },
          { value: 'failed', label: t('Failed') },
          { value: 'error', label: t('Error') },
          { value: 'canceled', label: t('Canceled') },
        ],
        placeholder: t('Select status'),
      },
    ],
    [t]
  );

  const tableColumns = useMemo<ITableColumn<QuayImageBuildJob>[]>(
    () => [
      {
        header: t('ID'),
        cell: (job) => job.id,
        sort: 'id',
        card: 'hidden',
        list: 'hidden',
        minWidth: 0,
      },
      {
        header: t('Name'),
        cell: (job) => (
          <Link
            to={getPageUrl(AwxRoute.JobOutput, {
              params: { job_type: 'quay-image-build', id: job.id },
            })}
          >
            {job.name}
          </Link>
        ),
        sort: 'name',
        card: 'name',
        list: 'name',
      },
      {
        header: t('Status'),
        cell: (job) => <StatusCell status={job.status} />,
        sort: 'status',
      },
      {
        header: t('Image'),
        cell: (job) => job.image,
        card: 'hidden',
        list: 'secondary',
      },
      {
        header: t('Started'),
        cell: (job) => <DateTimeCell value={job.started ?? undefined} />,
        sort: 'started',
        defaultSortDirection: 'desc',
      },
      {
        header: t('Finished'),
        cell: (job) => (job.finished ? <DateTimeCell value={job.finished} /> : '--'),
        sort: 'finished',
        defaultSort: true,
        defaultSortDirection: 'desc',
      },
      {
        header: t('Duration'),
        cell: (job) => (
          <ElapsedTimeCell start={job.started ?? undefined} finish={job.finished ?? undefined} />
        ),
      },
      {
        header: t('Launched by'),
        cell: (job) => job.summary_fields.created_by?.username ?? '-',
        card: 'hidden',
        list: 'secondary',
      },
    ],
    [getPageUrl, t]
  );

  const view = useAwxView<QuayImageBuildJob>({
    url: awxAPI`/quay/execution-environment-images/templates/${params.id ?? ''}/jobs/`,
    toolbarFilters,
    tableColumns,
  });

  return (
    <PageTable<QuayImageBuildJob>
      id="awx-quay-ee-template-jobs-table"
      toolbarFilters={toolbarFilters}
      tableColumns={tableColumns}
      errorStateTitle={t('Error loading image build jobs')}
      emptyStateTitle={t('No image builds have been run for this template yet.')}
      {...view}
      defaultSubtitle={t('Project Quay image build')}
    />
  );
}
