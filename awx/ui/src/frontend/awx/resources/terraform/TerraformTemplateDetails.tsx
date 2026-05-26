import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import {
  LoadingPage,
  PageDetail,
  PageDetails,
  useGetPageUrl,
} from '../../../../framework';
import { PageDetailCodeEditor } from '../../../../framework/PageDetails/PageDetailCodeEditor';
import { useGetItem } from '../../../common/crud/useGet';
import { AwxError } from '../../common/AwxError';
import { awxAPI } from '../../common/api/awx-utils';
import { AwxRoute } from '../../main/AwxRoutes';
import { TerraformJobTemplate } from '../../interfaces/TerraformJobTemplate';
import { StatusCell } from '../../../common/Status';

export function TerraformTemplateDetails() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const getPageUrl = useGetPageUrl();

  const { data: template, error, isLoading, refresh } = useGetItem<TerraformJobTemplate>(
    awxAPI`/terraform_job_templates`,
    params.id
  );

  if (error) return <AwxError error={error} handleRefresh={refresh} />;
  if (isLoading || !template) return <LoadingPage />;

  const verbosityLabels: Record<number, string> = {
    0: t('0 (Normal)'),
    1: t('1 (Verbose)'),
    2: t('2 (More Verbose)'),
    3: t('3 (Debug)'),
    4: t('4 (Connection Debug)'),
  };

  return (
    <PageDetails>
      <PageDetail label={t('Name')}>{template.name}</PageDetail>
      <PageDetail label={t('Description')}>{template.description}</PageDetail>
      <PageDetail label={t('Status')}>
        {template.status ? <StatusCell status={template.status} /> : t('Never run')}
      </PageDetail>
      <PageDetail label={t('Operation')}>{template.terraform_operation}</PageDetail>
      <PageDetail label={t('Verbosity')}>
        {verbosityLabels[template.verbosity] ?? template.verbosity}
      </PageDetail>
      <PageDetail label={t('Project')}>
        {template.summary_fields?.project?.name ?? '-'}
      </PageDetail>
      <PageDetail label={t('Terraform Directory')}>{template.terraform_dir || '.'}</PageDetail>
      <PageDetail label={t('Target Inventory')}>
        {template.summary_fields?.target_inventory?.name ?? t('None')}
      </PageDetail>
      {template.target_group && (
        <PageDetail label={t('Target Group')}>{template.target_group}</PageDetail>
      )}
      <PageDetail label={t('Timeout')}>
        {template.timeout ? t('{{n}} seconds', { n: template.timeout }) : t('No timeout')}
      </PageDetail>
      <PageDetail label={t('Prompt on launch — Variables')}>
        {template.ask_variables_on_launch ? t('Yes') : t('No')}
      </PageDetail>
      <PageDetail label={t('Prompt on launch — Inventory')}>
        {template.ask_inventory_on_launch ? t('Yes') : t('No')}
      </PageDetail>
      <PageDetail label={t('Prompt on launch — Operation')}>
        {template.ask_terraform_operation_on_launch ? t('Yes') : t('No')}
      </PageDetail>
      {template.summary_fields?.created_by && (
        <PageDetail label={t('Created by')}>
          {template.summary_fields.created_by.username}
        </PageDetail>
      )}
      {template.created && (
        <PageDetail label={t('Created')}>
          {new Date(template.created).toLocaleString()}
        </PageDetail>
      )}
      {template.summary_fields?.modified_by && (
        <PageDetail label={t('Last modified by')}>
          {template.summary_fields.modified_by.username}
        </PageDetail>
      )}
      {template.modified && (
        <PageDetail label={t('Last modified')}>
          {new Date(template.modified).toLocaleString()}
        </PageDetail>
      )}
      {template.extra_vars && (
        <PageDetailCodeEditor
          label={t('Extra Variables')}
          value={template.extra_vars}
        />
      )}
    </PageDetails>
  );
}
