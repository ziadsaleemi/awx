import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { ChangeEvent } from 'react';
import { FormGroup } from '@patternfly/react-core';
import {
  LoadingPage,
  PageFormSubmitHandler,
  PageHeader,
  PageLayout,
  usePageNavigate,
} from '../../../../framework';
import { PageFormTextInput } from '../../../../framework/PageForm/Inputs/PageFormTextInput';
import { PageFormTextArea } from '../../../../framework/PageForm/Inputs/PageFormTextArea';
import { PageFormCheckbox } from '../../../../framework/PageForm/Inputs/PageFormCheckbox';
import { AwxPageForm } from '../../common/AwxPageForm';
import { awxAPI } from '../../common/api/awx-utils';
import { useGetItem } from '../../../common/crud/useGet';
import { requestPatch, postRequest } from '../../../common/crud/Data';
import { AwxError } from '../../common/AwxError';
import { AwxRoute } from '../../main/AwxRoutes';
import { CatalogItem } from '../../interfaces/CatalogItem';
import { PageFormSelectOrganization } from '../../access/organizations/components/PageFormOrganizationSelect';
import { PageFormWorkflowJobTemplateSelect } from '../templates/components/PageFormWorkflowJobTemplateSelect';
import { PageFormTerraformJobTemplateSelect } from '../templates/components/PageFormTerraformJobTemplateSelect';
import { Organization } from '../../interfaces/Organization';
import { WorkflowJobTemplate } from '../../interfaces/WorkflowJobTemplate';
import { TerraformJobTemplate } from '../../interfaces/TerraformJobTemplate';
import { useController, useFormContext } from 'react-hook-form';

interface CatalogItemFormValues {
  name: string;
  description: string;
  icon_data: string;
  icon_url: string;
  organization: Organization | null;
  provision_workflow: WorkflowJobTemplate | null;
  terraform_job_template: TerraformJobTemplate | null;
  deprovision_workflow: WorkflowJobTemplate | null;
  override_workflow_limit: boolean;
  extra_vars_schema: string;
}

function makeDefaultValues(item?: CatalogItem): CatalogItemFormValues {
  return {
    name: item?.name ?? '',
    description: item?.description ?? '',
    icon_data: item?.icon_data ?? '',
    icon_url: item?.icon_url ?? '',
    organization: item?.summary_fields?.organization
      ? (item.summary_fields.organization as unknown as Organization)
      : null,
    provision_workflow: item?.summary_fields?.provision_workflow
      ? (item.summary_fields.provision_workflow as unknown as WorkflowJobTemplate)
      : null,
    terraform_job_template: item?.summary_fields?.terraform_job_template
      ? (item.summary_fields.terraform_job_template as unknown as TerraformJobTemplate)
      : null,
    deprovision_workflow: item?.summary_fields?.deprovision_workflow
      ? (item.summary_fields.deprovision_workflow as unknown as WorkflowJobTemplate)
      : null,
    override_workflow_limit: item?.override_workflow_limit ?? true,
    extra_vars_schema: item?.extra_vars_schema
      ? JSON.stringify(item.extra_vars_schema, null, 2)
      : '',
  };
}

export function CreateCatalogItem() {
  const { t } = useTranslation();
  const pageNavigate = usePageNavigate();

  const onSubmit: PageFormSubmitHandler<CatalogItemFormValues> = async (values) => {
    let extra_vars_schema: Record<string, unknown> | null = null;
    if (values.extra_vars_schema.trim()) {
      extra_vars_schema = JSON.parse(values.extra_vars_schema) as Record<string, unknown>;
    }
    const payload = {
      name: values.name,
      description: values.description,
      icon_data: values.icon_data,
      icon_url: values.icon_url,
      organization: (values.organization as unknown as Organization)?.id ?? null,
      provision_workflow:
        (values.provision_workflow as unknown as WorkflowJobTemplate)?.id ?? null,
      terraform_job_template:
        (values.terraform_job_template as unknown as TerraformJobTemplate)?.id ?? null,
      deprovision_workflow:
        (values.deprovision_workflow as unknown as WorkflowJobTemplate)?.id ?? null,
      override_workflow_limit: values.override_workflow_limit,
      extra_vars_schema,
    };
    const created = await postRequest<CatalogItem, typeof payload>(
      awxAPI`/catalog_items/`,
      payload
    );
    pageNavigate(AwxRoute.CatalogItemPage, { params: { id: created.id } });
  };

  return (
    <PageLayout>
      <PageHeader
        title={t('Create Catalog Item')}
        breadcrumbs={[
          { label: t('Catalog Items') },
          { label: t('Create Catalog Item') },
        ]}
      />
      <AwxPageForm
        submitText={t('Create catalog item')}
        onSubmit={onSubmit}
        defaultValue={makeDefaultValues()}
        onCancel={() => pageNavigate(AwxRoute.CatalogAdminItems)}
      >
        <CatalogItemFormInputs />
      </AwxPageForm>
    </PageLayout>
  );
}

