import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import {
  LoadingPage,
  PageFormSubmitHandler,
  PageHeader,
  PageLayout,
  usePageNavigate,
} from '../../../../framework';
import { PageFormSelect } from '../../../../framework/PageForm/Inputs/PageFormSelect';
import { PageFormTextInput } from '../../../../framework/PageForm/Inputs/PageFormTextInput';
import { requestPatch, postRequest } from '../../../common/crud/Data';
import { useGet } from '../../../common/crud/useGet';
import { AwxPageForm } from '../../common/AwxPageForm';
import { AwxError } from '../../common/AwxError';
import { awxAPI } from '../../common/api/awx-utils';
import { Project } from '../../interfaces/Project';
import {
  QuayImageBuildRuntime,
  QuayImageBuildTemplate,
} from '../../interfaces/QuayImageBuildTemplate';
import { AwxRoute } from '../../main/AwxRoutes';
import { PageFormProjectSelect } from '../projects/components/PageFormProjectSelect';

interface QuayImageBuildTemplateFormValues {
  name: string;
  description: string;
  project: Project | null;
  namespace: string;
  repository: string;
  tag: string;
  runtime: QuayImageBuildRuntime;
  definition_file: string;
  context: string;
}

function getTemplateProject(template?: QuayImageBuildTemplate) {
  if (!template) return null;
  if (template.summary_fields?.project) return template.summary_fields.project as Project;
  if (template.project && typeof template.project === 'object') return template.project as Project;
  return null;
}

function defaultValues(template?: QuayImageBuildTemplate): QuayImageBuildTemplateFormValues {
  return {
    name: template?.name ?? '',
    description: template?.description ?? '',
    project: getTemplateProject(template),
    namespace: template?.namespace ?? '',
    repository: template?.repository ?? '',
    tag: template?.tag ?? 'latest',
    runtime: template?.runtime ?? 'podman',
    definition_file: template?.definition_file ?? 'execution-environment.yml',
    context: template?.context ?? template?.context_path ?? '.',
  };
}

function toPayload(values: QuayImageBuildTemplateFormValues) {
  return {
    name: values.name,
    description: values.description,
    project_id: values.project?.id ?? null,
    namespace: values.namespace,
    repository: values.repository,
    tag: values.tag,
    runtime: values.runtime,
    definition_file: values.definition_file,
    context: values.context,
  };
}

export function CreateQuayImageBuildTemplate() {
  const { t } = useTranslation();
  const pageNavigate = usePageNavigate();

  const onSubmit: PageFormSubmitHandler<QuayImageBuildTemplateFormValues> = async (values) => {
    const created = await postRequest<QuayImageBuildTemplate, ReturnType<typeof toPayload>>(
      awxAPI`/quay/execution-environment-images/templates/`,
      toPayload(values)
    );
    pageNavigate(AwxRoute.QuayImageBuildTemplatePage, { params: { id: created.id } });
  };

  return (
    <PageLayout>
      <PageHeader
        title={t('Create EE Build Template')}
        breadcrumbs={[{ label: t('Templates') }, { label: t('Create EE Build Template') }]}
      />
      <AwxPageForm
        submitText={t('Create EE build template')}
        onSubmit={onSubmit}
        defaultValue={defaultValues()}
        onCancel={() => pageNavigate(AwxRoute.Templates)}
      >
        <QuayImageBuildTemplateFormInputs />
      </AwxPageForm>
    </PageLayout>
  );
}

export function EditQuayImageBuildTemplate() {
  const { t } = useTranslation();
  const pageNavigate = usePageNavigate();
  const params = useParams<{ id: string }>();
  const id = params.id ?? '';
  const {
    data: template,
    error,
    refresh,
  } = useGet<QuayImageBuildTemplate>(
    id ? awxAPI`/quay/execution-environment-images/templates/${id}/` : ''
  );

  if (error) return <AwxError error={error} handleRefresh={refresh} />;
  if (!template) return <LoadingPage />;

  const onSubmit: PageFormSubmitHandler<QuayImageBuildTemplateFormValues> = async (values) => {
    const payload = toPayload(values);
    await requestPatch<typeof payload>(
      awxAPI`/quay/execution-environment-images/templates/${id}/`,
      payload
    );
    pageNavigate(AwxRoute.QuayImageBuildTemplatePage, { params: { id } });
  };

  return (
    <PageLayout>
      <PageHeader
        title={t('Edit EE Build Template')}
        breadcrumbs={[{ label: t('Templates') }, { label: template.name }, { label: t('Edit') }]}
      />
      <AwxPageForm
        submitText={t('Save EE build template')}
        onSubmit={onSubmit}
        defaultValue={defaultValues(template)}
        onCancel={() => pageNavigate(AwxRoute.QuayImageBuildTemplatePage, { params: { id } })}
      >
        <QuayImageBuildTemplateFormInputs />
      </AwxPageForm>
    </PageLayout>
  );
}

function QuayImageBuildTemplateFormInputs() {
  const { t } = useTranslation();
  const runtimeOptions = [
    { value: 'podman', label: t('Podman') },
    { value: 'docker', label: t('Docker') },
  ];

  return (
    <>
      <PageFormTextInput<QuayImageBuildTemplateFormValues>
        name="name"
        label={t('Name')}
        isRequired
        maxLength={512}
        placeholder={t('Add a name for this template')}
      />
      <PageFormTextInput<QuayImageBuildTemplateFormValues>
        name="description"
        label={t('Description')}
        placeholder={t('Add a description for this template')}
      />
      <PageFormProjectSelect<QuayImageBuildTemplateFormValues> name="project" isRequired />
      <PageFormTextInput<QuayImageBuildTemplateFormValues>
        name="namespace"
        label={t('Quay namespace')}
        isRequired
        placeholder={t('Quay organization or user')}
      />
      <PageFormTextInput<QuayImageBuildTemplateFormValues>
        name="repository"
        label={t('Repository')}
        isRequired
        placeholder={t('Repository name')}
      />
      <PageFormTextInput<QuayImageBuildTemplateFormValues>
        name="tag"
        label={t('Tag')}
        isRequired
        placeholder={t('latest')}
      />
      <PageFormSelect<QuayImageBuildTemplateFormValues>
        name="runtime"
        label={t('Container runtime')}
        options={runtimeOptions}
        isRequired
      />
      <PageFormTextInput<QuayImageBuildTemplateFormValues>
        name="definition_file"
        label={t('Definition file')}
        labelHelpTitle={t('Definition file')}
        labelHelp={t(
          'Path inside the AWX Project checkout to the execution environment definition file.'
        )}
        isRequired
        placeholder={t('execution-environment.yml')}
      />
      <PageFormTextInput<QuayImageBuildTemplateFormValues>
        name="context"
        label={t('Build context')}
        labelHelpTitle={t('Build context')}
        labelHelp={t('Directory inside the AWX Project checkout used as the image build context.')}
        isRequired
        placeholder="."
      />
    </>
  );
}
