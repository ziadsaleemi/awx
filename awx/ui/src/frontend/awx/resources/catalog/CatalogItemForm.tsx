import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import {
  LoadingPage,
  PageFormSubmitHandler,
  PageHeader,
  PageLayout,
  usePageNavigate,
} from '../../../../framework';
import { PageFormTextInput } from '../../../../framework/PageForm/Inputs/PageFormTextInput';
import { PageFormTextArea } from '../../../../framework/PageForm/Inputs/PageFormTextArea';
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

interface CatalogItemFormValues {
  name: string;
  description: string;
  icon_url: string;
  organization: Organization | null;
  provision_workflow: WorkflowJobTemplate | null;
  terraform_job_template: TerraformJobTemplate | null;
  deprovision_workflow: WorkflowJobTemplate | null;
  extra_vars_schema: string;
}

function makeDefaultValues(item?: CatalogItem): CatalogItemFormValues {
  return {
    name: item?.name ?? '',
    description: item?.description ?? '',
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
      icon_url: values.icon_url,
      organization: (values.organization as unknown as Organization)?.id ?? null,
      provision_workflow:
        (values.provision_workflow as unknown as WorkflowJobTemplate)?.id ?? null,
      terraform_job_template:
        (values.terraform_job_template as unknown as TerraformJobTemplate)?.id ?? null,
      deprovision_workflow:
        (values.deprovision_workflow as unknown as WorkflowJobTemplate)?.id ?? null,
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
      icon_url: values.icon_url,
      organization: (values.organization as unknown as Organization)?.id ?? null,
      provision_workflow:
        (values.provision_workflow as unknown as WorkflowJobTemplate)?.id ?? null,
      terraform_job_template:
        (values.terraform_job_template as unknown as TerraformJobTemplate)?.id ?? null,
      deprovision_workflow:
        (values.deprovision_workflow as unknown as WorkflowJobTemplate)?.id ?? null,
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
      <PageFormTextInput<CatalogItemFormValues>
        name="icon_url"
        label={t('Icon URL')}
        placeholder={t('https://example.com/icon.png')}
      />
      <PageFormTextArea<CatalogItemFormValues>
        name="extra_vars_schema"
        label={t('Extra variables schema')}
        labelHelpTitle={t('Extra variables schema')}
        labelHelp={t(
          'Optional JSON Schema definition for extra variables the user must supply when deploying this catalog item. Leave blank if no extra variables are needed.'
        )}
        placeholder={'{\n  "type": "object",\n  "properties": {}\n}'}
      />
    </>
  );
}
