import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  ButtonVariant,
  ClipboardCopy,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Form,
  FormGroup,
  FormSelect,
  FormSelectOption,
  Grid,
  GridItem,
  Label,
  Modal,
  ModalVariant,
  PageSection,
  Stack,
  StackItem,
  Text,
  TextArea,
  TextInput,
  TextContent,
  TextVariants,
  Title,
} from '@patternfly/react-core';
import {
  CheckCircleIcon,
  PencilAltIcon,
  PlusCircleIcon,
  SecurityIcon,
  TagIcon,
  TrashIcon,
} from '@patternfly/react-icons';
import {
  DateTimeCell,
  IPageAction,
  ITableColumn,
  IToolbarFilter,
  PageActionSelection,
  PageActionType,
  PageHeader,
  PageLayout,
  PageTab,
  PageTable,
  PageTabs,
  TextCell,
  ToolbarFilterType,
  useGetPageUrl,
  usePageAlertToaster,
} from '../../../../framework';
import { AwxItemsResponse } from '../../common/AwxItemsResponse';
import { postRequest } from '../../../common/crud/Data';
import { useGet } from '../../../common/crud/useGet';
import { ModuleAIAssistantAction } from '../../common/ModuleAIAssistantAction';
import { awxAPI } from '../../common/api/awx-utils';
import { ContentSummaryGrid } from '../content/ContentManagementCards';
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

function repositoryKey(repository?: QuayRepository, defaultNamespace = '') {
  if (!repository) return '';
  return (
    repository._awx_key ||
    `${repository.namespace || defaultNamespace}/${repository.name || repository.id}`
  );
}

