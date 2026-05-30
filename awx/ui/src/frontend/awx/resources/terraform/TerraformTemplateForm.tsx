import { useCallback, useEffect, useRef } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { AICodeAssistant } from '../../common/AICodeAssistant';
import {
  LoadingPage,
  PageFormSubmitHandler,
  PageHeader,
  PageLayout,
  usePageNavigate,
} from '../../../../framework';
import { PageFormAsyncSelect } from '../../../../framework/PageForm/Inputs/PageFormAsyncSelect';
import { PageFormTextInput } from '../../../../framework/PageForm/Inputs/PageFormTextInput';
import { PageFormTextArea } from '../../../../framework/PageForm/Inputs/PageFormTextArea';
import { PageFormSelect } from '../../../../framework/PageForm/Inputs/PageFormSelect';
import { PageFormCheckbox } from '../../../../framework/PageForm/Inputs/PageFormCheckbox';
import { AwxPageForm } from '../../common/AwxPageForm';
import { awxAPI } from '../../common/api/awx-utils';
import { useGet } from '../../../common/crud/useGet';
import { requestGet, requestPatch, postRequest } from '../../../common/crud/Data';
import { AwxError } from '../../common/AwxError';
import { AwxRoute } from '../../main/AwxRoutes';
import { TerraformJobTemplate } from '../../interfaces/TerraformJobTemplate';
import { Credential } from '../../interfaces/Credential';
import { PageFormCredentialSelect } from '../../access/credentials/components/PageFormCredentialSelect';
import { PageFormProjectSelect } from '../projects/components/PageFormProjectSelect';
import { PageFormInventorySelect } from '../inventories/components/PageFormInventorySelect';
import { getAddedAndRemoved } from '../../common/util/getAddedAndRemoved';
import { Project } from '../../interfaces/Project';
import { Inventory } from '../../interfaces/Inventory';
import { AwxItemsResponse } from '../../common/AwxItemsResponse';

interface InventoryGroup {
  id: number;
  name: string;
  description?: string;
}

interface TerraformTemplateFormValues {
  name: string;
  description: string;
  project: Project | null;
  terraform_dir: string;
  extra_vars: string;
  verbosity: 0 | 1 | 2 | 3 | 4;
  terraform_operation: 'apply' | 'plan' | 'destroy';
  target_inventory: Inventory | null;
  target_group: InventoryGroup | null;
  timeout: number;
  ask_variables_on_launch: boolean;
  ask_inventory_on_launch: boolean;
  ask_terraform_operation_on_launch: boolean;
  credentials: Pick<Credential, 'id' | 'name' | 'description' | 'kind' | 'cloud'>[];
}

function defaultValues(template?: TerraformJobTemplate): TerraformTemplateFormValues {
  return {
    name: template?.name ?? '',
    description: template?.description ?? '',
    project: (template?.summary_fields?.project as unknown as Project) ?? null,
    terraform_dir: template?.terraform_dir ?? '.',
    extra_vars: template?.extra_vars ?? '',
    verbosity: template?.verbosity ?? 0,
    terraform_operation: template?.terraform_operation ?? 'apply',
    target_inventory: (template?.summary_fields?.target_inventory as unknown as Inventory) ?? null,
    target_group: template?.target_group
      ? { id: -1, name: template.target_group }
      : null,
    timeout: template?.timeout ?? 0,
    ask_variables_on_launch: template?.ask_variables_on_launch ?? false,
    ask_inventory_on_launch: template?.ask_inventory_on_launch ?? false,
    ask_terraform_operation_on_launch: template?.ask_terraform_operation_on_launch ?? false,
    credentials: template?.summary_fields?.credentials ?? [],
  };
}

async function submitCredentials(
  templateId: number,
  existingCredentials: Pick<Credential, 'id'>[],
  newCredentials: Pick<Credential, 'id'>[]
) {
  const { added, removed } = getAddedAndRemoved(existingCredentials, newCredentials);
  await Promise.all(
    removed.map((cred) =>
      postRequest(awxAPI`/terraform_job_templates/${templateId.toString()}/credentials/`, {
        id: cred.id,
        disassociate: true,
      })
    )
  );
  await Promise.all(
    added.map((cred) =>
      postRequest(awxAPI`/terraform_job_templates/${templateId.toString()}/credentials/`, {
        id: cred.id,
      })
    )
  );
}

