import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActionGroup,
  Alert,
  Button,
  ButtonVariant,
  ClipboardCopy,
  Form,
  FormGroup,
  FormSelect,
  FormSelectOption,
  Label,
  PageSection,
  Progress,
  ProgressSize,
  Spinner,
  Stack,
  StackItem,
  Tab,
  Tabs,
  TabTitleText,
  TextInput,
} from '@patternfly/react-core';
import {
  CaretLeftIcon,
  PencilAltIcon,
  PlusCircleIcon,
  RocketIcon,
  SyncAltIcon,
  TrashIcon,
} from '@patternfly/react-icons';
import { DropdownPosition } from '@patternfly/react-core/deprecated';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { useSearchParams } from 'react-router-dom';
import {
  DateTimeCell,
  IPageAction,
  ITableColumn,
  IToolbarFilter,
  PageActionSelection,
  PageActionType,
  PageActions,
  PageDetail,
  PageDetails,
  PageHeader,
  PageLayout,
  PageTable,
  TextCell,
  ToolbarFilterType,
  usePageAlertToaster,
} from '../../../../framework';
import { TeamAccess } from '../../../common/access/components/TeamAccess';
import { UserAccess } from '../../../common/access/components/UserAccess';
import { postRequest, requestDelete, requestGet, requestPatch } from '../../../common/crud/Data';
import { useGet } from '../../../common/crud/useGet';
import { AwxItemsResponse } from '../../common/AwxItemsResponse';
import { ModuleAIAssistantAction } from '../../common/ModuleAIAssistantAction';
import { awxAPI } from '../../common/api/awx-utils';
import { useAwxView } from '../../common/useAwxView';
import { AwxRoute } from '../../main/AwxRoutes';
import { ResourceNotifications } from '../notifications/ResourceNotifications';
import { SchedulesList } from '../../views/schedules/SchedulesList';
import { QuayStatus } from './QuayStatus';

type ContainerRuntime = 'podman' | 'docker';
type PageMode = 'list' | 'form' | 'details';
type DetailsTabKey =
  | 'details'
  | 'team-access'
  | 'user-access'
  | 'schedules'
  | 'jobs'
  | 'notifications'
  | 'tags';

interface QuayBuildTemplatePayload {
  name: string;
  description: string;
  project_id: number;
  namespace: string;
  repository: string;
  tag: string;
  runtime: ContainerRuntime;
  definition_file: string;
  context: string;
}

interface QuayImageBuild {
  id: number;
  url: string;
  created: string;
  modified?: string;
  project: {
    id: number;
    name: string;
    path: string;
    scm_revision: string;
  };
  template?: {
    id: number;
    name: string;
  };
  namespace: string;
  repository: string;
  repository_path: string;
  tag: string;
  image: string;
  runtime: ContainerRuntime;
  definition_file: string;
  context: string;
  status: string;
  progress: number;
  started?: string;
  finished?: string;
  error?: string;
  log?: string;
  command_summary?: {
    label?: string;
    command?: string;
    working_directory?: string;
  }[];
}

interface QuayBuildTemplate {
  id: number;
  url: string;
  launch_url: string;
  created: string;
  modified: string;
  name: string;
  description: string;
  project: {
    id: number;
    name: string;
    organization?: {
      id: number;
      name: string;
    } | null;
  };
  namespace: string;
  repository: string;
  repository_path: string;
  tag: string;
  image: string;
  runtime: ContainerRuntime;
  definition_file: string;
  context: string;
  latest_build?: QuayImageBuild | null;
}

