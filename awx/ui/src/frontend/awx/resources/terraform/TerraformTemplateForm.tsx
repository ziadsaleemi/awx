import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import {
  LoadingPage,
  PageFormSubmitHandler,
  PageHeader,
  PageLayout,
  useGetPageUrl,
  usePageNavigate,
} from '../../../../framework';
import { PageFormTextInput } from '../../../../framework/PageForm/Inputs/PageFormTextInput';
import { PageFormTextArea } from '../../../../framework/PageForm/Inputs/PageFormTextArea';
import { PageFormSelect } from '../../../../framework/PageForm/Inputs/PageFormSelect';
import { PageFormCheckbox } from '../../../../framework/PageForm/Inputs/PageFormCheckbox';
import { AwxPageForm } from '../../common/AwxPageForm';
import { awxAPI } from '../../common/api/awx-utils';
import { useGet } from '../../../common/crud/useGet';
import { requestPatch, postRequest } from '../../../common/crud/Data';
import { AwxError } from '../../common/AwxError';
import { AwxRoute } from '../../main/AwxRoutes';
import { TerraformJobTemplate } from '../../interfaces/TerraformJobTemplate';

interface TerraformTemplateFormValues {
  name: string;
  description: string;
  project: number | '';
  terraform_dir: string;
  extra_vars: string;
  verbosity: 0 | 1 | 2 | 3 | 4;
  terraform_operation: 'apply' | 'plan' | 'destroy';
  target_inventory: number | '';
  target_group: string;
  timeout: number;
  ask_variables_on_launch: boolean;
  ask_inventory_on_launch: boolean;
  ask_terraform_operation_on_launch: boolean;
}

function defaultValues(template?: TerraformJobTemplate): TerraformTemplateFormValues {
  return {
    name: template?.name ?? '',
    description: template?.description ?? '',
    project: template?.project ?? '',
    terraform_dir: template?.terraform_dir ?? '.',
    extra_vars: template?.extra_vars ?? '',
    verbosity: template?.verbosity ?? 0,
    terraform_operation: template?.terraform_operation ?? 'apply',
    target_inventory: template?.target_inventory ?? '',
    target_group: template?.target_group ?? '',
    timeout: template?.timeout ?? 0,
    ask_variables_on_launch: template?.ask_variables_on_launch ?? false,
    ask_inventory_on_launch: template?.ask_inventory_on_launch ?? false,
    ask_terraform_operation_on_launch: template?.ask_terraform_operation_on_launch ?? false,
  };
}

export function CreateTerraformTemplate() {
  const { t } = useTranslation();
  const pageNavigate = usePageNavigate();

  const onSubmit: PageFormSubmitHandler<TerraformTemplateFormValues> = async (values) => {
    const payload = {
      ...values,
      project: values.project === '' ? null : Number(values.project),
      target_inventory: values.target_inventory === '' ? null : Number(values.target_inventory),
    };
    const created = await postRequest<Partial<TerraformTemplateFormValues>, TerraformJobTemplate>(
      awxAPI`/terraform_job_templates/`,
      payload
    );
    pageNavigate(AwxRoute.TerraformTemplatePage, { params: { id: created.id } });
  };

  return (
    <PageLayout>
      <PageHeader
        title={t('Create Terraform Template')}
        breadcrumbs={[
          { label: t('Terraform Templates') },
          { label: t('Create Terraform Template') },
        ]}
      />
      <AwxPageForm
        submitText={t('Create Terraform template')}
        onSubmit={onSubmit}
        defaultValue={defaultValues()}
        onCancel={() => pageNavigate(AwxRoute.TerraformTemplates)}
      >
        <TerraformTemplateFormInputs />
      </AwxPageForm>
    </PageLayout>
  );
}

