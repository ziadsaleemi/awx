import { Dispatch, SetStateAction, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  ButtonVariant,
  ClipboardCopy,
  ClipboardCopyVariant,
  Flex,
  FlexItem,
  Form,
  FormGroup,
  FormSelect,
  FormSelectOption,
  Label,
  Modal,
  ModalVariant,
  PageSection,
  Progress,
  ProgressSize,
  Stack,
  StackItem,
  Tab,
  TabTitleText,
  Tabs,
  Text,
  TextArea,
  TextInput,
  TextVariants,
  Title,
} from '@patternfly/react-core';
import {
  CaretLeftIcon,
  PencilAltIcon,
  PlusCircleIcon,
  RocketIcon,
  SyncAltIcon,
  TagIcon,
  TrashIcon,
} from '@patternfly/react-icons';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { DropdownPosition } from '@patternfly/react-core/deprecated';
import {
  DateTimeCell,
  IPageAction,
  ITableColumn,
  IToolbarFilter,
  PageDetail,
  PageDetails,
  PageActions,
  PageActionSelection,
  PageActionType,
  PageHeader,
  PageLayout,
  PageTable,
  TextCell,
  ToolbarFilterType,
  useGetPageUrl,
  usePageAlertToaster,
} from '../../../../framework';
import { PageDetailCodeEditor } from '../../../../framework/PageDetails/PageDetailCodeEditor';
import { AwxItemsResponse } from '../../common/AwxItemsResponse';
import { postRequest, requestGet } from '../../../common/crud/Data';
import { useGet } from '../../../common/crud/useGet';
import { ModuleAIAssistantAction } from '../../common/ModuleAIAssistantAction';
import { awxAPI } from '../../common/api/awx-utils';
import { AwxRoute } from '../../main/AwxRoutes';
import { useAwxBulkConfirmation } from '../../common/useAwxBulkConfirmation';
import { useAwxView } from '../../common/useAwxView';
import { QuayStatus } from './QuayOverview';

interface QuayRepository {
  id: number;
  _awx_key?: string;
  name?: string;
  namespace?: string;
  description?: string;
  is_public?: boolean;
  last_modified?: string;
  state?: string;
  tags?: {
    name?: string;
    last_modified?: string;
  }[];
}

interface QuayRepositoryForm {
  repository: string;
  namespace: string;
  description: string;
  visibility: 'public' | 'private';
}

interface QuayRepositoryActionResponse {
  source: string;
  action: string;
  namespace: string;
  repository: string;
  repository_path: string;
}

type QuayRepositoryModalMode = 'create' | 'edit';
type QuayRepositoryTabKey = 'details' | 'builds' | 'tags' | 'activity' | 'permissions' | 'settings';
type QuayPermissionRole = 'read' | 'write' | 'admin';
type QuayPrincipalType = 'user' | 'team';
type QuayContainerRuntime = 'podman' | 'docker';

const QUAY_PRINCIPAL_USER: QuayPrincipalType = 'user';
const QUAY_PRINCIPAL_TEAM: QuayPrincipalType = 'team';
const QUAY_REPO_ADMIN_SCOPE = 'repo:admin';

interface QuayImageTag {
  id: number;
  _awx_key?: string;
  name?: string;
  manifest_digest?: string;
  size?: number;
  last_modified?: string;
  start_ts?: number;
  end_ts?: number;
}

interface QuayPermission {
  id: number;
  _awx_key?: string;
  username?: string;
  teamname?: string;
  name?: string;
  role?: QuayPermissionRole;
}

interface QuayRepositoryPermissionsResponse {
  source: string;
  resource: string;
  namespace: string;
  repository: string;
  users: QuayPermission[];
  teams: QuayPermission[];
  count: number;
  controller_error: string;
}

interface QuayPermissionActionResponse {
  source: string;
  action: string;
  namespace: string;
  repository: string;
  username?: string;
  teamname?: string;
  role?: QuayPermissionRole;
}

interface AwxProject {
  id: number;
  name: string;
  local_path?: string;
  scm_revision?: string;
  status?: string;
}

interface QuayImageBuild {
  id: number;
  created?: string;
  modified?: string;
  created_by?: string;
  project?: {
    id?: number;
    name?: string;
    path?: string;
    scm_revision?: string;
  };
  namespace: string;
  repository: string;
  repository_path: string;
  tag: string;
  image: string;
  registry: string;
  runtime: QuayContainerRuntime;
  definition_file: string;
  context: string;
  status: 'pending' | 'running' | 'successful' | 'failed' | 'canceled';
  progress: number;
  started?: string;
  finished?: string;
  error?: string;
  log?: string;
  command_summary?: Array<{ label: string; command: string; working_directory?: string }>;
}

interface QuayImageBuildPayload {
  project_id: number;
  namespace: string;
  repository: string;
  tag: string;
  runtime: QuayContainerRuntime;
  definition_file: string;
  context: string;
}

function repositoryKey(repository?: QuayRepository, defaultNamespace = '') {
  if (!repository) return '';
  return (
    repository._awx_key ||
    `${repository.namespace || defaultNamespace}/${repository.name || repository.id}`
  );
}

function repositoryDetailsPath(repository: QuayRepository, defaultNamespace = '') {
  const namespace = encodeURIComponent(repository.namespace || defaultNamespace);
  const repositoryName = encodeURIComponent(repository.name || '');
  return `/quay/repositories/${namespace}/${repositoryName}`;
}

function visibility(repository: QuayRepository) {
  if (typeof repository.is_public === 'boolean') {
    return repository.is_public ? 'Public' : 'Private';
  }
  return '-';
}

function lastModified(repository: QuayRepository) {
  if (repository.last_modified) return repository.last_modified;
  return repository.tags?.[0]?.last_modified;
}

function tagTimestamp(tag: QuayImageTag) {
  if (tag.last_modified) return tag.last_modified;
  const timestamp = tag.end_ts || tag.start_ts;
  return timestamp ? new Date(timestamp * 1000).toISOString() : undefined;
}

function latestKnownTag(repository: QuayRepository, tags: QuayImageTag[]) {
  return tags[0]?.name || repository.tags?.[0]?.name || 'latest';
}

