import { useEffect, useMemo, useRef } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
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
import { AwxItemsResponse } from '../../common/AwxItemsResponse';
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

interface QuayNamespaceOption {
  name: string;
  namespace: string;
  namespace_kind?: string;
}

interface QuayRepositoryOption {
  name: string;
  namespace?: string;
}

interface QuayDefinitionFileOption {
  name: string;
  path: string;
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
    definition_file: template?.definition_file ?? '',
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
  const { resetField, setValue } = useFormContext<QuayImageBuildTemplateFormValues>();
  const namespace = useWatch<QuayImageBuildTemplateFormValues, 'namespace'>({ name: 'namespace' });
  const repository = useWatch<QuayImageBuildTemplateFormValues, 'repository'>({
    name: 'repository',
  });
  const definitionFile = useWatch<QuayImageBuildTemplateFormValues, 'definition_file'>({
    name: 'definition_file',
  });
  const project = useWatch<QuayImageBuildTemplateFormValues, 'project'>({ name: 'project' });
  const projectId = project?.id;
  const previousNamespace = useRef(namespace);
  const previousProjectId = useRef(projectId);
  const { data: namespaces, isLoading: isLoadingNamespaces } = useGet<
    AwxItemsResponse<QuayNamespaceOption>
  >(awxAPI`/quay/namespaces/`);
  const { data: repositories, isLoading: isLoadingRepositories } = useGet<
    AwxItemsResponse<QuayRepositoryOption>
  >(namespace ? awxAPI`/quay/repositories/` : undefined, { namespace, page_size: 100 });
  const { data: definitionFiles, isLoading: isLoadingDefinitionFiles } = useGet<
    AwxItemsResponse<QuayDefinitionFileOption>
  >(projectId ? awxAPI`/quay/execution-environment-images/definition-files/` : undefined, {
    project_id: projectId ?? '',
  });

  const namespaceOptions = useMemo(
    () =>
      namespaces?.results.map((namespace) => ({
        value: namespace.name || namespace.namespace,
        label: namespace.name || namespace.namespace,
      })) ?? [],
    [namespaces?.results]
  );
  const repositoryOptions = useMemo(
    () =>
      repositories?.results.map((repository) => ({
        value: repository.name,
        label: repository.name,
      })) ?? [],
    [repositories?.results]
  );
  const definitionFileOptions = useMemo(
    () =>
      definitionFiles?.results.map((file) => ({
        value: file.path || file.name,
        label: file.path || file.name,
      })) ?? [],
    [definitionFiles?.results]
  );
  const runtimeOptions = [
    { value: 'podman', label: t('Podman') },
    { value: 'docker', label: t('Docker') },
  ];

  useEffect(() => {
    if (previousNamespace.current !== namespace) {
      resetField('repository', { defaultValue: '' });
      previousNamespace.current = namespace;
    }
  }, [namespace, resetField]);

  useEffect(() => {
    if (previousProjectId.current !== projectId) {
      resetField('definition_file', { defaultValue: '' });
      previousProjectId.current = projectId;
    }
  }, [projectId, resetField]);

  useEffect(() => {
    if (!namespace && namespaceOptions.length === 1) {
      setValue('namespace', namespaceOptions[0].value);
    }
  }, [namespace, namespaceOptions, setValue]);

  useEffect(() => {
    if (!repository && repositoryOptions.length === 1) {
      setValue('repository', repositoryOptions[0].value);
    }
  }, [repository, repositoryOptions, setValue]);

  useEffect(() => {
    if (!definitionFile && definitionFileOptions.length === 1) {
      setValue('definition_file', definitionFileOptions[0].value);
    }
  }, [definitionFile, definitionFileOptions, setValue]);

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
      <PageFormSelect<QuayImageBuildTemplateFormValues>
        name="namespace"
        label={t('Quay namespace')}
        isRequired={Boolean(namespace) || namespaceOptions.length !== 1}
        options={namespaceOptions}
        placeholderText={
          isLoadingNamespaces ? t('Loading Quay namespaces...') : t('Select namespace')
        }
        helperText={t(
          'Namespaces are loaded from the configured Project Quay user and organizations.'
        )}
      />
      <PageFormSelect<QuayImageBuildTemplateFormValues>
        name="repository"
        label={t('Repository')}
        isRequired={Boolean(repository) || repositoryOptions.length !== 1}
        options={repositoryOptions}
        placeholderText={
          !namespace
            ? t('Select a namespace first')
            : isLoadingRepositories
              ? t('Loading repositories...')
              : t('Select repository')
        }
        helperText={t('Repositories are loaded from the selected Project Quay namespace.')}
        isDisabled={!namespace}
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
      <PageFormSelect<QuayImageBuildTemplateFormValues>
        name="definition_file"
        label={t('Definition file')}
        labelHelpTitle={t('Definition file')}
        labelHelp={t(
          'Path inside the AWX Project checkout to the execution environment definition file.'
        )}
        isRequired={Boolean(definitionFile) || definitionFileOptions.length !== 1}
        options={definitionFileOptions}
        placeholderText={
          !projectId
            ? t('Select a project first')
            : isLoadingDefinitionFiles
              ? t('Loading definition files...')
              : t('Select definition file')
        }
        helperText={t('Definition files are discovered from YAML files in the selected Project.')}
        isDisabled={!projectId}
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
