import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import {
  ITableColumn,
  IToolbarFilter,
  PageTable,
  ToolbarFilterType,
  useGetPageUrl,
} from '../../../../framework';
import { StatusCell } from '../../../common/Status';
import { awxAPI } from '../../common/api/awx-utils';
import { useAwxView } from '../../common/useAwxView';
import { TerraformStateRevision } from '../../interfaces/TerraformJobTemplate';
import { AwxRoute } from '../../main/AwxRoutes';

function shortHash(value: string) {
  return value ? value.slice(0, 12) : '-';
}

function resourceSummary(revision: TerraformStateRevision) {
  const resources = revision.summary?.resources ?? [];
  if (!resources.length) return '-';
  return resources
    .map(
      (resource) =>
        `${resource.mode}.${resource.type}.${resource.name} (${resource.instance_count})`
    )
    .join(', ');
}

function outputSummary(revision: TerraformStateRevision) {
  const outputs = revision.summary?.outputs ?? [];
  if (!outputs.length) return '-';
  return outputs
    .map((output) => `${output.name}${output.sensitive ? ' (sensitive)' : ''}`)
    .join(', ');
}

export function TerraformTemplateState() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const getPageUrl = useGetPageUrl();

  const toolbarFilters = useMemo<IToolbarFilter[]>(
    () => [
      {
        key: 'job_status',
        label: t('Job status'),
        type: ToolbarFilterType.SingleSelect,
        query: 'job_status',
        options: [
          { value: 'successful', label: t('Successful') },
          { value: 'failed', label: t('Failed') },
          { value: 'error', label: t('Error') },
        ],
        placeholder: t('Select job status'),
      },
      {
        key: 'operation',
        label: t('Operation'),
        type: ToolbarFilterType.SingleSelect,
        query: 'operation',
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

  const tableColumns = useMemo<ITableColumn<TerraformStateRevision>[]>(
    () => [
      {
        header: t('Revision'),
        type: 'text',
        value: (revision) => shortHash(revision.git_commit),
        sort: 'git_commit',
        card: 'name',
        list: 'name',
      },
      {
        header: t('Created'),
        type: 'datetime',
        value: (revision) => revision.created,
        sort: 'created',
        defaultSort: true,
        defaultSortDirection: 'desc',
      },
      {
        header: t('Job'),
        cell: (revision) =>
          revision.terraform_job && revision.summary_fields.terraform_job ? (
            <Link
              to={getPageUrl(AwxRoute.TerraformJobPage, {
                params: { job_id: revision.terraform_job },
              })}
            >
              {revision.summary_fields.terraform_job.name}
            </Link>
          ) : (
            '-'
          ),
        sort: 'terraform_job',
      },
      {
        header: t('Status'),
        cell: (revision) => <StatusCell status={revision.job_status} />,
        sort: 'job_status',
      },
      {
        header: t('Operation'),
        type: 'text',
        value: (revision) => revision.operation,
        sort: 'operation',
      },
      {
        header: t('Serial'),
        type: 'text',
        value: (revision) => (revision.serial === null ? '-' : revision.serial.toString()),
        sort: 'serial',
      },
      {
        header: t('Resources'),
        type: 'count',
        value: (revision) => revision.resource_count,
        sort: 'resource_count',
      },
      {
        header: t('Outputs'),
        type: 'count',
        value: (revision) => revision.output_count,
        sort: 'output_count',
      },
      {
        header: t('State key'),
        type: 'text',
        value: (revision) => revision.state_key,
        table: 'expanded',
      },
      {
        header: t('State project'),
        type: 'text',
        value: (revision) => revision.summary_fields.state_project?.name ?? '-',
        table: 'expanded',
      },
      {
        header: t('Branch'),
        type: 'text',
        value: (revision) => revision.state_branch,
        table: 'expanded',
      },
      {
        header: t('Encrypted state path'),
        type: 'text',
        value: (revision) => revision.state_path,
        table: 'expanded',
      },
      {
        header: t('Terraform version'),
        type: 'text',
        value: (revision) => revision.terraform_version || '-',
        table: 'expanded',
      },
      {
        header: t('Lineage'),
        type: 'text',
        value: (revision) => revision.lineage || '-',
        table: 'expanded',
      },
      {
        header: t('State checksum'),
        type: 'text',
        value: (revision) => revision.checksum,
        table: 'expanded',
      },
      {
        header: t('Resource structure'),
        type: 'description',
        value: resourceSummary,
        table: 'expanded',
      },
      {
        header: t('Output structure'),
        type: 'description',
        value: outputSummary,
        table: 'expanded',
      },
    ],
    [getPageUrl, t]
  );

  const view = useAwxView<TerraformStateRevision>({
    url: awxAPI`/terraform_job_templates/${params.id ?? ''}/state_revisions/`,
    toolbarFilters,
    tableColumns,
  });

  return (
    <PageTable<TerraformStateRevision>
      id="awx-terraform-template-state-table"
      toolbarFilters={toolbarFilters}
      tableColumns={tableColumns}
      errorStateTitle={t('Error loading managed state revisions')}
      emptyStateTitle={t('No managed state revisions have been published.')}
      emptyStateDescription={t(
        'Select Capstan managed Git state on the template and run it to create an encrypted revision.'
      )}
      disableCardView
      {...view}
      defaultSubtitle={t('Terraform state revision')}
    />
  );
}