function formatBytes(value?: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MiB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GiB`;
}

function buildStatusColor(status?: QuayImageBuild['status']) {
  if (status === 'successful') return 'green';
  if (status === 'failed') return 'red';
  if (status === 'running') return 'blue';
  if (status === 'pending') return 'orange';
  return 'grey';
}

function imageReference(registry: string | undefined, repository: QuayRepository, tag: string) {
  const namespace = repository.namespace || '';
  const repositoryName = repository.name || '';
  if (!registry || !namespace || !repositoryName) return '';
  return `${registry}/${namespace}/${repositoryName}:${tag}`;
}

function permissionPrincipal(permission: QuayPermission, type: QuayPrincipalType) {
  if (type === QUAY_PRINCIPAL_USER) return permission.username || permission.name || '-';
  return permission.teamname || permission.name || '-';
}

function useQuayFilters(): IToolbarFilter[] {
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

function useQuayRepositoryColumns(defaultNamespace = ''): ITableColumn<QuayRepository>[] {
  const { t } = useTranslation();
  const getPageUrl = useGetPageUrl();
  return useMemo(
    () => [
      {
        header: t('Repository'),
        cell: (repository) => {
          const detailsUrl =
            getPageUrl(AwxRoute.QuayRepositoryDetails, {
              params: {
                namespace: repository.namespace || defaultNamespace,
                repository: repository.name,
              },
            }) || repositoryDetailsPath(repository, defaultNamespace);
          return repository.name ? (
            <Link to={detailsUrl}>{repository.name}</Link>
          ) : (
            <TextCell text="-" />
          );
        },
        card: 'name',
        list: 'name',
      },
      {
        header: t('Namespace'),
        cell: (repository) => <TextCell text={repository.namespace || '-'} />,
      },
      {
        header: t('Visibility'),
        cell: (repository) => <TextCell text={visibility(repository)} />,
      },
      {
        header: t('Description'),
        cell: (repository) => <TextCell text={repository.description || '-'} />,
      },
      {
        header: t('Updated'),
        cell: (repository) => <DateTimeCell value={lastModified(repository)} />,
      },
    ],
    [defaultNamespace, getPageUrl, t]
  );
}

function QuayRepositoryModal(props: {
  modalMode?: QuayRepositoryModalMode;
  repositoryForm: QuayRepositoryForm;
  setRepositoryForm: Dispatch<SetStateAction<QuayRepositoryForm>>;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Modal
      variant={ModalVariant.medium}
      title={
        props.modalMode === 'create'
          ? t('Create Project Quay repository')
          : t('Edit Project Quay repository')
      }
      isOpen={Boolean(props.modalMode)}
      onClose={props.onClose}
      actions={[
        <Button
          key="submit"
          variant="primary"
          onClick={props.onSubmit}
          isDisabled={
            props.isSubmitting ||
            !props.repositoryForm.repository.trim() ||
            !props.repositoryForm.namespace.trim()
          }
        >
          {props.modalMode === 'create' ? t('Create repository') : t('Save')}
        </Button>,
        <Button key="cancel" variant="link" onClick={props.onClose} isDisabled={props.isSubmitting}>
          {t('Cancel')}
        </Button>,
      ]}
    >
      <Form>
        <FormGroup label={t('Namespace')} fieldId="quay-repository-namespace" isRequired>
          <TextInput
            id="quay-repository-namespace"
            value={props.repositoryForm.namespace}
            onChange={(_event, value) =>
              props.setRepositoryForm((current) => ({ ...current, namespace: value }))
            }
          />
        </FormGroup>
        <FormGroup label={t('Repository')} fieldId="quay-repository-name" isRequired>
          <TextInput
            id="quay-repository-name"
            value={props.repositoryForm.repository}
            isDisabled={props.modalMode === 'edit'}
            onChange={(_event, value) =>
              props.setRepositoryForm((current) => ({ ...current, repository: value }))
            }
          />
        </FormGroup>
        {props.modalMode === 'create' ? (
          <FormGroup label={t('Visibility')} fieldId="quay-repository-visibility">
            <FormSelect
              id="quay-repository-visibility"
              value={props.repositoryForm.visibility}
              onChange={(_event, value) =>
                props.setRepositoryForm((current) => ({
                  ...current,
                  visibility: value as 'public' | 'private',
                }))
              }
            >
              <FormSelectOption value="private" label={t('Private')} />
              <FormSelectOption value="public" label={t('Public')} />
            </FormSelect>
          </FormGroup>
        ) : null}
        <FormGroup label={t('Description')} fieldId="quay-repository-description">
          <TextArea
            id="quay-repository-description"
            value={props.repositoryForm.description}
            onChange={(_event, value) =>
              props.setRepositoryForm((current) => ({ ...current, description: value }))
            }
          />
        </FormGroup>
      </Form>
    </Modal>
  );
}

function QuayTagTable(props: {
  tags: QuayImageTag[];
  isLoading?: boolean;
  error?: Error;
  emptyText: string;
  ariaLabel?: string;
}) {
  const { t } = useTranslation();

  if (props.error) {
    return <Alert isInline variant="danger" title={t('Unable to load repository tags')} />;
  }
  if (props.isLoading) {
    return <Text component={TextVariants.p}>{t('Loading repository tags...')}</Text>;
  }
  if (!props.tags.length) {
    return <Text component={TextVariants.p}>{props.emptyText}</Text>;
  }

  return (
    <Table variant="compact" aria-label={props.ariaLabel || t('Project Quay repository tags')}>
      <Thead>
        <Tr>
          <Th>{t('Tag')}</Th>
          <Th>{t('Digest')}</Th>
          <Th>{t('Size')}</Th>
          <Th>{t('Last modified')}</Th>
        </Tr>
      </Thead>
      <Tbody>
        {props.tags.map((tag) => (
          <Tr key={tag._awx_key || tag.name || tag.id}>
            <Td dataLabel={t('Tag')}>
              <Label color="blue" icon={<TagIcon />}>
                {tag.name || '-'}
              </Label>
            </Td>
            <Td dataLabel={t('Digest')} style={{ overflowWrap: 'anywhere' }}>
              {tag.manifest_digest || '-'}
            </Td>
            <Td dataLabel={t('Size')}>{formatBytes(tag.size)}</Td>
            <Td dataLabel={t('Last modified')}>
              <DateTimeCell value={tagTimestamp(tag)} />
            </Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}

function QuayPermissionTable(props: {
  items: QuayPermission[];
  type: QuayPrincipalType;
  canManage: boolean;
  onDelete: (permission: QuayPermission, type: QuayPrincipalType) => void;
}) {
  const { t } = useTranslation();
  const label = props.type === QUAY_PRINCIPAL_USER ? t('Users and robots') : t('Teams');

  return (
    <Stack hasGutter>
      <StackItem>
        <Title headingLevel="h3" size="lg">
          {label}
        </Title>
      </StackItem>
      <StackItem>
        {props.items.length ? (
          <Table
            variant="compact"
            aria-label={
              props.type === QUAY_PRINCIPAL_USER
                ? t('Quay user and robot permissions')
                : t('Quay team permissions')
            }
          >
            <Thead>
              <Tr>
                <Th>{props.type === QUAY_PRINCIPAL_USER ? t('User or robot') : t('Team')}</Th>
                <Th>{t('Role')}</Th>
                <Th>{t('Actions')}</Th>
              </Tr>
            </Thead>
            <Tbody>
              {props.items.map((permission) => (
                <Tr key={permission._awx_key || permission.id}>
                  <Td
                    dataLabel={props.type === QUAY_PRINCIPAL_USER ? t('User or robot') : t('Team')}
                  >
                    {permissionPrincipal(permission, props.type)}
                  </Td>
                  <Td dataLabel={t('Role')}>{permission.role || '-'}</Td>
                  <Td dataLabel={t('Actions')}>
                    <Button
                      variant="link"
                      icon={<TrashIcon />}
                      isDanger
                      isDisabled={!props.canManage}
                      onClick={() => props.onDelete(permission, props.type)}
                    >
                      {t('Remove')}
                    </Button>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        ) : (
          <Alert
            isInline
            variant="info"
            title={
              props.type === QUAY_PRINCIPAL_USER
                ? t('No user or robot permissions found.')
                : t('No team permissions found.')
            }
          />
        )}
      </StackItem>
    </Stack>
  );
}

function QuayRepositoryBuildsTab(props: {
  repository: QuayRepository;
  namespace: string;
  statusData?: QuayStatus;
  canManageRepositories: boolean;
}) {
  const { t } = useTranslation();
  const alertToaster = usePageAlertToaster();
  const projects = useGet<AwxItemsResponse<AwxProject>>(
    awxAPI`/projects/`,
    { page_size: 200, order_by: 'name' },
    { revalidateOnFocus: false }
  );
  const projectOptions = useMemo(() => projects.data?.results ?? [], [projects.data?.results]);
  const builds = useGet<AwxItemsResponse<QuayImageBuild>>(
    awxAPI`/quay/execution-environment-images/builds/`,
    {
      namespace: props.namespace,
      repository: props.repository.name || '',
      page_size: 10,
    },
    { revalidateOnFocus: false, refreshInterval: 3000 }
  );
  const buildItems = useMemo(() => builds.data?.results ?? [], [builds.data?.results]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [tag, setTag] = useState('latest');
  const [runtime, setRuntime] = useState<QuayContainerRuntime>('podman');
  const [definitionFile, setDefinitionFile] = useState('execution-environment.yml');
  const [contextPath, setContextPath] = useState('.');
  const [selectedBuildId, setSelectedBuildId] = useState<number>();
  const [selectedBuildDetail, setSelectedBuildDetail] = useState<QuayImageBuild>();
  const [isLoadingBuildDetail, setIsLoadingBuildDetail] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const selectedBuildUrl = selectedBuildId
    ? `${awxAPI`/quay/execution-environment-images/builds/`}${selectedBuildId}/`
    : undefined;
  const activeBuild =
    selectedBuildDetail && ['pending', 'running'].includes(selectedBuildDetail.status)
      ? selectedBuildDetail
      : buildItems.find((build) => ['pending', 'running'].includes(build.status));
  const visibleBuild = selectedBuildDetail || activeBuild || buildItems[0];
  const canStartBuild = Boolean(
    props.canManageRepositories &&
      props.statusData?.push_configured &&
      props.repository.name &&
      props.namespace
  );

  useEffect(() => {
    if (!selectedProjectId && projectOptions.length) {
      setSelectedProjectId(String(projectOptions[0].id));
    }
  }, [projectOptions, selectedProjectId]);

  useEffect(() => {
    if (!selectedBuildId && buildItems.length) {
      setSelectedBuildId(buildItems[0].id);
    }
  }, [buildItems, selectedBuildId]);

  const loadSelectedBuild = useCallback(
    async (showLoading = false) => {
      if (!selectedBuildUrl) {
        setSelectedBuildDetail(undefined);
        return;
      }
      if (showLoading) setIsLoadingBuildDetail(true);
      try {
        const build = await requestGet<QuayImageBuild>(selectedBuildUrl);
        setSelectedBuildDetail(build);
      } catch {
        // Keep the last known build state if a polling request misses during refresh.
      } finally {
        if (showLoading) setIsLoadingBuildDetail(false);
      }
    },
    [selectedBuildUrl]
  );

  useEffect(() => {
    if (!selectedBuildUrl) {
      setSelectedBuildDetail(undefined);
      return;
    }
    void loadSelectedBuild(true);
    const interval = window.setInterval(() => void loadSelectedBuild(false), 3000);
    return () => window.clearInterval(interval);
  }, [loadSelectedBuild, selectedBuildUrl]);

  const startBuild = useCallback(async () => {
    if (!selectedProjectId || !props.repository.name) return;
    setIsLaunching(true);
    try {
      const build = await postRequest<QuayImageBuild, QuayImageBuildPayload>(
        awxAPI`/quay/execution-environment-images/builds/`,
        {
          project_id: Number(selectedProjectId),
          namespace: props.namespace,
          repository: props.repository.name,
          tag: tag.trim() || 'latest',
          runtime,
          definition_file: definitionFile.trim() || 'execution-environment.yml',
          context: contextPath.trim() || '.',
        }
      );
      setSelectedBuildId(build.id);
      setSelectedBuildDetail(build);
      builds.refresh();
      alertToaster.addAlert({
        variant: 'success',
        title: t('Project Quay image build queued.'),
        timeout: 3000,
      });
    } catch (err) {
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Unable to start Project Quay image build'),
        children: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsLaunching(false);
    }
  }, [
    alertToaster,
    builds,
    contextPath,
    definitionFile,
    props.namespace,
    props.repository.name,
    runtime,
    selectedProjectId,
    t,
    tag,
  ]);

  return (
    <PageSection variant="light">
      <Stack hasGutter>
        {!props.statusData?.push_configured ? (
          <StackItem>
            <Alert
              isInline
              variant="warning"
              title={t('Project Quay push credentials are required to run builds from AWX.')}
            >
              {t('Configure QUAY_PUSH_USERNAME and QUAY_PUSH_TOKEN before launching builds.')}
            </Alert>
          </StackItem>
        ) : null}
        <StackItem>
          <Title headingLevel="h3" size="lg" style={{ marginBottom: 16 }}>
            {t('Build execution environment image')}
          </Title>
          <Form>
            <div
              style={{
                alignItems: 'end',
                display: 'grid',
                gap: 16,
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))',
              }}
            >
              <FormGroup label={t('AWX Project')} fieldId="quay-build-project" isRequired>
                <FormSelect
                  id="quay-build-project"
                  value={selectedProjectId}
                  onChange={(_event, value) => setSelectedProjectId(value)}
                  isDisabled={projects.isLoading}
                >
                  <FormSelectOption value="" label={t('Select project')} />
                  {projectOptions.map((project) => (
                    <FormSelectOption
                      key={project.id}
                      value={String(project.id)}
                      label={project.name}
                    />
                  ))}
                </FormSelect>
              </FormGroup>
              <FormGroup label={t('Tag')} fieldId="quay-build-tag" isRequired>
                <TextInput
                  id="quay-build-tag"
                  value={tag}
                  onChange={(_event, value) => setTag(value)}
                />
              </FormGroup>
              <FormGroup label={t('Runtime')} fieldId="quay-build-runtime">
                <FormSelect
                  id="quay-build-runtime"
                  value={runtime}
                  onChange={(_event, value) => setRuntime(value as QuayContainerRuntime)}
                >
                  <FormSelectOption value="podman" label={t('Podman')} />
                  <FormSelectOption value="docker" label={t('Docker')} />
                </FormSelect>
              </FormGroup>
              <FormGroup label={t('Definition file')} fieldId="quay-build-definition">
                <TextInput
                  id="quay-build-definition"
                  value={definitionFile}
                  onChange={(_event, value) => setDefinitionFile(value)}
                />
              </FormGroup>
              <FormGroup label={t('Build context')} fieldId="quay-build-context">
                <TextInput
                  id="quay-build-context"
                  value={contextPath}
                  onChange={(_event, value) => setContextPath(value)}
                />
              </FormGroup>
              <Button
                variant="primary"
                icon={<RocketIcon />}
                isLoading={isLaunching}
                isDisabled={!canStartBuild || !selectedProjectId || isLaunching}
                onClick={() => void startBuild()}
              >
                {t('Start build')}
              </Button>
            </div>
          </Form>
        </StackItem>
        {visibleBuild ? (
          <StackItem>
            <PageDetails numberOfColumns="multiple">
              <PageDetail label={t('Selected build')}>#{visibleBuild.id}</PageDetail>
              <PageDetail label={t('Status')}>
                <Label color={buildStatusColor(visibleBuild.status)}>{visibleBuild.status}</Label>
              </PageDetail>
              <PageDetail label={t('Image')} fullWidth>
                <span style={{ overflowWrap: 'anywhere' }}>{visibleBuild.image}</span>
              </PageDetail>
              <PageDetail label={t('Project')}>{visibleBuild.project?.name || '-'}</PageDetail>
              <PageDetail label={t('Runtime')}>{visibleBuild.runtime}</PageDetail>
              <PageDetail label={t('Started')}>
                <DateTimeCell value={visibleBuild.started} />
              </PageDetail>
              <PageDetail label={t('Finished')}>
                <DateTimeCell value={visibleBuild.finished} />
              </PageDetail>
            </PageDetails>
            <Progress
              value={visibleBuild.progress || 0}
              size={ProgressSize.sm}
              title={t('Build progress')}
            />
            {visibleBuild.error ? (
              <Alert
                isInline
                variant="danger"
                title={t('Latest build failed')}
                style={{ marginTop: 16 }}
              >
                {visibleBuild.error}
              </Alert>
            ) : null}
          </StackItem>
        ) : null}
        <StackItem>
          <Flex
            alignItems={{ default: 'alignItemsCenter' }}
            justifyContent={{ default: 'justifyContentSpaceBetween' }}
            style={{ marginBottom: 12 }}
          >
            <FlexItem>
              <Title headingLevel="h3" size="lg">
                {t('Recent builds')}
              </Title>
            </FlexItem>
            <FlexItem>
              <Button
                variant="secondary"
                icon={<SyncAltIcon />}
                onClick={() => {
                  void builds.refresh();
                  void loadSelectedBuild(true);
                }}
              >
                {t('Refresh')}
              </Button>
            </FlexItem>
          </Flex>
          {builds.isLoading ? (
            <Text component={TextVariants.p}>{t('Loading image builds...')}</Text>
          ) : buildItems.length ? (
            <Table variant="compact" aria-label={t('Project Quay image builds')}>
              <Thead>
                <Tr>
                  <Th>{t('Build')}</Th>
                  <Th>{t('Status')}</Th>
                  <Th>{t('Tag')}</Th>
                  <Th>{t('Project')}</Th>
                  <Th>{t('Started')}</Th>
                  <Th>{t('Finished')}</Th>
                </Tr>
              </Thead>
              <Tbody>
                {buildItems.map((build) => (
                  <Tr key={build.id}>
                    <Td dataLabel={t('Build')}>
                      <Button variant="link" isInline onClick={() => setSelectedBuildId(build.id)}>
                        #{build.id}
                      </Button>
                    </Td>
                    <Td dataLabel={t('Status')}>
                      <Label color={buildStatusColor(build.status)}>{build.status}</Label>
                    </Td>
                    <Td dataLabel={t('Tag')}>{build.tag}</Td>
                    <Td dataLabel={t('Project')}>{build.project?.name || '-'}</Td>
                    <Td dataLabel={t('Started')}>
                      <DateTimeCell value={build.started} />
                    </Td>
                    <Td dataLabel={t('Finished')}>
                      <DateTimeCell value={build.finished} />
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          ) : (
            <Alert
              isInline
              variant="info"
              title={t('No image builds have run for this repository.')}
            />
          )}
        </StackItem>
        <StackItem>
          <Title headingLevel="h3" size="lg" style={{ marginBottom: 12 }}>
            {t('Build output')}
          </Title>
          <ClipboardCopy
            isReadOnly
            hoverTip={t('Copy')}
            clickTip={t('Copied')}
            variant={ClipboardCopyVariant.expansion}
          >
            {isLoadingBuildDetail
              ? t('Loading build output...')
              : selectedBuildDetail?.log || t('Select or start a build to view output.')}
          </ClipboardCopy>
        </StackItem>
      </Stack>
    </PageSection>
  );
}

function QuayRepositoryConsole(props: {
  repository?: QuayRepository;
  statusData?: QuayStatus;
  defaultNamespace: string;
  canManageRepositories: boolean;
  onEdit: (repository: QuayRepository) => void;
  onDelete: (repository: QuayRepository) => void;
  onChangeVisibility: (repository: QuayRepository, enabled: boolean) => void;
}) {
  const { t } = useTranslation();
  const getPageUrl = useGetPageUrl();
  const navigate = useNavigate();
  const alertToaster = usePageAlertToaster();
  const [activeTab, setActiveTab] = useState<QuayRepositoryTabKey>('details');
  const repositoriesUrl = getPageUrl(AwxRoute.QuayRepositories) || '/quay/repositories';
  const eeImagesUrl = getPageUrl(AwxRoute.Templates) || '/templates';
  const apiTokenUrl = getPageUrl(AwxRoute.QuayApiToken) || '/quay/api-token';
  const repository = props.repository;
  const namespace = repository?.namespace || props.defaultNamespace;
  const canLoadTags = Boolean(
    props.statusData?.configured &&
      props.statusData.auth_configured &&
      namespace &&
      repository?.name
  );
  const tags = useGet<AwxItemsResponse<QuayImageTag>>(
    canLoadTags ? awxAPI`/quay/tags/` : undefined,
    canLoadTags
      ? {
          namespace,
          repository: repository?.name || '',
          page_size: 20,
        }
      : undefined,
    { revalidateOnFocus: false }
  );
  const tagItems = tags.data?.results ?? [];
  const canManagePermissions = Boolean(
    props.statusData?.can_manage && props.statusData?.management_configured
  );
  const permissions = useGet<QuayRepositoryPermissionsResponse>(
    repository?.name && namespace && canManagePermissions
      ? awxAPI`/quay/repositories/permissions/`
      : undefined,
    repository?.name && namespace && canManagePermissions
      ? { namespace, repository: repository.name }
      : undefined,
    { revalidateOnFocus: false }
  );
  const [principalType, setPrincipalType] = useState<QuayPrincipalType>(QUAY_PRINCIPAL_USER);
  const [principal, setPrincipal] = useState('');
  const [role, setRole] = useState<QuayPermissionRole>('read');

  const setPermission = useCallback(async () => {
    if (!repository?.name || !namespace || !principal.trim()) return;
    const endpoint =
      principalType === QUAY_PRINCIPAL_USER
        ? awxAPI`/quay/repositories/permissions/user/set/`
        : awxAPI`/quay/repositories/permissions/team/set/`;
    const payload = {
      namespace,
      repository: repository.name,
      role,
      [principalType === QUAY_PRINCIPAL_USER ? 'username' : 'teamname']: principal.trim(),
    };
    try {
      const result = await postRequest<QuayPermissionActionResponse, typeof payload>(
        endpoint,
        payload
      );
      alertToaster.addAlert({
        variant: 'success',
        title: t('Project Quay {{role}} permission saved for {{principal}}.', {
          role: result.role || role,
          principal: principal.trim(),
        }),
        timeout: 4000,
      });
      setPrincipal('');
      permissions.refresh();
    } catch (err) {
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Failed to save Project Quay repository permission'),
        children: err instanceof Error ? err.message : String(err),
      });
    }
  }, [alertToaster, namespace, permissions, principal, principalType, repository?.name, role, t]);

  const deletePermission = useCallback(
    async (permission: QuayPermission, type: QuayPrincipalType) => {
      const name = permissionPrincipal(permission, type);
      if (!repository?.name || !namespace || name === '-') return;
      const endpoint =
        type === QUAY_PRINCIPAL_USER
          ? awxAPI`/quay/repositories/permissions/user/delete/`
          : awxAPI`/quay/repositories/permissions/team/delete/`;
      const payload = {
        namespace,
        repository: repository.name,
        [type === QUAY_PRINCIPAL_USER ? 'username' : 'teamname']: name,
      };
      try {
        await postRequest<QuayPermissionActionResponse, typeof payload>(endpoint, payload);
        alertToaster.addAlert({
          variant: 'success',
          title: t('Project Quay repository permission removed for {{principal}}.', {
            principal: name,
          }),
          timeout: 4000,
        });
        permissions.refresh();
      } catch (err) {
        alertToaster.addAlert({
          variant: 'danger',
          title: t('Failed to remove Project Quay repository permission'),
          children: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [alertToaster, namespace, permissions, repository?.name, t]
  );

  if (!repository) {
    return (
      <PageSection style={{ padding: 24 }}>
        <Alert
          isInline
          variant="info"
          title={t('No Project Quay repository selected')}
          actionLinks={
            <Button component="a" variant="link" href={eeImagesUrl}>
              {t('Build an execution environment image')}
            </Button>
          }
        >
          {t('Create or push an execution environment image repository to manage it from AWX.')}
        </Alert>
      </PageSection>
    );
  }

  const latestTag = latestKnownTag(repository, tagItems);
  const image = imageReference(props.statusData?.registry, repository, latestTag);
  const isPublic = Boolean(repository.is_public);
  const latestTagTimestamp = tagItems[0] ? tagTimestamp(tagItems[0]) : undefined;

  return (
    <>
      <Tabs
        activeKey={activeTab}
        inset={{ default: 'insetSm' }}
        isBox
        onSelect={(event, key) => {
          event.preventDefault();
          if (key === 'back') {
            navigate(repositoriesUrl);
            return;
          }
          setActiveTab(key as QuayRepositoryTabKey);
        }}
        style={{
          backgroundColor: 'var(--pf-v5-c-tabs__link--BackgroundColor)',
          flexShrink: 0,
        }}
      >
        <Tab
          eventKey="back"
          href={repositoriesUrl}
          title={
            <TabTitleText>
              <CaretLeftIcon />
              <span style={{ marginLeft: 6 }}>{t('Back to Repositories')}</span>
            </TabTitleText>
          }
        />
        <Tab eventKey="details" title={<TabTitleText>{t('Details')}</TabTitleText>} />
        <Tab eventKey="builds" title={<TabTitleText>{t('Builds')}</TabTitleText>} />
        <Tab eventKey="tags" title={<TabTitleText>{t('Tags')}</TabTitleText>} />
        <Tab eventKey="activity" title={<TabTitleText>{t('Activity')}</TabTitleText>} />
        <Tab eventKey="permissions" title={<TabTitleText>{t('Permissions')}</TabTitleText>} />
        <Tab eventKey="settings" title={<TabTitleText>{t('Settings')}</TabTitleText>} />
      </Tabs>
      {activeTab === 'details' ? (
        <PageDetails numberOfColumns="multiple">
          <PageDetail label={t('Name')}>{repository.name || '-'}</PageDetail>
          <PageDetail label={t('Description')}>{repository.description || '-'}</PageDetail>
          <PageDetail label={t('Namespace')}>{namespace || '-'}</PageDetail>
          <PageDetail label={t('Registry')}>{props.statusData?.registry || '-'}</PageDetail>
          <PageDetail label={t('Latest tag')}>{latestTag || '-'}</PageDetail>
          <PageDetail label={t('Visibility')}>
            <Label color={isPublic ? 'blue' : 'grey'}>{visibility(repository)}</Label>
          </PageDetail>
          <PageDetail label={t('State')}>{repository.state || '-'}</PageDetail>
          <PageDetail label={t('Last modified')}>
            <DateTimeCell value={lastModified(repository)} />
          </PageDetail>
          <PageDetail label={t('Managed from AWX')}>
            {props.statusData?.management_configured ? t('Yes') : t('No')}
          </PageDetail>
          <PageDetail label={t('Image value')} fullWidth>
            <span style={{ overflowWrap: 'anywhere' }}>{image || '-'}</span>
          </PageDetail>
          <PageDetailCodeEditor
            key={`podman-${image}`}
            label={t('Podman pull command')}
            value={image ? `podman pull ${image}` : t('Configure registry and namespace first.')}
            toggleLanguage={false}
          />
          <PageDetailCodeEditor
            key={`docker-${image}`}
            label={t('Docker pull command')}
            value={image ? `docker pull ${image}` : t('Configure registry and namespace first.')}
            toggleLanguage={false}
          />
        </PageDetails>
      ) : null}
      {activeTab === 'builds' ? (
        <QuayRepositoryBuildsTab
          repository={repository}
          namespace={namespace}
          statusData={props.statusData}
          canManageRepositories={props.canManageRepositories}
        />
      ) : null}
      {activeTab === 'tags' ? (
        <PageSection variant="light">
          {!props.statusData?.auth_configured ? (
            <Alert
              isInline
              variant="info"
              title={t('Configure a Project Quay API token to inspect hosted tags.')}
              actionLinks={
                <Button component="a" variant="link" href={apiTokenUrl}>
                  {t('Open API token plan')}
                </Button>
              }
            />
          ) : (
            <QuayTagTable
              tags={tagItems}
              isLoading={tags.isLoading}
              error={tags.error}
              emptyText={t('No image tags were reported for this repository.')}
              ariaLabel={t('Project Quay repository tags for {{repository}}', {
                repository: repository.name,
              })}
            />
          )}
        </PageSection>
      ) : null}
      {activeTab === 'activity' ? (
        <>
          <PageDetails numberOfColumns="multiple">
            <PageDetail label={t('Repository')}>{`${namespace}/${repository.name}`}</PageDetail>
            <PageDetail label={t('Registry')}>{props.statusData?.registry || '-'}</PageDetail>
            <PageDetail label={t('Tags loaded')}>{String(tagItems.length)}</PageDetail>
            <PageDetail label={t('Latest tag')}>{latestTag || '-'}</PageDetail>
            <PageDetail label={t('Latest tag update')}>
              <DateTimeCell value={latestTagTimestamp} />
            </PageDetail>
            <PageDetail label={t('Usage log source')}>
              {t('Project Quay usage logs are not exposed by the current AWX API.')}
            </PageDetail>
          </PageDetails>
          <PageSection variant="light">
            <Stack hasGutter>
              <StackItem>
                <Alert isInline variant="info" title={t('Usage logs need Quay event data')}>
                  {t(
                    'AWX can show repository and tag state now. Pull/push usage charts and event export need a dedicated Quay usage-log endpoint before they can be rendered with real data.'
                  )}
                </Alert>
              </StackItem>
              <StackItem>
                <Title headingLevel="h3" size="lg" style={{ marginBottom: 16 }}>
                  {t('Recent tag activity')}
                </Title>
                <QuayTagTable
                  tags={tagItems.slice(0, 5)}
                  isLoading={tags.isLoading}
                  error={tags.error}
                  emptyText={t('No recent tag activity was reported by Project Quay.')}
                  ariaLabel={t('Recent Project Quay repository tag activity')}
                />
              </StackItem>
            </Stack>
          </PageSection>
        </>
      ) : null}
      {activeTab === 'permissions' ? (
        <>
          <PageDetails numberOfColumns="multiple">
            <PageDetail label={t('Repository')}>{`${namespace}/${repository.name}`}</PageDetail>
            <PageDetail label={t('Permission source')}>
              {t('Project Quay repository API')}
            </PageDetail>
            <PageDetail label={t('User or robot permissions')}>
              {String(permissions.data?.users?.length ?? 0)}
            </PageDetail>
            <PageDetail label={t('Team permissions')}>
              {String(permissions.data?.teams?.length ?? 0)}
            </PageDetail>
            <PageDetail label={t('Required token scope')}>{QUAY_REPO_ADMIN_SCOPE}</PageDetail>
            <PageDetail label={t('Management token')}>
              {canManagePermissions ? t('Configured') : t('Not configured')}
            </PageDetail>
          </PageDetails>
          <PageSection variant="light">
            <Stack hasGutter>
              {!canManagePermissions ? (
                <StackItem>
                  <Alert
                    isInline
                    variant="warning"
                    title={t('Project Quay permission management needs an API token.')}
                    actionLinks={
                      <Button component="a" variant="link" href={apiTokenUrl}>
                        {t('Open API token plan')}
                      </Button>
                    }
                  >
                    {t(
                      'Configure QUAY_API_TOKEN with repo:admin scope before managing repository permissions from AWX.'
                    )}
                  </Alert>
                </StackItem>
              ) : (
                <>
                  <StackItem>
                    <Title headingLevel="h3" size="lg" style={{ marginBottom: 16 }}>
                      {t('Add repository permission')}
                    </Title>
                    <Form>
                      <div
                        style={{
                          alignItems: 'end',
                          display: 'grid',
                          gap: 16,
                          gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))',
                        }}
                      >
                        <FormGroup label={t('Principal type')} fieldId="quay-permission-type">
                          <FormSelect
                            id="quay-permission-type"
                            value={principalType}
                            onChange={(_event, value) =>
                              setPrincipalType(value as QuayPrincipalType)
                            }
                          >
                            <FormSelectOption value="user" label={t('User or robot')} />
                            <FormSelectOption value="team" label={t('Team')} />
                          </FormSelect>
                        </FormGroup>
                        <FormGroup label={t('Name')} fieldId="quay-permission-principal" isRequired>
                          <TextInput
                            id="quay-permission-principal"
                            value={principal}
                            placeholder={
                              principalType === QUAY_PRINCIPAL_USER
                                ? t('username or org+robot')
                                : t('team name')
                            }
                            onChange={(_event, value) => setPrincipal(value)}
                          />
                        </FormGroup>
                        <FormGroup label={t('Role')} fieldId="quay-permission-role">
                          <FormSelect
                            id="quay-permission-role"
                            value={role}
                            onChange={(_event, value) => setRole(value as QuayPermissionRole)}
                          >
                            <FormSelectOption value="read" label={t('Read')} />
                            <FormSelectOption value="write" label={t('Write')} />
                            <FormSelectOption value="admin" label={t('Admin')} />
                          </FormSelect>
                        </FormGroup>
                        <Button
                          variant="primary"
                          icon={<PlusCircleIcon />}
                          isDisabled={!principal.trim()}
                          onClick={() => void setPermission()}
                        >
                          {t('Save permission')}
                        </Button>
                      </div>
                    </Form>
                  </StackItem>
                  <StackItem>
                    {permissions.isLoading ? (
                      <Text component={TextVariants.p}>
                        {t('Loading repository permissions...')}
                      </Text>
                    ) : permissions.error ? (
                      <Alert
                        isInline
                        variant="warning"
                        title={t('Could not load Project Quay permissions.')}
                      />
                    ) : (
                      <Stack hasGutter>
                        <StackItem>
                          <QuayPermissionTable
                            items={permissions.data?.users ?? []}
                            type={QUAY_PRINCIPAL_USER}
                            canManage={canManagePermissions}
                            onDelete={(permission, type) => void deletePermission(permission, type)}
                          />
                        </StackItem>
                        <StackItem>
                          <QuayPermissionTable
                            items={permissions.data?.teams ?? []}
                            type={QUAY_PRINCIPAL_TEAM}
                            canManage={canManagePermissions}
                            onDelete={(permission, type) => void deletePermission(permission, type)}
                          />
                        </StackItem>
                      </Stack>
                    )}
                  </StackItem>
                </>
              )}
            </Stack>
          </PageSection>
        </>
      ) : null}
      {activeTab === 'settings' ? (
        <>
          <PageDetails numberOfColumns="multiple">
            <PageDetail label={t('Repository')}>{`${namespace}/${repository.name}`}</PageDetail>
            <PageDetail label={t('Visibility')}>
              <Label color={isPublic ? 'blue' : 'grey'}>{visibility(repository)}</Label>
            </PageDetail>
            <PageDetail label={t('Description')}>{repository.description || '-'}</PageDetail>
            <PageDetail label={t('State')}>{repository.state || '-'}</PageDetail>
            <PageDetail label={t('Edit description')}>
              <Button
                variant="secondary"
                icon={<PencilAltIcon />}
                onClick={() => props.onEdit(repository)}
                isDisabled={!props.canManageRepositories}
              >
                {t('Edit description')}
              </Button>
            </PageDetail>
            <PageDetail label={t('Repository visibility')}>
              <Button
                variant="secondary"
                onClick={() => props.onChangeVisibility(repository, !isPublic)}
                isDisabled={!props.canManageRepositories}
              >
                {isPublic ? t('Make private') : t('Make public')}
              </Button>
            </PageDetail>
          </PageDetails>
          <PageSection variant="light">
            <Alert
              isInline
              variant="danger"
              title={t('Delete repository')}
              actionLinks={
                <Button
                  variant="link"
                  isDanger
                  onClick={() => props.onDelete(repository)}
                  isDisabled={!props.canManageRepositories}
                >
                  {t('Delete repository')}
                </Button>
              }
            >
              {t(
                'Deleting a repository removes the hosted image tags from Project Quay. This action cannot be undone from AWX.'
              )}
            </Alert>
          </PageSection>
        </>
      ) : null}
    </>
  );
}

function decodeRouteParam(value?: string) {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function QuayRepositoryDetails() {
  const { t } = useTranslation();
  const params = useParams<{ namespace: string; repository: string }>();
  const navigate = useNavigate();
  const getPageUrl = useGetPageUrl();
  const alertToaster = usePageAlertToaster();
  const repositoriesUrl = getPageUrl(AwxRoute.QuayRepositories) || '/quay/repositories';
  const status = useGet<QuayStatus>(awxAPI`/quay/status/`);
  const statusData = status.data;
  const defaultNamespace = statusData?.namespace || '';
  const routeNamespace = decodeRouteParam(params.namespace);
  const routeRepository = decodeRouteParam(params.repository);
  const namespace = routeNamespace || defaultNamespace;
  const tableColumns = useQuayRepositoryColumns(defaultNamespace);
  const bulkAction = useAwxBulkConfirmation<QuayRepository>();
  const repositoryQuery = useGet<AwxItemsResponse<QuayRepository>>(
    routeRepository ? awxAPI`/quay/repositories/` : undefined,
    routeRepository
      ? {
          namespace,
          search: routeRepository,
          page_size: 100,
        }
      : undefined,
    { revalidateOnFocus: false }
  );
  const repository = useMemo(() => {
    const results = repositoryQuery.data?.results ?? [];
    return (
      results.find(
        (item) => item.name === routeRepository && (item.namespace || namespace) === namespace
      ) ||
      results.find((item) => item.name === routeRepository) ||
      results[0]
    );
  }, [namespace, repositoryQuery.data?.results, routeRepository]);
  const canManageRepositories = Boolean(
    statusData?.can_manage && statusData?.management_configured
  );
  const [modalMode, setModalMode] = useState<QuayRepositoryModalMode>();
  const [repositoryForm, setRepositoryForm] = useState<QuayRepositoryForm>({
    repository: '',
    namespace: '',
    description: '',
    visibility: 'private',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const closeModal = useCallback(() => {
    setModalMode(undefined);
    setIsSubmitting(false);
  }, []);

  const openEditModal = useCallback(
    (repository: QuayRepository) => {
      setRepositoryForm({
        repository: repository.name || '',
        namespace: repository.namespace || defaultNamespace,
        description: repository.description || '',
        visibility: repository.is_public ? 'public' : 'private',
      });
      setModalMode('edit');
    },
    [defaultNamespace]
  );

  const refreshQuay = useCallback(() => {
    repositoryQuery.refresh();
    status.refresh();
  }, [repositoryQuery, status]);

  const submitRepositoryForm = useCallback(async () => {
    if (!modalMode) return;
    setIsSubmitting(true);
    try {
      const result = await postRequest<QuayRepositoryActionResponse, QuayRepositoryForm>(
        awxAPI`/quay/repositories/update/`,
        repositoryForm
      );
      alertToaster.addAlert({
        variant: 'success',
        title: t('Project Quay repository {{repository}} updated.', {
          repository: result.repository_path,
        }),
        timeout: 4000,
      });
      closeModal();
      refreshQuay();
    } catch (err) {
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Failed to update Project Quay repository'),
        children: err instanceof Error ? err.message : String(err),
      });
      setIsSubmitting(false);
    }
  }, [alertToaster, closeModal, modalMode, refreshQuay, repositoryForm, t]);

  const changeVisibility = useCallback(
    async (repository: QuayRepository, enabled: boolean) => {
      try {
        const result = await postRequest<
          QuayRepositoryActionResponse,
          { repository: string; namespace: string; visibility: 'public' | 'private' }
        >(awxAPI`/quay/repositories/change-visibility/`, {
          repository: repository.name || '',
          namespace: repository.namespace || defaultNamespace,
          visibility: enabled ? 'public' : 'private',
        });
        alertToaster.addAlert({
          variant: 'success',
          title: t('Project Quay repository {{repository}} visibility updated.', {
            repository: result.repository_path,
          }),
          timeout: 4000,
        });
        refreshQuay();
      } catch (err) {
        alertToaster.addAlert({
          variant: 'danger',
          title: t('Failed to update Project Quay repository visibility'),
          children: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [alertToaster, defaultNamespace, refreshQuay, t]
  );

  const deleteRepositories = useCallback(
    (repositories: QuayRepository[]) => {
      bulkAction({
        title: t('Delete Project Quay repositories', { count: repositories.length }),
        confirmText: t(
          'Yes, I confirm that I want to delete these {{count}} Project Quay repositories.',
          {
            count: repositories.length,
          }
        ),
        actionButtonText: t('Delete repositories', { count: repositories.length }),
        items: repositories,
        keyFn: (repository) => repositoryKey(repository, defaultNamespace),
        isDanger: true,
        confirmationColumns: tableColumns,
        actionColumns: tableColumns.slice(0, 1),
        onComplete: () => {
          void refreshQuay();
          navigate(repositoriesUrl);
        },
        actionFn: (repository, signal) =>
          postRequest<QuayRepositoryActionResponse, { repository: string; namespace: string }>(
            awxAPI`/quay/repositories/delete/`,
            {
              repository: repository.name || '',
              namespace: repository.namespace || defaultNamespace,
            },
            signal
          ),
      });
    },
    [bulkAction, defaultNamespace, navigate, refreshQuay, repositoriesUrl, t, tableColumns]
  );

  const detailActions = useMemo<IPageAction<QuayRepository>[]>(
    () =>
      canManageRepositories
        ? [
            {
              type: PageActionType.Button,
              selection: PageActionSelection.Single,
              icon: PencilAltIcon,
              isPinned: true,
              label: t('Edit description'),
              onClick: openEditModal,
              variant: ButtonVariant.secondary,
            },
            {
              type: PageActionType.Button,
              selection: PageActionSelection.Single,
              icon: TrashIcon,
              label: t('Delete repository'),
              onClick: (repository) => deleteRepositories([repository]),
              isDanger: true,
            },
          ]
        : [],
    [canManageRepositories, deleteRepositories, openEditModal, t]
  );

  const pageTitle =
    routeNamespace && routeRepository
      ? `${routeNamespace}/${routeRepository}`
      : t('Repository details');

  return (
    <PageLayout>
      <PageHeader
        title={pageTitle}
        breadcrumbs={[{ label: t('Repositories'), to: repositoriesUrl }, { label: pageTitle }]}
        headerActions={
          repository ? (
            <Flex
              flexWrap={{ default: 'nowrap' }}
              spaceItems={{ default: 'spaceItemsSm' }}
              justifyContent={{ default: 'justifyContentFlexEnd' }}
            >
              <FlexItem>
                <ModuleAIAssistantAction
                  module="quay"
                  page={t('Project Quay repository details')}
                  prompt={t(
                    'Review this Project Quay repository for AWX execution environment use. Explain tag health, pull commands, visibility, repository settings, and any cleanup or access risks.'
                  )}
                  context={{
                    namespace: repository.namespace || defaultNamespace,
                    repository: repository.name,
                    visibility: visibility(repository),
                    state: repository.state,
                    registry: statusData?.registry,
                    can_manage: statusData?.can_manage,
                    management_configured: statusData?.management_configured,
                  }}
                />
              </FlexItem>
              {detailActions.length ? (
                <FlexItem>
                  <PageActions<QuayRepository>
                    actions={detailActions}
                    selectedItem={repository}
                    position={DropdownPosition.right}
                    collapse="md"
                  />
                </FlexItem>
              ) : null}
            </Flex>
          ) : undefined
        }
      />
      {statusData && (!statusData.configured || statusData.controller_error) ? (
        <Alert
          isInline
          variant="warning"
          title={t('Project Quay is not ready')}
          style={{ margin: '0 24px 16px' }}
        >
          {statusData.controller_error || statusData.message}
        </Alert>
      ) : null}
      {repositoryQuery.error ? (
        <PageSection style={{ padding: 24 }}>
          <Alert isInline variant="danger" title={t('Unable to load Project Quay repository')}>
            {repositoryQuery.error.message}
          </Alert>
        </PageSection>
      ) : repositoryQuery.isLoading ? (
        <PageSection style={{ padding: 24 }}>
          <Text component={TextVariants.p}>{t('Loading Project Quay repository...')}</Text>
        </PageSection>
      ) : repository ? (
        <QuayRepositoryConsole
          repository={repository}
          statusData={statusData}
          defaultNamespace={defaultNamespace}
          canManageRepositories={canManageRepositories}
          onEdit={openEditModal}
          onDelete={(repository) => deleteRepositories([repository])}
          onChangeVisibility={(repository, enabled) => void changeVisibility(repository, enabled)}
        />
      ) : (
        <PageSection style={{ padding: 24 }}>
          <Alert
            isInline
            variant="info"
            title={t('Project Quay repository was not found')}
            actionLinks={
              <Button component="a" variant="link" href={repositoriesUrl}>
                {t('Back to repositories')}
              </Button>
            }
          >
            {t('Refresh the repositories list or verify the namespace and repository name.')}
          </Alert>
        </PageSection>
      )}
      <QuayRepositoryModal
        modalMode={modalMode}
        repositoryForm={repositoryForm}
        setRepositoryForm={setRepositoryForm}
        isSubmitting={isSubmitting}
        onClose={closeModal}
        onSubmit={() => void submitRepositoryForm()}
      />
    </PageLayout>
  );
}

export function QuayRepositories() {
  const { t } = useTranslation();
  const alertToaster = usePageAlertToaster();
  const toolbarFilters = useQuayFilters();
  const status = useGet<QuayStatus>(awxAPI`/quay/status/`);
  const statusData = status.data;
  const canManageQuay = Boolean(statusData?.can_manage);
  const canManageRepositories = Boolean(
    statusData?.can_manage && statusData?.management_configured
  );
  const defaultNamespace = statusData?.namespace || '';
  const tableColumns = useQuayRepositoryColumns(defaultNamespace);
  const view = useAwxView<QuayRepository>({
    url: awxAPI`/quay/repositories/`,
    toolbarFilters,
    tableColumns,
  });
  const bulkAction = useAwxBulkConfirmation<QuayRepository>();
  const [modalMode, setModalMode] = useState<QuayRepositoryModalMode>();
  const [repositoryForm, setRepositoryForm] = useState<QuayRepositoryForm>({
    repository: '',
    namespace: '',
    description: '',
    visibility: 'private',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const closeModal = useCallback(() => {
    setModalMode(undefined);
    setIsSubmitting(false);
  }, []);

  const openCreateModal = useCallback(() => {
    setRepositoryForm({
      repository: '',
      namespace: defaultNamespace,
      description: '',
      visibility: 'private',
    });
    setModalMode('create');
  }, [defaultNamespace]);

  const openEditModal = useCallback(
    (repository: QuayRepository) => {
      setRepositoryForm({
        repository: repository.name || '',
        namespace: repository.namespace || defaultNamespace,
        description: repository.description || '',
        visibility: repository.is_public ? 'public' : 'private',
      });
      setModalMode('edit');
    },
    [defaultNamespace]
  );

  const refreshQuay = useCallback(async () => {
    await view.refresh();
    status.refresh();
  }, [status, view]);

  const submitRepositoryForm = useCallback(async () => {
    if (!modalMode) return;
    setIsSubmitting(true);
    try {
      const endpoint =
        modalMode === 'create'
          ? awxAPI`/quay/repositories/create/`
          : awxAPI`/quay/repositories/update/`;
      const result = await postRequest<QuayRepositoryActionResponse, QuayRepositoryForm>(
        endpoint,
        repositoryForm
      );
      alertToaster.addAlert({
        variant: 'success',
        title:
          modalMode === 'create'
            ? t('Project Quay repository {{repository}} created.', {
                repository: result.repository_path,
              })
            : t('Project Quay repository {{repository}} updated.', {
                repository: result.repository_path,
              }),
        timeout: 4000,
      });
      closeModal();
      await refreshQuay();
    } catch (err) {
      alertToaster.addAlert({
        variant: 'danger',
        title:
          modalMode === 'create'
            ? t('Failed to create Project Quay repository')
            : t('Failed to update Project Quay repository'),
        children: err instanceof Error ? err.message : String(err),
      });
      setIsSubmitting(false);
    }
  }, [alertToaster, closeModal, modalMode, refreshQuay, repositoryForm, t]);

  const changeVisibility = useCallback(
    async (repository: QuayRepository, enabled: boolean) => {
      try {
        const result = await postRequest<
          QuayRepositoryActionResponse,
          { repository: string; namespace: string; visibility: 'public' | 'private' }
        >(awxAPI`/quay/repositories/change-visibility/`, {
          repository: repository.name || '',
          namespace: repository.namespace || defaultNamespace,
          visibility: enabled ? 'public' : 'private',
        });
        alertToaster.addAlert({
          variant: 'success',
          title: t('Project Quay repository {{repository}} visibility updated.', {
            repository: result.repository_path,
          }),
          timeout: 4000,
        });
        await refreshQuay();
      } catch (err) {
        alertToaster.addAlert({
          variant: 'danger',
          title: t('Failed to update Project Quay repository visibility'),
          children: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [alertToaster, defaultNamespace, refreshQuay, t]
  );

  const deleteRepositories = useCallback(
    (repositories: QuayRepository[]) => {
      bulkAction({
        title: t('Delete Project Quay repositories', { count: repositories.length }),
        confirmText: t(
          'Yes, I confirm that I want to delete these {{count}} Project Quay repositories.',
          {
            count: repositories.length,
          }
        ),
        actionButtonText: t('Delete repositories', { count: repositories.length }),
        items: repositories,
        keyFn: (repository) =>
          repository._awx_key ||
          `${repository.namespace || defaultNamespace}/${repository.name || repository.id}`,
        isDanger: true,
        confirmationColumns: tableColumns,
        actionColumns: tableColumns.slice(0, 1),
        onComplete: () => void refreshQuay(),
        actionFn: (repository, signal) =>
          postRequest<QuayRepositoryActionResponse, { repository: string; namespace: string }>(
            awxAPI`/quay/repositories/delete/`,
            {
              repository: repository.name || '',
              namespace: repository.namespace || defaultNamespace,
            },
            signal
          ),
      });
    },
    [bulkAction, defaultNamespace, refreshQuay, t, tableColumns]
  );

  const toolbarActions = useMemo<IPageAction<QuayRepository>[]>(
    () =>
      canManageRepositories
        ? [
            {
              type: PageActionType.Button,
              selection: PageActionSelection.None,
              icon: PlusCircleIcon,
              isPinned: true,
              label: t('Create repository'),
              onClick: openCreateModal,
              variant: ButtonVariant.primary,
            },
            { type: PageActionType.Seperator },
            {
              type: PageActionType.Button,
              selection: PageActionSelection.Multiple,
              icon: TrashIcon,
              label: t('Delete repositories'),
              onClick: deleteRepositories,
              isDanger: true,
            },
          ]
        : [],
    [canManageRepositories, deleteRepositories, openCreateModal, t]
  );

  const rowActions = useMemo<IPageAction<QuayRepository>[]>(
    () =>
      canManageRepositories
        ? [
            {
              type: PageActionType.Switch,
              selection: PageActionSelection.Single,
              label: t('Public repository'),
              labelOff: t('Private repository'),
              ariaLabel: (isPublic) =>
                isPublic
                  ? t('Click to make repository private')
                  : t('Click to make repository public'),
              isSwitchOn: (repository) => Boolean(repository.is_public),
              onToggle: (repository, enabled) => void changeVisibility(repository, enabled),
              isDisabled: (repository) =>
                repository.name ? undefined : t('This repository does not include a name.'),
              isPinned: true,
            },
            {
              type: PageActionType.Button,
              selection: PageActionSelection.Single,
              icon: PencilAltIcon,
              label: t('Edit description'),
              onClick: openEditModal,
              isDisabled: (repository) =>
                repository.name ? undefined : t('This repository does not include a name.'),
            },
            {
              type: PageActionType.Button,
              selection: PageActionSelection.Single,
              icon: TrashIcon,
              label: t('Delete repository'),
              onClick: (repository) => deleteRepositories([repository]),
              isDisabled: (repository) =>
                repository.name ? undefined : t('This repository does not include a name.'),
              isDanger: true,
            },
          ]
        : [],
    [canManageRepositories, changeVisibility, deleteRepositories, openEditModal, t]
  );

  return (
    <PageLayout>
      <PageHeader
        title={t('Repositories')}
        description={t('Project Quay repositories visible to AWX for execution environments.')}
        headerActions={
          <ModuleAIAssistantAction
            module="quay"
            page={t('Project Quay repositories')}
            prompt={t(
              'Help me review Project Quay repositories for AWX execution environment images. Explain whether repository names, namespaces, and visibility look correct for AWX usage.'
            )}
            context={{
              namespace: statusData?.namespace,
              registry: statusData?.registry,
              can_manage: statusData?.can_manage,
              management_configured: statusData?.management_configured,
            }}
          />
        }
      />
      {statusData && (!statusData.configured || statusData.controller_error) ? (
        <Alert
          isInline
          variant="warning"
          title={t('Project Quay is not ready')}
          style={{ margin: '0 24px 16px' }}
        >
          {statusData.controller_error || statusData.message}
        </Alert>
      ) : null}
      {statusData && statusData.configured && !canManageQuay ? (
        <Alert
          isInline
          variant="info"
          title={t('Read-only Project Quay access')}
          style={{ margin: '0 24px 16px' }}
        >
          {t(
            'You can inspect Project Quay repositories, but repository management actions require Quay management permission.'
          )}
        </Alert>
      ) : null}
      {statusData && statusData.configured && canManageQuay && !canManageRepositories ? (
        <Alert
          isInline
          variant="warning"
          title={t('Project Quay repository management needs an API token.')}
          style={{ margin: '0 24px 16px' }}
        >
          {t(
            'Configure QUAY_API_TOKEN with repo:read, repo:create, repo:write, and repo:admin scopes before creating, editing, or deleting repositories from AWX.'
          )}
        </Alert>
      ) : null}
      <PageTable<QuayRepository>
        id="quay-repositories-table"
        toolbarFilters={toolbarFilters}
        tableColumns={tableColumns}
        toolbarActions={toolbarActions}
        rowActions={rowActions}
        emptyStateActions={toolbarActions.slice(0, 1)}
        errorStateTitle={t('Error loading Project Quay repositories')}
        emptyStateTitle={t('No Project Quay repositories found')}
        emptyStateDescription={t(
          'Configure Project Quay settings or push an execution environment image to populate this view.'
        )}
        {...view}
      />
      <QuayRepositoryModal
        modalMode={modalMode}
        repositoryForm={repositoryForm}
        setRepositoryForm={setRepositoryForm}
        isSubmitting={isSubmitting}
        onClose={closeModal}
        onSubmit={() => void submitRepositoryForm()}
      />
    </PageLayout>
  );
}
