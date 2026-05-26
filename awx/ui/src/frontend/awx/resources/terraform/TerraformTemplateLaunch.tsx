import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import {
  LoadingPage,
  PageFormSubmitHandler,
  PageHeader,
  PageLayout,
  useGetPageUrl,
  usePageNavigate,
  usePageAlertToaster,
} from '../../../../framework';
import { PageFormTextArea } from '../../../../framework/PageForm/Inputs/PageFormTextArea';
import { PageFormSelect } from '../../../../framework/PageForm/Inputs/PageFormSelect';
import { AwxPageForm } from '../../common/AwxPageForm';
import { awxAPI } from '../../common/api/awx-utils';
import { useGetItem } from '../../../common/crud/useGet';
import { usePostRequest } from '../../../common/crud/usePostRequest';
import { AwxError } from '../../common/AwxError';
import { AwxRoute } from '../../main/AwxRoutes';
import { TerraformJobTemplate } from '../../interfaces/TerraformJobTemplate';
import { TerraformJob } from '../../interfaces/TerraformJob';

interface TerraformLaunchFormValues {
  extra_vars: string;
  terraform_operation: 'apply' | 'plan' | 'destroy';
  target_inventory: string;
}

export function TerraformTemplateLaunch() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const id = params.id ?? '';
  const getPageUrl = useGetPageUrl();
  const pageNavigate = usePageNavigate();
  const alertToaster = usePageAlertToaster();
  const postRequest = usePostRequest<Partial<TerraformLaunchFormValues>, TerraformJob>();

  const { data: template, error, isLoading, refresh } = useGetItem<TerraformJobTemplate>(
    awxAPI`/terraform_job_templates`,
    id
  );

  if (error) return <AwxError error={error} handleRefresh={refresh} />;
  if (isLoading || !template) return <LoadingPage />;

  const onSubmit: PageFormSubmitHandler<TerraformLaunchFormValues> = async (values) => {
    const payload: Partial<TerraformLaunchFormValues> = {};

    if (template.ask_variables_on_launch && values.extra_vars !== template.extra_vars) {
      payload.extra_vars = values.extra_vars;
    }
    if (template.ask_terraform_operation_on_launch) {
      payload.terraform_operation = values.terraform_operation;
    }
    if (template.ask_inventory_on_launch && values.target_inventory) {
      payload.target_inventory = values.target_inventory;
    }

    try {
      const job = await postRequest(awxAPI`/terraform_job_templates/${id}/launch/`, payload);
      pageNavigate(AwxRoute.TerraformJobPage, { params: { job_id: job.id } });
    } catch (err) {
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Failed to launch Terraform template'),
        children: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const operationOptions = [
    { value: 'apply', label: t('Apply') },
    { value: 'plan', label: t('Plan') },
    { value: 'destroy', label: t('Destroy') },
  ];

  const defaultValues: TerraformLaunchFormValues = {
    extra_vars: template.extra_vars,
    terraform_operation: template.terraform_operation,
    target_inventory: template.target_inventory?.toString() ?? '',
  };

  return (
    <PageLayout>
      <PageHeader
        title={t('Launch Terraform Template')}
        description={template.name}
        breadcrumbs={[
          { label: t('Terraform Templates'), to: getPageUrl(AwxRoute.TerraformTemplates) },
          {
            label: template.name,
            to: getPageUrl(AwxRoute.TerraformTemplatePage, { params: { id } }),
          },
          { label: t('Launch') },
        ]}
      />
      <AwxPageForm
        submitText={t('Launch')}
        onSubmit={onSubmit}
        defaultValue={defaultValues}
        onCancel={() => pageNavigate(AwxRoute.TerraformTemplatePage, { params: { id } })}
      >
        {template.ask_terraform_operation_on_launch && (
          <PageFormSelect
            name="terraform_operation"
            label={t('Operation')}
            options={operationOptions}
            isRequired
          />
        )}
        {template.ask_inventory_on_launch && (
          <PageFormTextArea
            name="target_inventory"
            label={t('Target Inventory ID')}
            helperText={t('Numeric ID of the inventory to use for this run.')}
          />
        )}
        {template.ask_variables_on_launch && (
          <PageFormTextArea
            name="extra_vars"
            label={t('Extra Variables')}
            helperText={t('Variables in JSON or YAML format to pass to Terraform as a tfvars file.')}
            style={{ fontFamily: 'monospace' }}
          />
        )}
      </AwxPageForm>
    </PageLayout>
  );
}
