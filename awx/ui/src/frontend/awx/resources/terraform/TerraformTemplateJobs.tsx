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
import { awxAPI } from '../../common/api/awx-utils';
import { useAwxView } from '../../common/useAwxView';
import { AwxRoute } from '../../main/AwxRoutes';
import { TerraformJob } from '../../interfaces/TerraformJob';
import { StatusCell } from '../../../common/Status';

export function TerraformTemplateJobs() {
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
      {
        key: 'operation',
        label: t('Operation'),
        type: ToolbarFilterType.SingleSelect,
        query: 'terraform_operation',
        options: [
          { value: 'apply', label: t('Apply') },
          { value: 'plan', label: t('Plan') },
          { value: 'destroy', label: t('Destroy') },
        ],
        placeholder: t('Select operation'),
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
        card: 'hidden',
        list: 'hidden',
        minWidth: 0,
      },
      {
        header: t('Name'),
        cell: (job) => (
          <Link to={getPageUrl(AwxRoute.TerraformJobPage, { params: { job_id: job.id } })}>
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
        header: t('Operation'),
        cell: (job) => job.terraform_operation,
        sort: 'terraform_operation',
      },
      {
        header: t('Started'),
        cell: (job) => <DateTimeCell value={job.started ?? undefined} />,
        sort: 'started',
        defaultSortDirection: 'desc',
      },
      {
        header: t('Finished'),
        cell: (job) => <DateTimeCell value={job.finished ?? undefined} />,
        sort: 'finished',
        defaultSort: true,
        defaultSortDirection: 'desc',
      },
      {
        header: t('Duration'),
        cell: (job) => <ElapsedTimeCell value={job.elapsed} />,
      },
      {
        header: t('Launched by'),
        cell: (job) => job.summary_fields.created_by?.username ?? '—',
        card: 'hidden',
        list: 'secondary',
      },
      {
        header: t('Project'),
        cell: (job) =>
          job.summary_fields.project ? (
            <Link
              to={getPageUrl(AwxRoute.ProjectDetails, {
                params: { id: job.summary_fields.project.id },
              })}
            >
              {job.summary_fields.project.name}
            </Link>
          ) : (
            '—'
          ),
        card: 'hidden',
        list: 'secondary',
      },
    ],
    [getPageUrl, t]
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