export function EditTerraformTemplate() {
  const { t } = useTranslation();
  const pageNavigate = usePageNavigate();
  const params = useParams<{ id: string }>();
  const id = params.id ?? '';

  const { data: template, error, refresh } = useGet<TerraformJobTemplate>(
    awxAPI`/terraform_job_templates/${id}/`
  );

  if (error) return <AwxError error={error} handleRefresh={refresh} />;
  if (!template) return <LoadingPage />;

  const onSubmit: PageFormSubmitHandler<TerraformTemplateFormValues> = async (values) => {
    const payload = {
      ...values,
      project: values.project === '' ? null : Number(values.project),
      target_inventory: values.target_inventory === '' ? null : Number(values.target_inventory),
    };
    await requestPatch<Partial<TerraformTemplateFormValues>>(
      awxAPI`/terraform_job_templates/${id}/`,
      payload
    );
    pageNavigate(AwxRoute.TerraformTemplatePage, { params: { id } });
  };

  return (
    <PageLayout>
      <PageHeader
        title={t('Edit Terraform Template')}
        breadcrumbs={[
          { label: t('Terraform Templates') },
          { label: template.name },
          { label: t('Edit') },
        ]}
      />
      <AwxPageForm
        submitText={t('Save Terraform template')}
        onSubmit={onSubmit}
        defaultValue={defaultValues(template)}
        onCancel={() =>
          pageNavigate(AwxRoute.TerraformTemplatePage, { params: { id } })
        }
      >
        <TerraformTemplateFormInputs />
      </AwxPageForm>
    </PageLayout>
  );
}

function TerraformTemplateFormInputs() {
  const { t } = useTranslation();

  const verbosityOptions = [
    { value: 0, label: t('0 (Normal)') },
    { value: 1, label: t('1 (Verbose)') },
    { value: 2, label: t('2 (More Verbose)') },
    { value: 3, label: t('3 (Debug)') },
    { value: 4, label: t('4 (Connection Debug)') },
  ];

  const operationOptions = [
    { value: 'apply', label: t('Apply') },
    { value: 'plan', label: t('Plan') },
    { value: 'destroy', label: t('Destroy') },
  ];

  return (
    <>
      <PageFormTextInput
        name="name"
        label={t('Name')}
        isRequired
        maxLength={512}
      />
      <PageFormTextArea
        name="description"
        label={t('Description')}
      />
      <PageFormTextInput
        name="project"
        label={t('Project')}
        helperText={t('Enter the numeric ID of the project that contains the Terraform configuration files.')}
        type="number"
      />
      <PageFormTextInput
        name="terraform_dir"
        label={t('Terraform Directory')}
        helperText={t('Path within the project to the directory containing the Terraform root module. Use "." for the repository root.')}
        placeholder="."
      />
      <PageFormSelect
        name="terraform_operation"
        label={t('Default Operation')}
        options={operationOptions}
        isRequired
      />
      <PageFormSelect
        name="verbosity"
        label={t('Verbosity')}
        options={verbosityOptions}
      />
      <PageFormTextArea
        name="extra_vars"
        label={t('Extra Variables')}
        helperText={t('Variables passed to Terraform as a tfvars file. Accepts JSON or YAML key/value pairs.')}
        style={{ fontFamily: 'monospace' }}
      />
      <PageFormTextInput
        name="target_inventory"
        label={t('Target Inventory')}
        helperText={t('Numeric ID of the inventory to populate after a successful apply.')}
        type="number"
      />
      <PageFormTextInput
        name="target_group"
        label={t('Target Group')}
        helperText={t('Inventory group to add provisioned hosts to. Created automatically if it does not exist.')}
      />
      <PageFormTextInput
        name="timeout"
        label={t('Timeout')}
        type="number"
        helperText={t('Number of seconds before the job is cancelled. 0 means no timeout.')}
      />
      <PageFormCheckbox
        name="ask_variables_on_launch"
        label={t('Prompt for variables on launch')}
      />
      <PageFormCheckbox
        name="ask_inventory_on_launch"
        label={t('Prompt for inventory on launch')}
      />
      <PageFormCheckbox
        name="ask_terraform_operation_on_launch"
        label={t('Prompt for operation on launch')}
      />
    </>
  );
}