function repositoryPath(repository?: QuayRepository, defaultNamespace = '') {
  if (!repository?.name) return '-';
  return `${repository.namespace || defaultNamespace}/${repository.name}`;
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

function imageReference(registry: string | undefined, repository: QuayRepository, tag: string) {
  const namespace = repository.namespace || '';
  const repositoryName = repository.name || '';
  if (!registry || !namespace || !repositoryName) return '';
  return `${registry}/${namespace}/${repositoryName}:${tag}`;
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

function useQuayRepositoryColumns(): ITableColumn<QuayRepository>[] {
  const { t } = useTranslation();
  return useMemo(
    () => [
      {
        header: t('Repository'),
        cell: (repository) => <TextCell text={repository.name || '-'} />,
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
    [t]
  );
}

function QuayTagTable(props: {
  tags: QuayImageTag[];
  isLoading?: boolean;
  error?: Error;
  emptyText: string;
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
    <div style={{ overflowX: 'auto' }}>
      <table className="pf-v5-c-table pf-m-compact pf-m-grid-md">
        <thead>
          <tr>
            <th>{t('Tag')}</th>
            <th>{t('Digest')}</th>
            <th>{t('Size')}</th>
            <th>{t('Last modified')}</th>
          </tr>
        </thead>
        <tbody>
          {props.tags.map((tag) => (
            <tr key={tag._awx_key || tag.name || tag.id}>
              <td>
                <Label color="blue" icon={<TagIcon />}>
                  {tag.name || '-'}
                </Label>
              </td>
              <td style={{ overflowWrap: 'anywhere' }}>{tag.manifest_digest || '-'}</td>
              <td>{formatBytes(tag.size)}</td>
              <td>
                <DateTimeCell value={tagTimestamp(tag)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
  const permissionsUrl =
    getPageUrl(AwxRoute.QuayRepositoryPermissions) || '/quay/repository-permissions';
  const eeImagesUrl =
    getPageUrl(AwxRoute.QuayExecutionEnvironmentImages) || '/quay/execution-environment-images';
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
  const path = repositoryPath(repository, props.defaultNamespace);
  const isPublic = Boolean(repository.is_public);
  const modified = lastModified(repository);

  return (
    <PageSection style={{ padding: '16px 24px 20px' }}>
      <Stack hasGutter>
        <StackItem>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 16,
              flexWrap: 'wrap',
            }}
          >
            <TextContent>
              <Title headingLevel="h2" size="xl" style={{ overflowWrap: 'anywhere' }}>
                {path}
              </Title>
              <Text component={TextVariants.p}>
                {repository.description ||
                  t('Execution environment image repository managed through Project Quay.')}
              </Text>
            </TextContent>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Label color={isPublic ? 'blue' : 'grey'} icon={<SecurityIcon />}>
                {isPublic ? t('Public') : t('Private')}
              </Label>
              <Label color="green" icon={<CheckCircleIcon />}>
                {props.statusData?.management_configured
                  ? t('Managed from AWX')
                  : t('Read-only in AWX')}
              </Label>
            </div>
          </div>
        </StackItem>
        <StackItem>
          <ContentSummaryGrid
            minWidth={160}
            metrics={[
              {
                label: t('Repository'),
                value: repository.name || '-',
                detail: namespace || '-',
              },
              {
                label: t('Latest tag'),
                value: latestTag,
                detail: tagItems.length
                  ? t('{{count}} tags loaded', { count: tagItems.length })
                  : t('Tag inventory'),
              },
              {
                label: t('Registry'),
                value: props.statusData?.registry || '-',
                detail: props.statusData?.server_url || '-',
              },
              {
                label: t('Last modified'),
                value: modified ? t('Reported') : '-',
                detail: modified || t('No timestamp reported'),
              },
            ]}
          />
        </StackItem>
        <StackItem>
          <PageTabs>
            <PageTab label={t('Overview')}>
              <div style={{ padding: '24px 0 0' }}>
                <Grid hasGutter>
                  <GridItem sm={12} lg={7}>
                    <Stack hasGutter>
                      <StackItem>
                        <Title headingLevel="h3" size="lg">
                          {t('Pull commands')}
                        </Title>
                      </StackItem>
                      <StackItem>
                        <TextContent>
                          <Text component={TextVariants.small}>
                            {t(
                              'Use these image references when creating AWX execution environments.'
                            )}
                          </Text>
                        </TextContent>
                      </StackItem>
                      <StackItem>
                        <ClipboardCopy isReadOnly hoverTip={t('Copy')} clickTip={t('Copied')}>
                          {image
                            ? `podman pull ${image}`
                            : t('Configure registry and namespace first.')}
                        </ClipboardCopy>
                      </StackItem>
                      <StackItem>
                        <ClipboardCopy isReadOnly hoverTip={t('Copy')} clickTip={t('Copied')}>
                          {image
                            ? `docker pull ${image}`
                            : t('Configure registry and namespace first.')}
                        </ClipboardCopy>
                      </StackItem>
                    </Stack>
                  </GridItem>
                  <GridItem sm={12} lg={5}>
                    <Title headingLevel="h3" size="lg" style={{ marginBottom: 16 }}>
                      {t('Repository details')}
                    </Title>
                    <DescriptionList isHorizontal isCompact>
                      <DescriptionListGroup>
                        <DescriptionListTerm>{t('Namespace')}</DescriptionListTerm>
                        <DescriptionListDescription>{namespace || '-'}</DescriptionListDescription>
                      </DescriptionListGroup>
                      <DescriptionListGroup>
                        <DescriptionListTerm>{t('Visibility')}</DescriptionListTerm>
                        <DescriptionListDescription>
                          {visibility(repository)}
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                      <DescriptionListGroup>
                        <DescriptionListTerm>{t('State')}</DescriptionListTerm>
                        <DescriptionListDescription>
                          {repository.state || '-'}
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                      <DescriptionListGroup>
                        <DescriptionListTerm>{t('Image value')}</DescriptionListTerm>
                        <DescriptionListDescription style={{ overflowWrap: 'anywhere' }}>
                          {image || '-'}
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                    </DescriptionList>
                  </GridItem>
                </Grid>
              </div>
            </PageTab>
            <PageTab label={t('Tags')}>
              <div style={{ padding: '24px 0 0' }}>
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
                  />
                )}
              </div>
            </PageTab>
            <PageTab label={t('Activity')}>
              <div style={{ padding: '24px 0 0' }}>
                <Grid hasGutter>
                  <GridItem sm={12} lg={6}>
                    <Title headingLevel="h3" size="lg" style={{ marginBottom: 16 }}>
                      {t('Recent tag activity')}
                    </Title>
                    <QuayTagTable
                      tags={tagItems.slice(0, 5)}
                      isLoading={tags.isLoading}
                      error={tags.error}
                      emptyText={t('No recent tag activity was reported by Project Quay.')}
                    />
                  </GridItem>
                  <GridItem sm={12} lg={6}>
                    <Alert isInline variant="info" title={t('Usage logs need Quay event data')}>
                      {t(
                        'AWX can show repository and tag state now. Pull/push usage charts and event export need a dedicated Quay usage-log endpoint before they can be rendered with real data.'
                      )}
                    </Alert>
                  </GridItem>
                </Grid>
              </div>
            </PageTab>
            <PageTab label={t('Settings')}>
              <div style={{ padding: '24px 0 0' }}>
                <Grid hasGutter>
                  <GridItem sm={12} lg={6}>
                    <Title headingLevel="h3" size="lg" style={{ marginBottom: 16 }}>
                      {t('Repository management')}
                    </Title>
                    <Stack hasGutter>
                      <StackItem>
                        <Button
                          variant="secondary"
                          icon={<PencilAltIcon />}
                          onClick={() => props.onEdit(repository)}
                          isDisabled={!props.canManageRepositories}
                        >
                          {t('Edit description')}
                        </Button>
                      </StackItem>
                      <StackItem>
                        <Button
                          component="a"
                          href={permissionsUrl}
                          variant="secondary"
                          icon={<SecurityIcon />}
                        >
                          {t('Manage repository permissions')}
                        </Button>
                      </StackItem>
                      <StackItem>
                        <Button
                          variant="secondary"
                          onClick={() => props.onChangeVisibility(repository, !isPublic)}
                          isDisabled={!props.canManageRepositories}
                        >
                          {isPublic ? t('Make private') : t('Make public')}
                        </Button>
                      </StackItem>
                    </Stack>
                  </GridItem>
                  <GridItem sm={12} lg={6}>
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
                  </GridItem>
                </Grid>
              </div>
            </PageTab>
          </PageTabs>
        </StackItem>
      </Stack>
    </PageSection>
  );
}

export function QuayRepositories() {
  const { t } = useTranslation();
  const alertToaster = usePageAlertToaster();
  const toolbarFilters = useQuayFilters();
  const tableColumns = useQuayRepositoryColumns();
  const view = useAwxView<QuayRepository>({
    url: awxAPI`/quay/repositories/`,
    toolbarFilters,
    tableColumns,
  });
  const status = useGet<QuayStatus>(awxAPI`/quay/status/`);
  const statusData = status.data;
  const canManageQuay = Boolean(statusData?.can_manage);
  const canManageRepositories = Boolean(
    statusData?.can_manage && statusData?.management_configured
  );
  const defaultNamespace = statusData?.namespace || '';
  const bulkAction = useAwxBulkConfirmation<QuayRepository>();
  const [modalMode, setModalMode] = useState<QuayRepositoryModalMode>();
  const [selectedRepository, setSelectedRepository] = useState<QuayRepository>();
  const [repositoryForm, setRepositoryForm] = useState<QuayRepositoryForm>({
    repository: '',
    namespace: '',
    description: '',
    visibility: 'private',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const pageItems = view.pageItems ?? [];
    if (!pageItems.length) {
      if (selectedRepository) setSelectedRepository(undefined);
      return;
    }

    const selectedKey = repositoryKey(selectedRepository, defaultNamespace);
    const matchingRepository = pageItems.find(
      (repository) => repositoryKey(repository, defaultNamespace) === selectedKey
    );

    if (!matchingRepository) {
      setSelectedRepository(pageItems[0]);
    } else if (matchingRepository !== selectedRepository) {
      setSelectedRepository(matchingRepository);
    }
  }, [defaultNamespace, selectedRepository, view.pageItems]);

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
        onComplete: () => {
          setSelectedRepository(undefined);
          void refreshQuay();
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
        onSelect={setSelectedRepository}
        topContent={
          <QuayRepositoryConsole
            repository={selectedRepository}
            statusData={statusData}
            defaultNamespace={defaultNamespace}
            canManageRepositories={canManageRepositories}
            onEdit={openEditModal}
            onDelete={(repository) => deleteRepositories([repository])}
            onChangeVisibility={(repository, enabled) => void changeVisibility(repository, enabled)}
          />
        }
        {...view}
      />
      <Modal
        variant={ModalVariant.medium}
        title={
          modalMode === 'create'
            ? t('Create Project Quay repository')
            : t('Edit Project Quay repository')
        }
        isOpen={Boolean(modalMode)}
        onClose={closeModal}
        actions={[
          <Button
            key="submit"
            variant="primary"
            onClick={() => void submitRepositoryForm()}
            isDisabled={
              isSubmitting || !repositoryForm.repository.trim() || !repositoryForm.namespace.trim()
            }
          >
            {modalMode === 'create' ? t('Create repository') : t('Save')}
          </Button>,
          <Button key="cancel" variant="link" onClick={closeModal} isDisabled={isSubmitting}>
            {t('Cancel')}
          </Button>,
        ]}
      >
        <Form>
          <FormGroup label={t('Namespace')} fieldId="quay-repository-namespace" isRequired>
            <TextInput
              id="quay-repository-namespace"
              value={repositoryForm.namespace}
              onChange={(_event, value) =>
                setRepositoryForm((current) => ({ ...current, namespace: value }))
              }
            />
          </FormGroup>
          <FormGroup label={t('Repository')} fieldId="quay-repository-name" isRequired>
            <TextInput
              id="quay-repository-name"
              value={repositoryForm.repository}
              isDisabled={modalMode === 'edit'}
              onChange={(_event, value) =>
                setRepositoryForm((current) => ({ ...current, repository: value }))
              }
            />
          </FormGroup>
          {modalMode === 'create' ? (
            <FormGroup label={t('Visibility')} fieldId="quay-repository-visibility">
              <FormSelect
                id="quay-repository-visibility"
                value={repositoryForm.visibility}
                onChange={(_event, value) =>
                  setRepositoryForm((current) => ({
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
              value={repositoryForm.description}
              onChange={(_event, value) =>
                setRepositoryForm((current) => ({ ...current, description: value }))
              }
            />
          </FormGroup>
        </Form>
      </Modal>
    </PageLayout>
  );
}