interface QuayImageTag {
  id: number;
  name?: string;
  manifest_digest?: string;
  size?: number;
  last_modified?: string;
  start_ts?: number;
  end_ts?: number;
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

interface AwxProject {
  id: number;
  name: string;
  local_path?: string;
  scm_type?: string;
  scm_url?: string;
  scm_branch?: string;
  status?: string;
}

function formatBytes(value?: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MiB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GiB`;
}

function timestampFromTag(tag: QuayImageTag) {
  if (tag.last_modified) return tag.last_modified;
  const timestamp = tag.end_ts || tag.start_ts;
  return timestamp ? new Date(timestamp * 1000).toISOString() : '-';
}

function formatDate(value?: string) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function statusText(status?: string) {
  if (!status) return 'Never run';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function buildStatusColor(status?: string): 'blue' | 'green' | 'orange' | 'red' | 'grey' {
  if (status === 'successful') return 'green';
  if (status === 'failed') return 'red';
  if (status === 'canceled') return 'grey';
  if (status === 'pending') return 'orange';
  return 'blue';
}

function isDetailsTabKey(value: string | null): value is DetailsTabKey {
  return (
    value === 'details' ||
    value === 'team-access' ||
    value === 'user-access' ||
    value === 'schedules' ||
    value === 'jobs' ||
    value === 'notifications' ||
    value === 'tags'
  );
}

export function QuayExecutionEnvironmentImages() {
  const { t } = useTranslation();
  const alertToaster = usePageAlertToaster();
  const [searchParams, setSearchParams] = useSearchParams();
  const status = useGet<QuayStatus>(awxAPI`/quay/status/`);
  const projects = useGet<AwxItemsResponse<AwxProject>>(
    awxAPI`/projects/`,
    { page_size: 200, order_by: 'name' },
    { revalidateOnFocus: false }
  );
  const builds = useGet<AwxItemsResponse<QuayImageBuild>>(
    awxAPI`/quay/execution-environment-images/builds/`,
    { page_size: 10 },
    { revalidateOnFocus: false, refreshInterval: 5000 }
  );

  const [mode, setMode] = useState<PageMode>('list');
  const [activeTab, setActiveTab] = useState<DetailsTabKey>('details');
  const [editingTemplateId, setEditingTemplateId] = useState<number>();
  const [selectedTemplateId, setSelectedTemplateId] = useState<number>();
  const [selectedTemplateSnapshot, setSelectedTemplateSnapshot] = useState<QuayBuildTemplate>();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [namespace, setNamespace] = useState('');
  const [repository, setRepository] = useState('custom-ee');
  const [tag, setTag] = useState('latest');
  const [runtime, setRuntime] = useState<ContainerRuntime>('podman');
  const [definitionFile, setDefinitionFile] = useState('execution-environment.yml');
  const [contextPath, setContextPath] = useState('.');
  const [isSaving, setIsSaving] = useState(false);
  const [launchingTemplateId, setLaunchingTemplateId] = useState<number>();
  const [deletingTemplateId, setDeletingTemplateId] = useState<number>();
  const [selectedBuildId, setSelectedBuildId] = useState<number>();
  const [selectedBuildSnapshot, setSelectedBuildSnapshot] = useState<QuayImageBuild>();

  const configured = Boolean(status.data?.configured && status.data.registry);
  const projectOptions = useMemo(() => projects.data?.results ?? [], [projects.data?.results]);
  const buildItems = useMemo(() => builds.data?.results ?? [], [builds.data?.results]);
  const toolbarFilters = useQuayBuildTemplateFilters();
  const view = useAwxView<QuayBuildTemplate>({
    url: awxAPI`/quay/execution-environment-images/templates/`,
    toolbarFilters,
    defaultSort: 'name',
    disableQueryString: true,
  });
  const templateItems = useMemo(() => view.pageItems ?? [], [view.pageItems]);
  const selectedTemplate = useMemo(
    () =>
      templateItems.find((template) => template.id === selectedTemplateId) ??
      selectedTemplateSnapshot,
    [selectedTemplateId, selectedTemplateSnapshot, templateItems]
  );
  const selectedTemplateBuilds = useMemo(() => {
    if (!selectedTemplate) return [];
    const items = buildItems.filter((build) => build.template?.id === selectedTemplate.id);
    if (
      selectedBuildSnapshot?.template?.id === selectedTemplate.id &&
      !items.some((build) => build.id === selectedBuildSnapshot.id)
    ) {
      return [selectedBuildSnapshot, ...items];
    }
    return items;
  }, [buildItems, selectedBuildSnapshot, selectedTemplate]);
  const editingTemplate = useMemo(
    () =>
      templateItems.find((template) => template.id === editingTemplateId) ??
      (selectedTemplateSnapshot?.id === editingTemplateId ? selectedTemplateSnapshot : undefined),
    [editingTemplateId, selectedTemplateSnapshot, templateItems]
  );
  const effectiveNamespace = namespace.trim() || status.data?.namespace || '';
  const shouldLoadFormChoices = mode === 'form';
  const namespaces = useGet<AwxItemsResponse<QuayNamespaceOption>>(
    configured && shouldLoadFormChoices ? awxAPI`/quay/namespaces/` : undefined,
    undefined,
    { revalidateOnFocus: false }
  );
  const repositories = useGet<AwxItemsResponse<QuayRepositoryOption>>(
    configured && shouldLoadFormChoices && effectiveNamespace
      ? awxAPI`/quay/repositories/`
      : undefined,
    configured && shouldLoadFormChoices && effectiveNamespace
      ? { namespace: effectiveNamespace, page_size: 100, order_by: 'name' }
      : undefined,
    { revalidateOnFocus: false }
  );
  const definitionFiles = useGet<AwxItemsResponse<QuayDefinitionFileOption>>(
    shouldLoadFormChoices && selectedProjectId
      ? awxAPI`/quay/execution-environment-images/definition-files/`
      : undefined,
    shouldLoadFormChoices && selectedProjectId ? { project_id: selectedProjectId } : undefined,
    { revalidateOnFocus: false }
  );
  const tagNamespace = selectedTemplate?.namespace || effectiveNamespace;
  const tagRepository = selectedTemplate?.repository || repository.trim();
  const canLoadTags = Boolean(status.data?.auth_configured);
  const canManageTags = Boolean(status.data?.can_manage && status.data?.management_configured);
  const shouldLoadTags =
    configured &&
    canLoadTags &&
    mode === 'details' &&
    Boolean(tagNamespace) &&
    Boolean(tagRepository);
  const tags = useGet<AwxItemsResponse<QuayImageTag>>(
    shouldLoadTags ? awxAPI`/quay/tags/` : undefined,
    shouldLoadTags
      ? { namespace: tagNamespace, repository: tagRepository, page_size: 20 }
      : undefined,
    { revalidateOnFocus: false }
  );

  useEffect(() => {
    if (!selectedProjectId && projectOptions.length) {
      setSelectedProjectId(String(projectOptions[0].id));
    }
  }, [projectOptions, selectedProjectId]);

  useEffect(() => {
    if (!namespace && status.data?.namespace) {
      setNamespace(status.data.namespace);
    }
  }, [namespace, status.data?.namespace]);

  const resetForm = () => {
    setEditingTemplateId(undefined);
    setName('');
    setDescription('');
    setSelectedProjectId(projectOptions.length ? String(projectOptions[0].id) : '');
    setNamespace(status.data?.namespace || '');
    setRepository('');
    setTag('latest');
    setRuntime('podman');
    setDefinitionFile('');
    setContextPath('.');
  };

  const showList = () => {
    setMode('list');
    setActiveTab('details');
    setSelectedTemplateId(undefined);
    setSelectedTemplateSnapshot(undefined);
    resetForm();
  };

  const showCreate = () => {
    resetForm();
    setMode('form');
  };

  const showDetails = useCallback((template: QuayBuildTemplate, tab: DetailsTabKey = 'details') => {
    setSelectedTemplateId(template.id);
    setSelectedTemplateSnapshot(template);
    setActiveTab(tab);
    if (tab === 'jobs' && template.latest_build?.id) {
      setSelectedBuildId(template.latest_build.id);
      setSelectedBuildSnapshot(template.latest_build);
    }
    setMode('details');
  }, []);

  const showEdit = (template: QuayBuildTemplate) => {
    setEditingTemplateId(template.id);
    setName(template.name);
    setDescription(template.description || '');
    setSelectedProjectId(template.project.id ? String(template.project.id) : '');
    setNamespace(template.namespace);
    setRepository(template.repository);
    setTag(template.tag);
    setRuntime(template.runtime);
    setDefinitionFile(template.definition_file);
    setContextPath(template.context);
    setMode('form');
  };

  useEffect(() => {
    const templateId = Number(searchParams.get('template'));
    if (!templateId || Number.isNaN(templateId) || !templateItems.length) return;
    const template = templateItems.find((item) => item.id === templateId);
    if (!template) return;
    const requestedTab = searchParams.get('tab');
    showDetails(template, isDetailsTabKey(requestedTab) ? requestedTab : 'details');
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams, showDetails, templateItems]);

  const buildPayload = (): QuayBuildTemplatePayload => ({
    name: name.trim(),
    description: description.trim(),
    project_id: Number(selectedProjectId),
    namespace: effectiveNamespace,
    repository: repository.trim(),
    tag: tag.trim() || 'latest',
    runtime,
    definition_file: definitionFile.trim(),
    context: contextPath.trim() || '.',
  });

  const saveTemplate = async () => {
    if (
      !name.trim() ||
      !selectedProjectId ||
      !effectiveNamespace ||
      !repository.trim() ||
      !definitionFile.trim()
    ) {
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Name, project, namespace, repository, and definition file are required.'),
      });
      return;
    }
    setIsSaving(true);
    try {
      const payload = buildPayload();
      const saved = editingTemplateId
        ? await requestPatch<QuayBuildTemplate, QuayBuildTemplatePayload>(
            `${awxAPI`/quay/execution-environment-images/templates/`}${editingTemplateId}/`,
            payload
          )
        : await postRequest<QuayBuildTemplate, QuayBuildTemplatePayload>(
            awxAPI`/quay/execution-environment-images/templates/`,
            payload
          );
      await view.refresh();
      showDetails(saved);
      alertToaster.addAlert({
        variant: 'success',
        title: editingTemplateId ? t('EE build template updated.') : t('EE build template saved.'),
        timeout: 3000,
      });
    } catch (err) {
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Unable to save EE build template'),
        children: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const launchTemplate = async (template: QuayBuildTemplate) => {
    setLaunchingTemplateId(template.id);
    try {
      const build = await postRequest<QuayImageBuild, Record<string, never>>(
        template.launch_url,
        {}
      );
      setSelectedBuildId(build.id);
      setSelectedBuildSnapshot(build);
      await Promise.all([view.refresh(), builds.refresh()]);
      showDetails({ ...template, latest_build: build }, 'jobs');
      alertToaster.addAlert({
        variant: 'success',
        title: t('EE image build queued.'),
        timeout: 3000,
      });
    } catch (err) {
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Unable to launch EE build template'),
        children: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLaunchingTemplateId(undefined);
    }
  };

  const deleteTemplate = async (template: QuayBuildTemplate) => {
    setDeletingTemplateId(template.id);
    try {
      const controller = new AbortController();
      await requestDelete<null>(template.url, controller.signal);
      await view.refresh();
      if (selectedTemplateId === template.id) showList();
      alertToaster.addAlert({
        variant: 'success',
        title: t('EE build template deleted.'),
        timeout: 3000,
      });
    } catch (err) {
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Unable to delete EE build template'),
        children: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setDeletingTemplateId(undefined);
    }
  };

  const deleteTag = async (imageTag: QuayImageTag) => {
    if (!imageTag.name || !selectedTemplate) return;
    try {
      await postRequest<
        {
          source: string;
          action: string;
          namespace: string;
          repository: string;
          tag: string;
        },
        { namespace: string; repository: string; tag: string }
      >(awxAPI`/quay/tags/delete/`, {
        namespace: selectedTemplate.namespace,
        repository: selectedTemplate.repository,
        tag: imageTag.name,
      });
      alertToaster.addAlert({
        variant: 'success',
        title: t('Project Quay tag {{tag}} deleted.', { tag: imageTag.name }),
        timeout: 4000,
      });
      tags.refresh();
    } catch (err) {
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Failed to delete Project Quay image tag'),
        children: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const tableColumns = useQuayBuildTemplateColumns(showDetails);
  const toolbarActions = useQuayBuildTemplateToolbarActions({
    configured,
    onCreate: showCreate,
    onRefresh: () => {
      void view.refresh();
      builds.refresh();
      status.refresh();
    },
  });
  const rowActions = useQuayBuildTemplateRowActions({
    pushConfigured: Boolean(status.data?.push_configured),
    launchingTemplateId,
    deletingTemplateId,
    onLaunch: (template) => void launchTemplate(template),
    onEdit: showEdit,
    onDelete: (template) => void deleteTemplate(template),
  });
  const detailsActions = rowActions;

  const pageTitle =
    mode === 'form'
      ? editingTemplate
        ? t('Edit {{name}}', { name: editingTemplate.name })
        : t('Create EE Build Template')
      : mode === 'details' && selectedTemplate
        ? selectedTemplate.name
        : t('EE Build Templates');

  return (
    <PageLayout>
      <PageHeader
        title={pageTitle}
        titleHelpTitle={mode === 'list' ? t('EE Build Templates') : undefined}
        titleHelp={
          mode === 'list'
            ? t(
                'An EE build template is a reusable Capstan Project-backed definition for building and pushing an execution environment image to Project Quay.'
              )
            : undefined
        }
        description={
          mode === 'list'
            ? t(
                'An EE build template is a definition and set of parameters for building a Capstan execution environment image.'
              )
            : undefined
        }
        breadcrumbs={
          mode === 'list' ? undefined : [{ label: t('Templates') }, { label: pageTitle }]
        }
        headerActions={
          mode === 'details' && selectedTemplate ? (
            <>
              <PageActions<QuayBuildTemplate>
                actions={detailsActions}
                selectedItem={selectedTemplate}
                position={DropdownPosition.right}
              />
              <ModuleAIAssistantAction
                module="quay"
                page={t('Project Quay EE Build Template')}
                prompt={t(
                  'Help with this Project Quay execution environment build template. Use the selected project, namespace, repository, build runs, tags, and my Capstan permissions. Explain how to launch, troubleshoot, and use the resulting image in Capstan job templates.'
                )}
                context={{
                  registry: status.data?.registry,
                  namespace: selectedTemplate.namespace,
                  repository: selectedTemplate.repository,
                  template_id: selectedTemplate.id,
                }}
              />
            </>
          ) : (
            <ModuleAIAssistantAction
              module="quay"
              page={t('Project Quay EE Build Templates')}
              prompt={t(
                'Help with Project Quay execution environment build templates in Capstan. Explain how to save reusable builds, launch them, troubleshoot failures, and use resulting images in job templates.'
              )}
              context={{ registry: status.data?.registry, namespace: status.data?.namespace }}
            />
          )
        }
      />
      {mode === 'list' ? (
        <ListView
          configured={configured}
          status={status}
          view={view}
          toolbarFilters={toolbarFilters}
          tableColumns={tableColumns}
          toolbarActions={toolbarActions}
          rowActions={rowActions}
          onCreate={showCreate}
        />
      ) : mode === 'form' ? (
        <FormView
          configured={configured}
          projects={projects}
          projectOptions={projectOptions}
          namespaces={namespaces}
          repositories={repositories}
          definitionFiles={definitionFiles}
          status={status}
          name={name}
          setName={setName}
          description={description}
          setDescription={setDescription}
          selectedProjectId={selectedProjectId}
          setSelectedProjectId={setSelectedProjectId}
          namespace={effectiveNamespace}
          setNamespace={setNamespace}
          repository={repository}
          setRepository={setRepository}
          tag={tag}
          setTag={setTag}
          runtime={runtime}
          setRuntime={setRuntime}
          definitionFile={definitionFile}
          setDefinitionFile={setDefinitionFile}
          contextPath={contextPath}
          setContextPath={setContextPath}
          isSaving={isSaving}
          editing={Boolean(editingTemplateId)}
          onSubmit={() => void saveTemplate()}
          onCancel={() => {
            if (editingTemplate) showDetails(editingTemplate);
            else showList();
          }}
        />
      ) : selectedTemplate ? (
        <DetailsView
          template={selectedTemplate}
          builds={selectedTemplateBuilds}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          selectedBuildId={selectedBuildId}
          setSelectedBuildId={setSelectedBuildId}
          selectedBuildSnapshot={selectedBuildSnapshot}
          setSelectedBuildSnapshot={setSelectedBuildSnapshot}
          onRefreshBuilds={() => void builds.refresh()}
          tags={tags}
          canLoadTags={canLoadTags}
          canManageTags={canManageTags}
          onBack={showList}
          onDeleteTag={(imageTag) => void deleteTag(imageTag)}
        />
      ) : (
        <PageSection>
          <Alert isInline variant="warning" title={t('EE build template was not found.')} />
        </PageSection>
      )}
    </PageLayout>
  );
}

function useQuayBuildTemplateFilters(): IToolbarFilter[] {
  const { t } = useTranslation();
  return useMemo(
    () => [
      {
        key: 'search',
        label: t('Search'),
        type: ToolbarFilterType.MultiText,
        query: 'search',
        comparison: 'contains',
      },
    ],
    [t]
  );
}

function useQuayBuildTemplateColumns(
  onDetails: (template: QuayBuildTemplate, tab?: DetailsTabKey) => void
): ITableColumn<QuayBuildTemplate>[] {
  const { t } = useTranslation();
  return useMemo(
    () => [
      {
        header: t('Name'),
        cell: (template) => (
          <div>
            <Button variant="link" isInline onClick={() => onDetails(template)}>
              {template.name}
            </Button>
            {template.description ? (
              <div style={{ color: 'var(--pf-v5-global--Color--200)', marginTop: 8 }}>
                {template.description}
              </div>
            ) : null}
          </div>
        ),
        card: 'name',
        list: 'name',
      },
      {
        header: t('Type'),
        cell: () => <TextCell text={t('EE build template')} />,
      },
      {
        header: t('Organization'),
        cell: (template) => <TextCell text={template.project.organization?.name || '-'} />,
      },
      {
        header: t('Last run'),
        cell: (template) => (
          <TextCell
            text={
              template.latest_build
                ? `${statusText(template.latest_build.status)}${
                    template.latest_build.finished
                      ? ` - ${formatDate(template.latest_build.finished)}`
                      : ''
                  }`
                : statusText()
            }
          />
        ),
      },
      {
        header: t('Last modified'),
        cell: (template) => <DateTimeCell value={template.modified} />,
      },
    ],
    [onDetails, t]
  );
}

function useQuayBuildTemplateToolbarActions(props: {
  configured: boolean;
  onCreate: () => void;
  onRefresh: () => void;
}): IPageAction<QuayBuildTemplate>[] {
  const { t } = useTranslation();
  return useMemo(
    () => [
      {
        type: PageActionType.Button,
        selection: PageActionSelection.None,
        icon: PlusCircleIcon,
        variant: ButtonVariant.primary,
        label: t('Create template'),
        isPinned: true,
        onClick: props.onCreate,
        isDisabled: props.configured
          ? undefined
          : t('Configure Project Quay before creating EE build templates.'),
      },
      {
        type: PageActionType.Button,
        selection: PageActionSelection.None,
        icon: SyncAltIcon,
        label: t('Refresh'),
        onClick: props.onRefresh,
      },
    ],
    [props.configured, props.onCreate, props.onRefresh, t]
  );
}

function useQuayBuildTemplateRowActions(props: {
  pushConfigured: boolean;
  launchingTemplateId?: number;
  deletingTemplateId?: number;
  onLaunch: (template: QuayBuildTemplate) => void;
  onEdit: (template: QuayBuildTemplate) => void;
  onDelete: (template: QuayBuildTemplate) => void;
}): IPageAction<QuayBuildTemplate>[] {
  const { t } = useTranslation();
  return useMemo(
    () => [
      {
        type: PageActionType.Button,
        selection: PageActionSelection.Single,
        icon: RocketIcon,
        label: t('Launch template'),
        variant: ButtonVariant.primary,
        isPinned: true,
        onClick: props.onLaunch,
        isDisabled: (template) => {
          if (props.launchingTemplateId === template.id)
            return t('Template launch is already queued.');
          return props.pushConfigured
            ? undefined
            : t('Configure Project Quay push credentials before launching this template.');
        },
      },
      {
        type: PageActionType.Button,
        selection: PageActionSelection.Single,
        icon: PencilAltIcon,
        label: t('Edit template'),
        isPinned: true,
        onClick: props.onEdit,
      },
      {
        type: PageActionType.Button,
        selection: PageActionSelection.Single,
        icon: TrashIcon,
        label: t('Delete template'),
        isDanger: true,
        onClick: props.onDelete,
        isDisabled: (template) =>
          props.deletingTemplateId === template.id ? t('Template is being deleted.') : undefined,
      },
    ],
    [
      props.deletingTemplateId,
      props.launchingTemplateId,
      props.onDelete,
      props.onEdit,
      props.onLaunch,
      props.pushConfigured,
      t,
    ]
  );
}

function ListView(props: {
  configured: boolean;
  status: ReturnType<typeof useGet<QuayStatus>>;
  view: ReturnType<typeof useAwxView<QuayBuildTemplate>>;
  toolbarFilters: IToolbarFilter[];
  tableColumns: ITableColumn<QuayBuildTemplate>[];
  toolbarActions: IPageAction<QuayBuildTemplate>[];
  rowActions: IPageAction<QuayBuildTemplate>[];
  onCreate: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <StackAlert status={props.status} />
      <PageTable<QuayBuildTemplate>
        id="quay-ee-build-templates-table"
        toolbarFilters={props.toolbarFilters}
        toolbarActions={props.toolbarActions}
        tableColumns={props.tableColumns}
        rowActions={props.rowActions}
        emptyStateActions={props.configured ? props.toolbarActions.slice(0, 1) : undefined}
        errorStateTitle={t('Error loading EE build templates')}
        emptyStateTitle={t('No EE build templates found')}
        emptyStateDescription={t(
          'Create a template to save the Capstan Project, Quay image, tag, and build paths.'
        )}
        emptyStateButtonIcon={<PlusCircleIcon />}
        emptyStateButtonText={props.configured ? t('Create template') : undefined}
        emptyStateButtonClick={props.configured ? props.onCreate : undefined}
        {...props.view}
      />
    </>
  );
}

function FormView(props: {
  configured: boolean;
  projects: ReturnType<typeof useGet<AwxItemsResponse<AwxProject>>>;
  projectOptions: AwxProject[];
  namespaces: ReturnType<typeof useGet<AwxItemsResponse<QuayNamespaceOption>>>;
  repositories: ReturnType<typeof useGet<AwxItemsResponse<QuayRepositoryOption>>>;
  definitionFiles: ReturnType<typeof useGet<AwxItemsResponse<QuayDefinitionFileOption>>>;
  status: ReturnType<typeof useGet<QuayStatus>>;
  name: string;
  setName: (value: string) => void;
  description: string;
  setDescription: (value: string) => void;
  selectedProjectId: string;
  setSelectedProjectId: (value: string) => void;
  namespace: string;
  setNamespace: (value: string) => void;
  repository: string;
  setRepository: (value: string) => void;
  tag: string;
  setTag: (value: string) => void;
  runtime: ContainerRuntime;
  setRuntime: (value: ContainerRuntime) => void;
  definitionFile: string;
  setDefinitionFile: (value: string) => void;
  contextPath: string;
  setContextPath: (value: string) => void;
  isSaving: boolean;
  editing: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const namespaceOptions = useMemo(() => {
    const items = props.namespaces.data?.results ?? [];
    const options = items.map((item) => item.name || item.namespace).filter(Boolean);
    if (props.namespace && !options.includes(props.namespace)) options.unshift(props.namespace);
    return options;
  }, [props.namespace, props.namespaces.data?.results]);
  const repositoryOptions = useMemo(() => {
    const options = (props.repositories.data?.results ?? [])
      .map((item) => item.name)
      .filter(Boolean);
    if (props.repository && !options.includes(props.repository)) options.unshift(props.repository);
    return options;
  }, [props.repositories.data?.results, props.repository]);
  const definitionFileOptions = useMemo(() => {
    const options = (props.definitionFiles.data?.results ?? [])
      .map((item) => item.path || item.name)
      .filter(Boolean);
    if (props.definitionFile && !options.includes(props.definitionFile)) {
      options.unshift(props.definitionFile);
    }
    return options;
  }, [props.definitionFile, props.definitionFiles.data?.results]);

  return (
    <PageSection>
      <StackAlert status={props.status} />
      <div style={{ maxWidth: 960 }}>
        <Form>
          <FormGroup label={t('Name')} fieldId="name" isRequired>
            <TextInput id="name" value={props.name} onChange={(_, value) => props.setName(value)} />
          </FormGroup>
          <FormGroup label={t('Description')} fieldId="description">
            <TextInput
              id="description"
              value={props.description}
              onChange={(_, value) => props.setDescription(value)}
            />
          </FormGroup>
          <FormGroup label={t('Capstan Project')} fieldId="project" isRequired>
            <FormSelect
              id="project"
              value={props.selectedProjectId}
              onChange={(_, value) => {
                props.setSelectedProjectId(value);
                props.setDefinitionFile('');
              }}
            >
              <FormSelectOption
                value=""
                label={
                  props.projects.isLoading
                    ? t('Loading projects...')
                    : props.projectOptions.length
                      ? t('Select a project')
                      : t('No readable projects found')
                }
              />
              {props.projectOptions.map((project) => (
                <FormSelectOption
                  key={project.id}
                  value={String(project.id)}
                  label={project.name}
                />
              ))}
            </FormSelect>
          </FormGroup>
          <FormGroup label={t('Quay namespace')} fieldId="namespace" isRequired>
            <FormSelect
              id="namespace"
              value={props.namespace}
              onChange={(_, value) => {
                props.setNamespace(value);
                props.setRepository('');
              }}
            >
              <FormSelectOption
                value=""
                label={
                  props.namespaces.isLoading
                    ? t('Loading Quay namespaces...')
                    : namespaceOptions.length
                      ? t('Select namespace')
                      : t('No Quay namespaces found')
                }
              />
              {namespaceOptions.map((namespace) => (
                <FormSelectOption key={namespace} value={namespace} label={namespace} />
              ))}
            </FormSelect>
          </FormGroup>
          <FormGroup label={t('Repository')} fieldId="repository" isRequired>
            <FormSelect
              id="repository"
              value={props.repository}
              onChange={(_, value) => props.setRepository(value)}
              isDisabled={!props.namespace}
            >
              <FormSelectOption
                value=""
                label={
                  !props.namespace
                    ? t('Select a namespace first')
                    : props.repositories.isLoading
                      ? t('Loading repositories...')
                      : repositoryOptions.length
                        ? t('Select repository')
                        : t('No repositories found')
                }
              />
              {repositoryOptions.map((repository) => (
                <FormSelectOption key={repository} value={repository} label={repository} />
              ))}
            </FormSelect>
          </FormGroup>
          <FormGroup label={t('Tag')} fieldId="tag" isRequired>
            <TextInput id="tag" value={props.tag} onChange={(_, value) => props.setTag(value)} />
          </FormGroup>
          <FormGroup label={t('Container runtime')} fieldId="runtime">
            <FormSelect
              id="runtime"
              value={props.runtime}
              onChange={(_, value) => props.setRuntime(value as ContainerRuntime)}
            >
              <FormSelectOption value="podman" label={t('Podman')} />
              <FormSelectOption value="docker" label={t('Docker')} />
            </FormSelect>
          </FormGroup>
          <FormGroup label={t('Definition file')} fieldId="definition_file" isRequired>
            <FormSelect
              id="definition_file"
              value={props.definitionFile}
              onChange={(_, value) => props.setDefinitionFile(value)}
              isDisabled={!props.selectedProjectId}
            >
              <FormSelectOption
                value=""
                label={
                  !props.selectedProjectId
                    ? t('Select a project first')
                    : props.definitionFiles.isLoading
                      ? t('Loading definition files...')
                      : definitionFileOptions.length
                        ? t('Select definition file')
                        : t('No execution environment definition files found')
                }
              />
              {definitionFileOptions.map((definitionFile) => (
                <FormSelectOption
                  key={definitionFile}
                  value={definitionFile}
                  label={definitionFile}
                />
              ))}
            </FormSelect>
          </FormGroup>
          <FormGroup label={t('Build context')} fieldId="context" isRequired>
            <TextInput
              id="context"
              value={props.contextPath}
              onChange={(_, value) => props.setContextPath(value)}
            />
          </FormGroup>
          <ActionGroup>
            <Button
              variant="primary"
              isLoading={props.isSaving}
              isDisabled={
                !props.configured ||
                props.isSaving ||
                !props.name.trim() ||
                !props.selectedProjectId ||
                !props.namespace ||
                !props.repository.trim() ||
                !props.definitionFile.trim()
              }
              onClick={props.onSubmit}
            >
              {props.editing ? t('Save template') : t('Create template')}
            </Button>
            <Button variant="link" onClick={props.onCancel}>
              {t('Cancel')}
            </Button>
          </ActionGroup>
        </Form>
      </div>
    </PageSection>
  );
}

function DetailsView(props: {
  template: QuayBuildTemplate;
  builds: QuayImageBuild[];
  activeTab: DetailsTabKey;
  setActiveTab: (tab: DetailsTabKey) => void;
  selectedBuildId?: number;
  setSelectedBuildId: (id?: number) => void;
  selectedBuildSnapshot?: QuayImageBuild;
  setSelectedBuildSnapshot: (build?: QuayImageBuild) => void;
  onRefreshBuilds: () => void;
  tags: ReturnType<typeof useGet<AwxItemsResponse<QuayImageTag>>>;
  canLoadTags: boolean;
  canManageTags: boolean;
  onBack: () => void;
  onDeleteTag: (imageTag: QuayImageTag) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Tabs
        activeKey={props.activeTab}
        onSelect={(event, key) => {
          event.preventDefault();
          if (key === 'back') {
            props.onBack();
            return;
          }
          props.setActiveTab(key as DetailsTabKey);
        }}
        inset={{ default: 'insetNone' }}
        isBox
        style={{
          backgroundColor: 'var(--pf-v5-c-tabs__link--BackgroundColor)',
          flexShrink: 0,
        }}
      >
        <Tab
          eventKey="back"
          title={
            <TabTitleText>
              <CaretLeftIcon />
              <span style={{ marginLeft: 6 }}>{t('Back to Templates')}</span>
            </TabTitleText>
          }
        />
        <Tab eventKey="details" title={<TabTitleText>{t('Details')}</TabTitleText>} />
        <Tab eventKey="team-access" title={<TabTitleText>{t('Team Access')}</TabTitleText>} />
        <Tab eventKey="user-access" title={<TabTitleText>{t('User Access')}</TabTitleText>} />
        <Tab eventKey="schedules" title={<TabTitleText>{t('Schedules')}</TabTitleText>} />
        <Tab eventKey="jobs" title={<TabTitleText>{t('Jobs')}</TabTitleText>} />
        <Tab eventKey="notifications" title={<TabTitleText>{t('Notifications')}</TabTitleText>} />
        <Tab eventKey="tags" title={<TabTitleText>{t('Tags')}</TabTitleText>} />
      </Tabs>
      <PageSection>
        {props.activeTab === 'details' ? (
          <PageDetails>
            <PageDetail label={t('Name')}>{props.template.name}</PageDetail>
            <PageDetail label={t('Description')}>{props.template.description}</PageDetail>
            <PageDetail label={t('Organization')}>
              {props.template.project.organization?.name || '-'}
            </PageDetail>
            <PageDetail label={t('Capstan Project')}>
              {props.template.project.name || '-'}
            </PageDetail>
            <PageDetail label={t('Image')}>
              <ClipboardCopy isReadOnly hoverTip={t('Copy')} clickTip={t('Copied')}>
                {props.template.image}
              </ClipboardCopy>
            </PageDetail>
            <PageDetail label={t('Namespace')}>{props.template.namespace}</PageDetail>
            <PageDetail label={t('Repository')}>{props.template.repository}</PageDetail>
            <PageDetail label={t('Tag')}>{props.template.tag}</PageDetail>
            <PageDetail label={t('Runtime')}>{props.template.runtime}</PageDetail>
            <PageDetail label={t('Definition file')}>{props.template.definition_file}</PageDetail>
            <PageDetail label={t('Build context')}>{props.template.context}</PageDetail>
            <PageDetail label={t('Created')}>{formatDate(props.template.created)}</PageDetail>
            <PageDetail label={t('Last modified')}>
              {formatDate(props.template.modified)}
            </PageDetail>
          </PageDetails>
        ) : props.activeTab === 'jobs' ? (
          <BuildsOutput
            builds={props.builds}
            selectedBuildId={props.selectedBuildId}
            setSelectedBuildId={props.setSelectedBuildId}
            selectedBuildSnapshot={props.selectedBuildSnapshot}
            setSelectedBuildSnapshot={props.setSelectedBuildSnapshot}
            onRefreshBuilds={props.onRefreshBuilds}
          />
        ) : props.activeTab === 'tags' ? (
          <TagsTable
            tags={props.tags}
            canLoadTags={props.canLoadTags}
            canManageTags={props.canManageTags}
            onDeleteTag={props.onDeleteTag}
          />
        ) : props.activeTab === 'team-access' ? (
          <TeamAccess
            service="awx"
            id={props.template.id.toString()}
            type="quayimagebuildtemplate"
            addRolesRoute={AwxRoute.QuayImageBuildTemplateAddTeams}
          />
        ) : props.activeTab === 'user-access' ? (
          <UserAccess
            service="awx"
            id={props.template.id.toString()}
            type="quayimagebuildtemplate"
            addRolesRoute={AwxRoute.QuayImageBuildTemplateAddUsers}
          />
        ) : props.activeTab === 'schedules' ? (
          <SchedulesList
            createSchedulePageId={AwxRoute.QuayImageBuildTemplateScheduleCreate}
            resourceId={props.template.id.toString()}
            resourceType="quay-image-build-template"
            sublistEndpoint={awxAPI`/quay/execution-environment-images/templates`}
          />
        ) : props.activeTab === 'notifications' ? (
          <ResourceNotifications
            resourceType="quay_image_build_templates"
            id={props.template.id.toString()}
          />
        ) : (
          <Alert isInline variant="warning" title={t('Unsupported EE build template tab.')} />
        )}
      </PageSection>
    </>
  );
}

function BuildsOutput(props: {
  builds: QuayImageBuild[];
  selectedBuildId?: number;
  setSelectedBuildId: (id?: number) => void;
  selectedBuildSnapshot?: QuayImageBuild;
  setSelectedBuildSnapshot: (build?: QuayImageBuild) => void;
  onRefreshBuilds: () => void;
}) {
  const { t } = useTranslation();
  const {
    builds,
    selectedBuildId,
    selectedBuildSnapshot,
    setSelectedBuildId,
    setSelectedBuildSnapshot,
    onRefreshBuilds,
  } = props;
  const [isLoadingBuildDetail, setIsLoadingBuildDetail] = useState(false);
  const selectedBuildUrl = selectedBuildId
    ? `${awxAPI`/quay/execution-environment-images/builds/`}${selectedBuildId}/`
    : undefined;
  const selectedBuild =
    selectedBuildSnapshot?.id === selectedBuildId ? selectedBuildSnapshot : undefined;
  const visibleBuild =
    selectedBuild || builds.find((build) => build.id === selectedBuildId) || builds[0];

  useEffect(() => {
    if (!selectedBuildId && builds.length) {
      setSelectedBuildId(builds[0].id);
      setSelectedBuildSnapshot(builds[0]);
    }
  }, [builds, selectedBuildId, setSelectedBuildId, setSelectedBuildSnapshot]);

  const loadSelectedBuild = useCallback(
    async (showLoading = false) => {
      if (!selectedBuildUrl) {
        setSelectedBuildSnapshot(undefined);
        return;
      }
      if (showLoading) setIsLoadingBuildDetail(true);
      try {
        const build = await requestGet<QuayImageBuild>(selectedBuildUrl);
        setSelectedBuildSnapshot(build);
      } catch {
        // Keep the last known build state while polling.
      } finally {
        if (showLoading) setIsLoadingBuildDetail(false);
      }
    },
    [selectedBuildUrl, setSelectedBuildSnapshot]
  );

  useEffect(() => {
    if (!selectedBuildUrl) return;
    void loadSelectedBuild(true);
    const interval = window.setInterval(() => void loadSelectedBuild(false), 3000);
    return () => window.clearInterval(interval);
  }, [loadSelectedBuild, selectedBuildUrl]);

  if (!builds.length) {
    return <Alert isInline variant="info" title={t('No builds have run for this template.')} />;
  }

  return (
    <Stack hasGutter>
      {visibleBuild ? (
        <StackItem>
          <PageDetails numberOfColumns="multiple">
            <PageDetail label={t('Selected build')}>#{visibleBuild.id}</PageDetail>
            <PageDetail label={t('Status')}>
              <Label color={buildStatusColor(visibleBuild.status)}>
                {statusText(visibleBuild.status)}
              </Label>
            </PageDetail>
            <PageDetail label={t('Image')} fullWidth>
              <ClipboardCopy isReadOnly hoverTip={t('Copy')} clickTip={t('Copied')}>
                {visibleBuild.image}
              </ClipboardCopy>
            </PageDetail>
            <PageDetail label={t('Project')}>{visibleBuild.project?.name || '-'}</PageDetail>
            <PageDetail label={t('Runtime')}>{visibleBuild.runtime}</PageDetail>
            <PageDetail label={t('Started')}>{formatDate(visibleBuild.started)}</PageDetail>
            <PageDetail label={t('Finished')}>{formatDate(visibleBuild.finished)}</PageDetail>
          </PageDetails>
          <Progress
            value={visibleBuild.progress || 0}
            size={ProgressSize.sm}
            title={t('Build progress')}
            style={{ marginTop: 16 }}
          />
          {visibleBuild.error ? (
            <Alert
              isInline
              variant="danger"
              title={t('Selected build failed')}
              style={{ marginTop: 16 }}
            >
              {visibleBuild.error}
            </Alert>
          ) : null}
        </StackItem>
      ) : null}
      <StackItem>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>{t('Build output')}</div>
        <pre
          aria-label={t('Selected build output')}
          style={{
            backgroundColor: '#030608',
            border: '1px solid var(--pf-v5-global--BorderColor--100)',
            color: 'var(--pf-v5-global--Color--light-100, #f0f0f0)',
            fontFamily: 'var(--pf-v5-global--FontFamily--monospace, monospace)',
            fontSize: 13,
            lineHeight: 1.45,
            margin: 0,
            maxHeight: 520,
            minHeight: 280,
            overflow: 'auto',
            padding: 16,
            whiteSpace: 'pre-wrap',
          }}
        >
          {isLoadingBuildDetail
            ? t('Loading build output...')
            : visibleBuild?.log || t('Waiting for build output...')}
        </pre>
      </StackItem>
      <StackItem>
        <Button
          variant="secondary"
          icon={<SyncAltIcon />}
          onClick={() => {
            onRefreshBuilds();
            void loadSelectedBuild(true);
          }}
        >
          {t('Refresh builds')}
        </Button>
      </StackItem>
      <StackItem>
        <Table aria-label={t('EE image build runs')} variant="compact">
          <Thead>
            <Tr>
              <Th>{t('Run')}</Th>
              <Th>{t('Status')}</Th>
              <Th>{t('Image')}</Th>
              <Th>{t('Started')}</Th>
              <Th>{t('Finished')}</Th>
            </Tr>
          </Thead>
          <Tbody>
            {builds.map((build) => (
              <Tr key={build.id}>
                <Td dataLabel={t('Run')}>
                  <Button
                    variant="link"
                    isInline
                    onClick={() => {
                      setSelectedBuildId(build.id);
                      setSelectedBuildSnapshot(build);
                    }}
                  >
                    #{build.id}
                  </Button>
                </Td>
                <Td dataLabel={t('Status')}>
                  <Label color={buildStatusColor(build.status)}>{statusText(build.status)}</Label>
                </Td>
                <Td dataLabel={t('Image')}>
                  <span style={{ overflowWrap: 'anywhere' }}>{build.image}</span>
                </Td>
                <Td dataLabel={t('Started')}>{formatDate(build.started || build.created)}</Td>
                <Td dataLabel={t('Finished')}>{formatDate(build.finished)}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </StackItem>
    </Stack>
  );
}

function TagsTable(props: {
  tags: ReturnType<typeof useGet<AwxItemsResponse<QuayImageTag>>>;
  canLoadTags: boolean;
  canManageTags: boolean;
  onDeleteTag: (imageTag: QuayImageTag) => void;
}) {
  const { t } = useTranslation();
  if (!props.canLoadTags) {
    return (
      <Alert isInline variant="info" title={t('Project Quay API token is not set.')}>
        {t('Capstan needs a Project Quay API token before it can list hosted image tags.')}
      </Alert>
    );
  }
  if (props.tags.isLoading) {
    return (
      <div style={{ minHeight: 140, display: 'grid', placeItems: 'center' }}>
        <Spinner size="md" />
      </div>
    );
  }
  if (props.tags.error) {
    return (
      <Alert isInline variant="warning" title={t('Could not load images from Project Quay.')}>
        {t('Check the Project Quay API token and repository permissions.')}
      </Alert>
    );
  }
  if (!props.tags.data?.results?.length) {
    return <Alert isInline variant="info" title={t('No hosted image tags found.')} />;
  }
  return (
    <Table aria-label={t('Project Quay hosted Execution Environments')} variant="compact">
      <Thead>
        <Tr>
          <Th>{t('Tag')}</Th>
          <Th>{t('Digest')}</Th>
          <Th>{t('Size')}</Th>
          <Th>{t('Updated')}</Th>
          <Th>{t('Actions')}</Th>
        </Tr>
      </Thead>
      <Tbody>
        {props.tags.data.results.map((imageTag) => (
          <Tr key={imageTag.id}>
            <Td>{imageTag.name || '-'}</Td>
            <Td>{imageTag.manifest_digest || '-'}</Td>
            <Td>{formatBytes(imageTag.size)}</Td>
            <Td>{timestampFromTag(imageTag)}</Td>
            <Td>
              <Button
                variant="link"
                icon={<TrashIcon />}
                isDanger
                isDisabled={!props.canManageTags}
                onClick={() => props.onDeleteTag(imageTag)}
              >
                {t('Delete tag')}
              </Button>
            </Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}

function StackAlert(props: { status: ReturnType<typeof useGet<QuayStatus>> }) {
  const { t } = useTranslation();
  if (props.status.isLoading) return null;
  if (props.status.data && (!props.status.data.configured || props.status.data.controller_error)) {
    return (
      <Alert isInline variant="warning" title={t('Project Quay is not ready')}>
        {props.status.data.controller_error || props.status.data.message}
      </Alert>
    );
  }
  if (!props.status.data?.push_configured) {
    return (
      <Alert isInline variant="warning" title={t('Project Quay push credentials are not set')}>
        {t('Templates can be saved, but launching a build requires Quay push credentials.')}
      </Alert>
    );
  }
  return null;
}