export function EditCatalogItem() {
  const { t } = useTranslation();
  const pageNavigate = usePageNavigate();
  const params = useParams<{ id: string }>();
  const id = params.id ?? '';

  const { data: item, error, refresh } = useGetItem<CatalogItem>(
    awxAPI`/catalog_items`,
    id
  );

  if (error) return <AwxError error={error} handleRefresh={refresh} />;
  if (!item) return <LoadingPage />;

  const onSubmit: PageFormSubmitHandler<CatalogItemFormValues> = async (values) => {
    let extra_vars_schema: Record<string, unknown> | null = null;
    if (values.extra_vars_schema.trim()) {
      extra_vars_schema = JSON.parse(values.extra_vars_schema) as Record<string, unknown>;
    }
    const payload = {
      name: values.name,
      description: values.description,
      icon_data: values.icon_data,
      icon_url: values.icon_url,
      organization: (values.organization as unknown as Organization)?.id ?? null,
      provision_workflow:
        (values.provision_workflow as unknown as WorkflowJobTemplate)?.id ?? null,
      terraform_job_template:
        (values.terraform_job_template as unknown as TerraformJobTemplate)?.id ?? null,
      deprovision_workflow:
        (values.deprovision_workflow as unknown as WorkflowJobTemplate)?.id ?? null,
      override_workflow_limit: values.override_workflow_limit,
      extra_vars_schema,
    };
    await requestPatch<typeof payload>(awxAPI`/catalog_items/${id}/`, payload);
    pageNavigate(AwxRoute.CatalogItemPage, { params: { id } });
  };

  return (
    <PageLayout>
      <PageHeader
        title={t('Edit Catalog Item')}
        breadcrumbs={[
          { label: t('Catalog Items') },
          { label: item.name },
          { label: t('Edit') },
        ]}
      />
      <AwxPageForm
        submitText={t('Save catalog item')}
        onSubmit={onSubmit}
        defaultValue={makeDefaultValues(item)}
        onCancel={() => pageNavigate(AwxRoute.CatalogItemPage, { params: { id } })}
      >
        <CatalogItemFormInputs />
      </AwxPageForm>
    </PageLayout>
  );
}

function CatalogItemFormInputs() {
  const { t } = useTranslation();

  return (
    <>
      <PageFormTextInput<CatalogItemFormValues>
        name="name"
        label={t('Name')}
        isRequired
        maxLength={512}
        placeholder={t('Enter catalog item name')}
      />
      <PageFormTextInput<CatalogItemFormValues>
        name="description"
        label={t('Description')}
        placeholder={t('Enter an optional description')}
      />
      <PageFormSelectOrganization<CatalogItemFormValues> name="organization" />
      <PageFormWorkflowJobTemplateSelect<CatalogItemFormValues>
        name="provision_workflow"
      />
      <PageFormTerraformJobTemplateSelect<CatalogItemFormValues>
        name="terraform_job_template"
      />
      <PageFormWorkflowJobTemplateSelect<CatalogItemFormValues>
        name="deprovision_workflow"
        workflowJobTemplatePath="deprovision_workflow"
      />
      <CatalogItemImageUpload />
      <PageFormTextInput<CatalogItemFormValues>
        name="icon_url"
        label={t('Icon URL')}
        placeholder={t('https://example.com/icon.png')}
      />
      <PageFormCheckbox<CatalogItemFormValues>
        name="override_workflow_limit"
        label={t('Override downstream workflow limit')}
        labelHelpTitle={t('Override downstream workflow limit')}
        labelHelp={t(
          'When enabled, deployments force terraform_override_limit=true so workflow-launched job templates can use Terraform-provided host limits.'
        )}
      />
      <PageFormTextArea<CatalogItemFormValues>
        name="extra_vars_schema"
        label={t('Extra variables schema')}
        labelHelpTitle={t('Extra variables schema')}
        labelHelp={t(
          'Optional JSON Schema definition for additional deploy-time fields. Workflow survey questions are pulled live from the provision workflow and merged at launch.'
        )}
        placeholder={'{\n  "type": "object",\n  "properties": {}\n}'}
      />
    </>
  );
}

function CatalogItemImageUpload() {
  const { t } = useTranslation();
  const { control } = useFormContext<CatalogItemFormValues>();
  const { field } = useController({ name: 'icon_data', control });

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => field.onChange(reader.result as string);
    reader.readAsDataURL(file);
  };

  const hasImage = typeof field.value === 'string' && field.value.startsWith('data:image/');

  return (
    <FormGroup label={t('Icon upload')} fieldId="icon_data">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {hasImage && (
          <img
            src={field.value as string}
            alt={t('Catalog icon preview')}
            style={{ width: 64, height: 64, objectFit: 'contain', border: '1px solid var(--pf-v5-global--BorderColor--100)', padding: 4 }}
          />
        )}
        <input
          id="icon_data"
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          onChange={onFileChange}
        />
        {hasImage && (
          <button type="button" onClick={() => field.onChange('')} style={{ width: 'fit-content' }}>
            {t('Remove uploaded icon')}
          </button>
        )}
      </div>
    </FormGroup>
  );
}
