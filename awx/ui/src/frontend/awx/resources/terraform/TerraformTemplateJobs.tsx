import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import {
  ITableColumn,
  IToolbarFilter,
  PageTable,
  ToolbarFilterType,
  usePageNavigate,
} from '../../../../framework';
import { awxAPI } from '../../common/api/awx-utils';
import { useAwxView } from '../../common/useAwxView';
import { AwxRoute } from '../../main/AwxRoutes';
import { TerraformJob } from '../../interfaces/TerraformJob';
import { StatusCell } from '../../../common/Status';
import { useMemo } from 'react';

export function TerraformTemplateJobs() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const pageNavigate = usePageNavigate();

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

  const tableColumns = useMemo<ITableColumn<TerraformJob>[]>(
    () => [
      {
        header: t('ID'),
        cell: (job) => job.id,
        sort: 'id',
        value: (job) => job.id.toString(),
        onClick: (job: TerraformJob) =>
          pageNavigate(AwxRoute.TerraformJobPage, { params: { job_id: job.id } }),
      },
      {
        header: t('Status'),
        cell: (job) => <StatusCell status={job.status} />,
        sort: 'status',
      },
      {
        header: t('Operation'),
        cell: (job) => job.terraform_operation,
        sort: 'terraform_operation',
      },
      {
        header: t('Started'),
        cell: (job) =>
          job.started ? new Date(job.started).toLocaleString() : t('Not started'),
        sort: 'started',
        defaultSort: true,
        defaultSortDirection: 'desc',
      },
      {
        header: t('Finished'),
        cell: (job) =>
          job.finished ? new Date(job.finished).toLocaleString() : '-',
        sort: 'finished',
      },
      {
        header: t('Duration'),
        cell: (job) => (job.elapsed ? `${job.elapsed.toFixed(1)}s` : '-'),
        sort: 'elapsed',
      },
    ],
    [pageNavigate, t]
  );

  const view = useAwxView<TerraformJob>({
    url: awxAPI`/terraform_job_templates/${params.id ?? ''}/jobs/`,
    toolbarFilters,
    tableColumns,
  });

  return (
    <PageTable<TerraformJob>
      id="awx-terraform-template-jobs-table"
      toolbarFilters={toolbarFilters}
      tableColumns={tableColumns}
      errorStateTitle={t('Error loading job history')}
      emptyStateTitle={t('No jobs have been run for this template yet.')}
      {...view}
      defaultSubtitle={t('Terraform Job')}
    />
  );
}