export function CreateTerraformTemplate() {
  const { t } = useTranslation();
  const pageNavigate = usePageNavigate();

  const onSubmit: PageFormSubmitHandler<TerraformTemplateFormValues> = async (values) => {
    const { credentials, ...rest } = values;
    const payload = {
      ...rest,
      project: values.project?.id ?? null,
      target_inventory: values.target_inventory?.id ?? null,
      target_group: values.target_group?.name ?? '',
    };
    const created = await postRequest<TerraformJobTemplate, typeof payload>(
      awxAPI`/terraform_job_templates/`,
      payload
    );
    if (credentials?.length > 0) {
      await submitCredentials(created.id, [], credentials);
    }
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
    const { credentials, ...rest } = values;
    const payload = {
      ...rest,
      project: values.project?.id ?? null,
      target_inventory: values.target_inventory?.id ?? null,
      target_group: values.target_group?.name ?? '',
    };
    await requestPatch<typeof payload>(
      awxAPI`/terraform_job_templates/${id}/`,
      payload
    );
    await submitCredentials(
      template.id,
      template.summary_fields?.credentials ?? [],
      credentials
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
  const { setValue } = useFormContext<TerraformTemplateFormValues>();
  const targetInventory = useWatch<TerraformTemplateFormValues>({
    name: 'target_inventory',
  }) as Inventory | null;
  const targetInventoryId = targetInventory?.id ?? null;
  const prevTargetInventoryId = useRef<number | null>(targetInventoryId);

  useEffect(() => {
    if (prevTargetInventoryId.current === null) {
      prevTargetInventoryId.current = targetInventoryId;
      return;
    }
    if (prevTargetInventoryId.current !== targetInventoryId) {
      setValue('target_group', null);
      prevTargetInventoryId.current = targetInventoryId;
    }
  }, [targetInventoryId, setValue]);

  const queryInventoryGroups = useCallback(async () => {
    if (!targetInventoryId) {
      return { total: 0, values: [] as InventoryGroup[] };
    }
    const response = await requestGet<AwxItemsResponse<InventoryGroup>>(
      awxAPI`/inventories/${targetInventoryId.toString()}/groups/?page_size=200`
    );
    return { total: response.count, values: response.results };
  }, [targetInventoryId]);

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
      <PageFormTextInput<TerraformTemplateFormValues>
        name="name"
        label={t('Name')}
        isRequired
        maxLength={512}
        placeholder={t('Add a name for this template')}
      />
      <PageFormTextInput<TerraformTemplateFormValues>
        name="description"
        label={t('Description')}
        placeholder={t('Add a description for this template')}
      />
      <PageFormProjectSelect<TerraformTemplateFormValues>
        name="project"
        isRequired
      />
      <PageFormTextInput<TerraformTemplateFormValues>
        name="terraform_dir"
        label={t('Terraform directory')}
        labelHelpTitle={t('Terraform directory')}
        labelHelp={t(
          'Path within the project to the directory containing the Terraform root module. Use "." for the repository root (default).'
        )}
        placeholder="."
      />
      <PageFormSelect<TerraformTemplateFormValues>
        name="terraform_operation"
        label={t('Terraform operation')}
        labelHelpTitle={t('Terraform operation')}
        labelHelp={t('Select the Terraform operation to run: apply, plan, or destroy.')}
        options={operationOptions}
        isRequired
        additionalControls={
          <PageFormCheckbox
            label={t('Prompt on launch')}
            name="ask_terraform_operation_on_launch"
          />
        }
      />
      <PageFormSelect<TerraformTemplateFormValues>
        name="verbosity"
        label={t('Verbosity')}
        labelHelpTitle={t('Verbosity')}
        labelHelp={t('Control the level of output Terraform will produce as it executes.')}
        options={verbosityOptions}
      />
      <PageFormCredentialSelect<TerraformTemplateFormValues>
        name="credentials"
        label={t('Credentials')}
        placeholder={t('Select credentials')}
        labelHelp={t(
          'Select credentials that provide environment variables for the Terraform provider (e.g. Proxmox VE, AWS, Azure). You can attach multiple credentials of different types.'
        )}
        isMultiple
        allowDuplicateCredentialTypes={false}
      />
      <PageFormInventorySelect<TerraformTemplateFormValues>
        name="target_inventory"
        labelHelp={t(
          'Optional. After a successful apply, AWX will read Terraform output variables and register hosts named "host_ip_*" into this inventory.'
        )}
        additionalControls={
          <PageFormCheckbox label={t('Prompt on launch')} name="ask_inventory_on_launch" />
        }
      />
      <PageFormAsyncSelect<TerraformTemplateFormValues, 'target_group', InventoryGroup>
        name="target_group"
        label={t('Target group')}
        labelHelp={t(
          'Optional. Select an inventory group from the selected inventory. Provisioned hosts are added to this group after a successful apply.'
        )}
        variant="typeahead"
        query={queryInventoryGroups}
        valueToString={(value) => value?.name ?? ''}
        placeholder={
          targetInventoryId
            ? t('Select target group')
            : t('Select an inventory first')
        }
        loadingPlaceholder={t('Loading inventory groups...')}
        loadingErrorText={t('Error loading inventory groups')}
        limit={200}
        isReadOnly={!targetInventoryId}
      />
      <PageFormTextInput<TerraformTemplateFormValues>
        name="timeout"
        label={t('Timeout')}
        labelHelpTitle={t('Timeout')}
        labelHelp={t(
          'The number of seconds to run before the job is cancelled. Zero (the default) means no timeout.'
        )}
        type="number"
        placeholder={t('Add a timeout value')}
      />
      <PageFormTextArea<TerraformTemplateFormValues>
        name="extra_vars"
        label={t('Extra variables')}
        labelHelpTitle={t('Extra variables')}
        labelHelp={t(
          'Key/value pairs to pass to Terraform as a tfvars file. Accepts JSON or YAML format. Survey variables and launch-time overrides are merged in automatically.'
        )}
        additionalControls={
          <>
            <PageFormCheckbox label={t('Prompt on launch')} name="ask_variables_on_launch" />
            <AICodeAssistant<TerraformTemplateFormValues>
              fieldName="extra_vars"
              format="tfvars"
              context="Terraform tfvars variables"
            />
          </>
        }
      />
    </>
  );
}
