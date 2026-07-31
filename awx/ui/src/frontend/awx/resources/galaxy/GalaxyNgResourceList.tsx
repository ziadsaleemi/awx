import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Card, CardBody, CardHeader, Label } from '@patternfly/react-core';
import {
  AnsibleTowerIcon,
  CheckCircleIcon,
  CubesIcon,
  EllipsisVIcon,
  ExclamationTriangleIcon,
  SyncAltIcon,
  TimesCircleIcon,
  UsersIcon,
} from '@patternfly/react-icons';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import {
  DateTimeCell,
  IPageAction,
  ITableColumn,
  IToolbarFilter,
  PageActionSelection,
  PageActionType,
  PageHeader,
  PageLayout,
  PageTable,
  TextCell,
  ToolbarFilterType,
  usePageAlertToaster,
} from '../../../../framework';
import { PageTableViewTypeE } from '../../../../framework/PageToolbar/PageTableViewType';
import { StatusCell } from '../../../common/Status';
import { postRequest } from '../../../common/crud/Data';
import { useGet } from '../../../common/crud/useGet';
import { awxAPI } from '../../common/api/awx-utils';
import { useAwxActiveUser } from '../../common/useAwxActiveUser';
import { useAwxView } from '../../common/useAwxView';
import { GalaxyNgStatus } from './GalaxyNgStatus';
import { GalaxyNgHeaderActions } from './GalaxyNgHeaderActions';

const CollectionCardsGrid = styled.div`
  display: grid;
  gap: 24px;
  grid-template-columns: repeat(auto-fill, minmax(320px, 360px));
  align-items: stretch;
  padding: 24px;

  @media (max-width: 640px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;

const CollectionBrowseCard = styled(Card)`
  height: 100%;
  background-color: #222428;
  border-color: var(--pf-v5-c-table--BorderColor, var(--pf-v5-global--BorderColor--100));
`;

const CollectionCardBody = styled(CardBody)`
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 14px;
  padding: 0 24px 22px;
  text-align: center;
`;

const CollectionCardHeaderContent = styled.div`
  position: relative;
  display: grid;
  width: 100%;
  min-height: 96px;
  align-items: center;
  justify-items: center;
  padding-top: 22px;
`;

const CollectionLogo = styled.div`
  display: inline-flex;
  width: 52px;
  height: 52px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #000;
  color: #fff;
  font-size: 31px;
`;

const CollectionCardBadges = styled.div`
  position: absolute;
  top: 0;
  right: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: flex-end;
  max-width: 62%;
  gap: 6px;
`;

const CollectionCardKebab = styled.span`
  display: inline-flex;
  min-width: 18px;
  justify-content: center;
  color: var(--pf-v5-global--Color--200);
`;

const CollectionCardIdentity = styled.div`
  display: flex;
  max-width: 100%;
  flex-direction: column;
  align-items: center;
  gap: 4px;
`;

const CollectionCardTitle = styled(Link)`
  color: var(--pf-v5-global--link--Color);
  font-size: 1.12rem;
  font-weight: 700;
  line-height: 1.25;
  text-decoration: none;
  word-break: break-word;

  &:hover {
    color: var(--pf-v5-global--link--Color--hover);
    text-decoration: underline;
  }
`;

const CollectionProvider = styled.div`
  color: var(--pf-v5-global--Color--200);
  font-size: 0.95rem;
  line-height: 1.35;
`;

const CollectionDescription = styled.div`
  max-width: 23.5rem;
  margin: 0 auto;
  color: var(--pf-v5-global--Color--100);
  font-size: 0.9rem;
  line-height: 1.38;
  overflow-wrap: anywhere;
`;

const CollectionMetrics = styled.div`
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px;
  margin-top: 4px;
  padding-top: 16px;
  border-top: 1px solid var(--pf-v5-c-table--BorderColor, var(--pf-v5-global--BorderColor--100));
`;

const CollectionMetricValue = styled.div`
  color: var(--pf-v5-global--Color--100);
  font-size: 1.08rem;
  font-weight: 600;
  line-height: 1.25;
`;

const CollectionMetricLabel = styled.div`
  color: var(--pf-v5-global--Color--200);
  font-size: 0.72rem;
  line-height: 1.25;
  white-space: nowrap;
  overflow-wrap: anywhere;
`;

export type GalaxyNgResourceKind =
  | 'namespaces'
  | 'collections'
  | 'repositories'
  | 'remotes'
  | 'remote-registries'
  | 'signature-keys'
  | 'collection-approvals'
  | 'tasks';

const GALAXY_NG_COLLECTIONS_RESOURCE: GalaxyNgResourceKind = 'collections';
export const GALAXY_NG_MODULE_CONTENT_KIND = 'module';
export const GALAXY_NG_ROLE_CONTENT_KIND = 'role';
export const GALAXY_NG_PLUGIN_CONTENT_KIND = 'plugin';
const GALAXY_NG_UNSIGNED_STATE = 'unsigned';
const GALAXY_NG_SIGNED_STATE = 'signed';

export interface GalaxyNgRecord {
  id: number;
  _awx_key?: string;
  name?: string;
  namespace?: string;
  company?: string;
  email?: string;
  avatar_url?: string;
  avatar_sha256?: string | null;
  metadata_sha256?: string;
  base_path?: string;
  description?: string;
  pulp_href?: string;
  href?: string;
  state?: string;
  version?: string;
  highest_version?: {
    version?: string;
    href?: string;
  };
  latest_version?: {
    version?: string;
    href?: string;
  };
  deprecated?: boolean;
  download_count?: number;
  metadata?: {
    authors?: string[];
    contents?: GalaxyNgCollectionContent[];
    dependencies?: Record<string, string>;
    description?: string;
    documentation?: string;
    homepage?: string;
    issues?: string;
    license?: string[];
    repository?: string;
    tags?: string[];
    signatures?: unknown[];
  };
  contents?: GalaxyNgCollectionContent[];
  dependencies?: Record<string, string>;
  signatures?: unknown[];
  requires_ansible?: string;
  artifact?: {
    filename?: string;
    sha256?: string;
    size?: number;
  };
  download_url?: string;
  version_created_at?: string;
  version_updated_at?: string;
  version_detail_error?: string;
  latest_version_detail?: Record<string, unknown>;
  groups?: Array<{
    name?: string;
    object_roles?: string[];
  }>;
  users?: Array<{
    username?: string;
    name?: string;
    object_roles?: string[];
  }>;
  repository_list?: string[];
  sign_state?: string;
  repository?: string;
  remote?: string;
  url?: string;
  policy?: string;
  hidden_fields?: Array<{
    name?: string;
    is_set?: boolean;
  }>;
  tls_validation?: boolean;
  rate_limit?: number;
  download_concurrency?: number;
  sync_dependencies?: boolean;
  signed_only?: boolean;
  private?: boolean;
  retain_repo_versions?: number;
  last_sync_task?: string | null;
  last_synced_metadata_time?: string | null;
  auth_url?: string | null;
  script?: string;
  public_key?: string;
  pubkey_fingerprint?: string;
  created_at?: string;
  updated_at?: string;
  pulp_created?: string;
  pulp_last_updated?: string;
  started_at?: string;
  finished_at?: string;
  progress_reports?: Array<{
    message?: string;
    state?: string;
    total?: number;
    done?: number;
    suffix?: string | null;
  }>;
  created_resources?: string[];
  reserved_resources_record?: string[];
  error?: {
    description?: string;
  };
}

export interface GalaxyNgCollectionContent {
  name?: string;
  description?: string | null;
  content_type?: string;
  type?: string;
  object_type?: string;
}

export function getGalaxyNgDate(record: GalaxyNgRecord) {
  return (
    record.started_at ||
    record.finished_at ||
    record.version_updated_at ||
    record.updated_at ||
    record.created_at ||
    record.pulp_last_updated ||
    record.pulp_created ||
    undefined
  );
}

export function getGalaxyNgCollectionName(record: GalaxyNgRecord) {
  const namespace = record.namespace || '';
  const name = record.name || '';
  return namespace && name ? `${namespace}.${name}` : name || namespace || record.pulp_href || '';
}

export function getGalaxyNgLatestVersion(record: GalaxyNgRecord) {
  return record.highest_version?.version || record.latest_version?.version || record.version || '';
}

export function getGalaxyNgDescription(record: GalaxyNgRecord) {
  return record.metadata?.description || record.description || '';
}

export function getGalaxyNgRepositoryName(record: GalaxyNgRecord) {
  return record.repository || record.repository_list?.[0] || '';
}

export function getGalaxyNgContentItems(record: GalaxyNgRecord) {
  if (Array.isArray(record.contents)) return record.contents;
  if (Array.isArray(record.metadata?.contents)) return record.metadata.contents;
  return [];
}

export function getGalaxyNgDependencies(record: GalaxyNgRecord) {
  return record.dependencies || record.metadata?.dependencies || {};
}

export function getGalaxyNgSignatureState(record: GalaxyNgRecord) {
  if (record.sign_state) return record.sign_state.toLowerCase();
  const signatures = record.signatures || record.metadata?.signatures;
  if (Array.isArray(signatures)) {
    return signatures.length ? GALAXY_NG_SIGNED_STATE : GALAXY_NG_UNSIGNED_STATE;
  }
  return '';
}

export function getGalaxyNgInstallCommand(record: GalaxyNgRecord) {
  const name = getGalaxyNgCollectionName(record);
  return name ? `ansible-galaxy collection install ${name}` : '';
}

export function getGalaxyNgOwnerNames(record: GalaxyNgRecord) {
  return [
    ...(record.groups || []).map((group) => group.name || ''),
    ...(record.users || []).map((user) => user.username || user.name || ''),
  ].filter(Boolean);
}

function getContentType(value: unknown) {
  if (!value || typeof value !== 'object') return '';
  const record = value as {
    content_type?: string;
    type?: string;
    object_type?: string;
    name?: string;
  };
  return `${record.content_type || record.type || record.object_type || record.name || ''}`.toLowerCase();
}

export function countCollectionContent(record: GalaxyNgRecord, kind: 'module' | 'role' | 'plugin') {
  const contents = getGalaxyNgContentItems(record);
  if (!contents.length) return 0;
  if (kind === GALAXY_NG_PLUGIN_CONTENT_KIND) {
    return contents.filter((content) => {
      const type = getContentType(content);
      return (
        type &&
        !type.includes(GALAXY_NG_MODULE_CONTENT_KIND) &&
        !type.includes(GALAXY_NG_ROLE_CONTENT_KIND)
      );
    }).length;
  }
  return contents.filter((content) => getContentType(content).includes(kind)).length;
}

export function getGalaxyNgResourceIdentity(
  resource: GalaxyNgResourceKind,
  record: GalaxyNgRecord
) {
  if (record._awx_key) return record._awx_key;
  if (typeof record.id === 'number') return String(record.id);
  if (resource === 'collections') return getGalaxyNgCollectionName(record);
  if (resource === 'namespaces') return record.name || record.namespace || '';
  return (
    record.name || record.namespace || record.pulp_href || record.href || record.base_path || ''
  );
}

function encodeGalaxyNgRouteKey(value: string) {
  const encoded = btoa(unescape(encodeURIComponent(value)));
  return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeGalaxyNgRouteKey(value: string | undefined) {
  if (!value) return '';
  try {
    const padded = value
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(value.length / 4) * 4, '=');
    return decodeURIComponent(escape(atob(padded)));
  } catch {
    return value;
  }
}

export function getGalaxyNgResourceDetailPath(
  resource: GalaxyNgResourceKind,
  record: GalaxyNgRecord
) {
  return `/galaxy-ng/${resource}/${encodeGalaxyNgRouteKey(getGalaxyNgResourceIdentity(resource, record))}`;
}

export function galaxyNgRecordMatchesKey(
  resource: GalaxyNgResourceKind,
  record: GalaxyNgRecord,
  routeKey: string | undefined
) {
  const key = decodeGalaxyNgRouteKey(routeKey);
  const candidates = [
    getGalaxyNgResourceIdentity(resource, record),
    record._awx_key,
    typeof record.id === 'number' ? String(record.id) : undefined,
    getGalaxyNgCollectionName(record),
    record.name,
    record.namespace,
    record.pulp_href,
    record.href,
    record.base_path,
  ].filter(Boolean);
  return candidates.includes(key);
}

interface GalaxyNgSyncResponse {
  source: string;
  repository: string;
  base_path: string;
  task?: string | null;
  response?: Record<string, unknown>;
}

interface GalaxyNgApprovalResponse {
  source: string;
  action: 'approve' | 'reject';
  namespace: string;
  name: string;
  version: string;
  source_repository: string;
  destination_repository: string;
  task?: string | number | null;
  remove_task?: string | number | null;
  response?: Record<string, unknown>;
}

export const galaxyNgResourceTitles: Record<GalaxyNgResourceKind, string> = {
  namespaces: 'Namespaces',
  collections: 'Collections',
  repositories: 'Repositories',
  remotes: 'Remotes',
  'remote-registries': 'Remote Registries',
  'signature-keys': 'Signature Keys',
  'collection-approvals': 'Collection Approvals',
  tasks: 'Tasks',
};

export const galaxyNgResourceDescriptions: Record<GalaxyNgResourceKind, string> = {
  namespaces: 'Collection namespaces available in the private automation hub.',
  collections: 'Collections available to Capstan project updates and execution environments.',
  repositories: 'Pulp Ansible repositories backing Galaxy NG content distribution.',
  remotes: 'Remote Automation Hub sources Galaxy NG can sync collections from.',
  'remote-registries':
    'Remote container registries Galaxy NG can sync execution environment content from.',
  'signature-keys': 'Signing services used to sign and verify Automation Hub content.',
  'collection-approvals': 'Staged collection versions waiting for review before promotion.',
  tasks: 'Galaxy NG and Pulp import, sync, copy, and publish tasks.',
};

function shortTaskName(value?: string) {
  if (!value) return '';
  const parts = value.split('.');
  return parts.slice(-2).join('.') || value;
}

function formatUrl(value?: string) {
  if (!value) return '';
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return value;
  }
}

function formatDuration(start?: string, finish?: string) {
  if (!start || !finish) return '';
  const startMs = Date.parse(start);
  const finishMs = Date.parse(finish);
  if (!Number.isFinite(startMs) || !Number.isFinite(finishMs) || finishMs < startMs) return '';
  const seconds = Math.round((finishMs - startMs) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

function boolLabel(value: boolean | undefined, trueText: string, falseText: string) {
  return (
    <Label color={value ? 'green' : 'grey'} icon={value ? <CheckCircleIcon /> : undefined}>
      {value ? trueText : falseText}
    </Label>
  );
}

function progressText(record: GalaxyNgRecord) {
  const progress = record.progress_reports || [];
  if (!progress.length) return '-';
  const active = progress.find((item) => item.state && item.state !== 'completed');
  if (active) return active.message || active.state || '-';
  const completed = progress.filter((item) => item.state === 'completed').length;
  return `${completed}/${progress.length} completed`;
}

function GalaxyNgCollectionCards(props: { collections: GalaxyNgRecord[] }) {
  const { t } = useTranslation();
  const { collections } = props;

  return (
    <CollectionCardsGrid>
      {collections.map((collection) => {
        const detailPath = getGalaxyNgResourceDetailPath(
          GALAXY_NG_COLLECTIONS_RESOURCE,
          collection
        );
        const description =
          getGalaxyNgDescription(collection) ||
          t('No collection description has been published yet.');
        const modules = countCollectionContent(collection, GALAXY_NG_MODULE_CONTENT_KIND);
        const roles = countCollectionContent(collection, GALAXY_NG_ROLE_CONTENT_KIND);
        const plugins = countCollectionContent(collection, GALAXY_NG_PLUGIN_CONTENT_KIND);
        const dependencies = Object.keys(getGalaxyNgDependencies(collection)).length;
        const repository = getGalaxyNgRepositoryName(collection);
        const signatureState = getGalaxyNgSignatureState(collection);
        const isSigned = signatureState === GALAXY_NG_SIGNED_STATE;
        const isUnsigned = signatureState === GALAXY_NG_UNSIGNED_STATE;

        return (
          <CollectionBrowseCard
            key={getGalaxyNgResourceIdentity(GALAXY_NG_COLLECTIONS_RESOURCE, collection)}
            isFlat
            isRounded
          >
            <CardHeader>
              <CollectionCardHeaderContent>
                <CollectionLogo aria-hidden="true">
                  <AnsibleTowerIcon />
                </CollectionLogo>
                <CollectionCardBadges>
                  {repository ? (
                    <Label color="blue" isCompact>
                      {repository}
                    </Label>
                  ) : null}
                  {isSigned || isUnsigned ? (
                    <Label
                      color={isSigned ? 'green' : 'orange'}
                      icon={isSigned ? <CheckCircleIcon /> : <ExclamationTriangleIcon />}
                      isCompact
                      variant="outline"
                    >
                      {isSigned ? t('Signed') : t('Unsigned')}
                    </Label>
                  ) : null}
                  {collection.deprecated ? (
                    <Label color="grey" isCompact>
                      {t('Deprecated')}
                    </Label>
                  ) : null}
                  <CollectionCardKebab aria-hidden="true">
                    <EllipsisVIcon />
                  </CollectionCardKebab>
                </CollectionCardBadges>
              </CollectionCardHeaderContent>
            </CardHeader>
            <CollectionCardBody>
              <CollectionCardIdentity>
                <CollectionCardTitle to={detailPath}>
                  {collection.name || getGalaxyNgCollectionName(collection)}
                </CollectionCardTitle>
                <CollectionProvider>
                  {t('Provided by {{provider}}', {
                    provider: collection.namespace || t('Unknown provider'),
                  })}
                </CollectionProvider>
              </CollectionCardIdentity>
              <CollectionDescription>{description}</CollectionDescription>
              <CollectionMetrics>
                <div>
                  <CollectionMetricValue>{modules}</CollectionMetricValue>
                  <CollectionMetricLabel>{t('Modules')}</CollectionMetricLabel>
                </div>
                <div>
                  <CollectionMetricValue>{roles}</CollectionMetricValue>
                  <CollectionMetricLabel>{t('Roles')}</CollectionMetricLabel>
                </div>
                <div>
                  <CollectionMetricValue>{plugins}</CollectionMetricValue>
                  <CollectionMetricLabel>
                    {plugins === 1 ? t('Plugin') : t('Plugins')}
                  </CollectionMetricLabel>
                </div>
                <div>
                  <CollectionMetricValue>{dependencies}</CollectionMetricValue>
                  <CollectionMetricLabel>{t('Dependencies')}</CollectionMetricLabel>
                </div>
              </CollectionMetrics>
            </CollectionCardBody>
          </CollectionBrowseCard>
        );
      })}
    </CollectionCardsGrid>
  );
}

export function GalaxyNgResourceList(props: { resource: GalaxyNgResourceKind }) {
  const { resource } = props;
  const { t } = useTranslation();
  const alertToaster = usePageAlertToaster();
  const { activeAwxUser } = useAwxActiveUser();
  const canManageGalaxy = Boolean(activeAwxUser?.is_superuser);
  const tableColumns = useGalaxyNgColumns(resource);
  const toolbarFilters = useGalaxyNgFilters();
  const status = useGet<GalaxyNgStatus>(awxAPI`/galaxy_ng/status/`);
  const view = useAwxView<GalaxyNgRecord>({
    url: awxAPI`/galaxy_ng/${resource}/`,
    toolbarFilters,
    tableColumns,
  });

  const syncRepository = useCallback(
    async (record: GalaxyNgRecord) => {
      const repository = record.base_path || record.name || record.repository || '';
      try {
        const result = await postRequest<GalaxyNgSyncResponse, { repository: string }>(
          awxAPI`/galaxy_ng/repositories/sync/`,
          { repository }
        );
        alertToaster.addAlert({
          variant: 'success',
          title: result.task
            ? t('Galaxy NG repository sync requested. Task: {{task}}', { task: result.task })
            : t('Galaxy NG repository sync requested.'),
          timeout: 4000,
        });
        await view.refresh();
      } catch (err) {
        alertToaster.addAlert({
          variant: 'danger',
          title: t('Failed to sync Galaxy NG repository'),
          children: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [alertToaster, t, view]
  );

  const moveCollectionApproval = useCallback(
    async (record: GalaxyNgRecord, action: 'approve' | 'reject') => {
      try {
        const result = await postRequest<
          GalaxyNgApprovalResponse,
          { namespace: string; name: string; version: string }
        >(awxAPI`/galaxy_ng/collection-approvals/${action}/`, {
          namespace: record.namespace || '',
          name: record.name || '',
          version: record.version || '',
        });
        alertToaster.addAlert({
          variant: 'success',
          title: result.task
            ? t('Galaxy NG collection {{action}} requested. Task: {{task}}', {
                action: action === 'approve' ? t('approval') : t('rejection'),
                task: result.task,
              })
            : t('Galaxy NG collection {{action}} requested.', {
                action: action === 'approve' ? t('approval') : t('rejection'),
              }),
          timeout: 4000,
        });
        await view.refresh();
      } catch (err) {
        alertToaster.addAlert({
          variant: 'danger',
          title:
            action === 'approve'
              ? t('Failed to approve Galaxy NG collection')
              : t('Failed to reject Galaxy NG collection'),
          children: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [alertToaster, t, view]
  );

  const rowActions = useMemo<IPageAction<GalaxyNgRecord>[]>(() => {
    if (resource === 'repositories') {
      return [
        {
          type: PageActionType.Button,
          selection: PageActionSelection.Single,
          icon: SyncAltIcon,
          label: t('Sync'),
          isDisabled: (record) => {
            if (!canManageGalaxy) {
              return t('You need system administrator permissions to sync Galaxy NG repositories.');
            }
            const repository = record.base_path || record.name || record.repository;
            if (!repository) {
              return t('This repository does not include a syncable name.');
            }
            return undefined;
          },
          onClick: (record) => void syncRepository(record),
        },
      ];
    }

    if (resource === 'collection-approvals') {
      const disableApprovalAction = (record: GalaxyNgRecord) => {
        if (!canManageGalaxy) {
          return t('You need system administrator permissions to approve or reject collections.');
        }
        if (!record.namespace || !record.name || !record.version) {
          return t('This staged collection does not include namespace, name, and version.');
        }
        return undefined;
      };
      return [
        {
          type: PageActionType.Button,
          selection: PageActionSelection.Single,
          icon: CheckCircleIcon,
          label: t('Approve'),
          isDisabled: disableApprovalAction,
          onClick: (record) => void moveCollectionApproval(record, 'approve'),
        },
        {
          type: PageActionType.Button,
          selection: PageActionSelection.Single,
          icon: TimesCircleIcon,
          label: t('Reject'),
          isDisabled: disableApprovalAction,
          onClick: (record) => void moveCollectionApproval(record, 'reject'),
        },
      ];
    }

    return [];
  }, [canManageGalaxy, moveCollectionApproval, resource, syncRepository, t]);

  const title = t(galaxyNgResourceTitles[resource]);
  const description = t(galaxyNgResourceDescriptions[resource]);
  const useCollectionCards = resource === 'collections' && view.pageItems !== undefined;

  return (
    <PageLayout>
      <PageHeader
        title={title}
        description={description}
        headerActions={
          <GalaxyNgHeaderActions
            page={title}
            prompt={t(
              'Help me review this Galaxy NG resource page for Capstan. Explain what this resource does, what looks missing or unhealthy, and what actions should be taken next.'
            )}
            context={{
              resource,
              configured: status.data?.configured,
              server_url: status.data?.server_url,
              controller_error: status.data?.controller_error,
            }}
          />
        }
      />
      {status.data && !status.data.configured ? (
        <Alert
          isInline
          variant="warning"
          title={t('Galaxy NG is not configured')}
          style={{ margin: '0 24px 16px' }}
        >
          {status.data.message}
        </Alert>
      ) : status.data?.controller_error ? (
        <Alert
          isInline
          variant="danger"
          title={t('Galaxy NG is unavailable')}
          style={{ margin: '0 24px 16px' }}
        >
          {status.data.controller_error}
        </Alert>
      ) : status.data?.compatibility && status.data.compatibility.state !== 'compatible' ? (
        <Alert
          isInline
          variant="warning"
          title={t('Galaxy NG compatibility needs attention')}
          style={{ margin: '0 24px 16px' }}
        >
          {status.data.compatibility.error || status.data.compatibility.message}
        </Alert>
      ) : null}
      <PageTable<GalaxyNgRecord>
        id={`galaxy-ng-${resource}-table`}
        toolbarFilters={toolbarFilters}
        tableColumns={tableColumns}
        rowActions={rowActions}
        defaultTableView={
          resource === 'collections' || resource === 'namespaces'
            ? PageTableViewTypeE.Cards
            : undefined
        }
        topContent={
          useCollectionCards ? (
            <GalaxyNgCollectionCards collections={view.pageItems || []} />
          ) : undefined
        }
        hideTable={useCollectionCards}
        disableTableView={resource === 'collections' || resource === 'namespaces'}
        disableListView={resource === 'collections' || resource === 'namespaces'}
        defaultSubtitle={
          resource === 'collections'
            ? t('Collection')
            : resource === 'namespaces'
              ? t('Namespace')
              : undefined
        }
        errorStateTitle={t('Error loading Galaxy NG {{resource}}', { resource: title })}
        emptyStateTitle={t('No Galaxy NG {{resource}} found', { resource: title.toLowerCase() })}
        emptyStateDescription={t('Configure Galaxy NG and sync content to populate this view.')}
        {...view}
      />
    </PageLayout>
  );
}

function useGalaxyNgFilters(): IToolbarFilter[] {
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

function useGalaxyNgColumns(resource: GalaxyNgResourceKind): ITableColumn<GalaxyNgRecord>[] {
  const { t } = useTranslation();
  return useMemo(() => {
    if (resource === 'collections') {
      return [
        {
          header: t('Collection'),
          type: 'text',
          value: (record) => getGalaxyNgCollectionName(record),
          to: (record) => getGalaxyNgResourceDetailPath(resource, record),
          sort: 'name',
          card: 'name',
          list: 'name',
          icon: () => <CubesIcon />,
        },
        {
          header: t('Provided by'),
          type: 'text',
          value: (record) => record.namespace || '-',
          card: 'subtitle',
          list: 'subtitle',
          table: 'hidden',
        },
        {
          header: t('Description'),
          type: 'description',
          value: (record) =>
            getGalaxyNgDescription(record) ||
            t('No collection description has been published yet.'),
          table: 'description',
          card: 'description',
          list: 'description',
        },
        {
          header: t('Version'),
          type: 'text',
          value: (record) => getGalaxyNgLatestVersion(record) || '-',
        },
        {
          header: t('Downloads'),
          type: 'count',
          value: (record) => record.download_count ?? 0,
          sort: 'download_count',
        },
        {
          header: t('Modules'),
          type: 'count',
          value: (record) => countCollectionContent(record, 'module'),
          table: 'hidden',
        },
        {
          header: t('Roles'),
          type: 'count',
          value: (record) => countCollectionContent(record, 'role'),
          table: 'hidden',
        },
        {
          header: t('Plugins'),
          type: 'count',
          value: (record) => countCollectionContent(record, 'plugin'),
          table: 'hidden',
        },
        {
          header: t('Dependencies'),
          type: 'count',
          value: (record) => Object.keys(getGalaxyNgDependencies(record)).length,
          table: 'hidden',
        },
        {
          header: t('Status'),
          type: 'labels',
          value: (record) => [
            record.deprecated ? t('Deprecated') : t('Active'),
            getGalaxyNgLatestVersion(record)
              ? t('v{{version}}', { version: getGalaxyNgLatestVersion(record) })
              : '',
          ],
        },
        {
          header: t('Updated'),
          cell: (record) => <DateTimeCell value={getGalaxyNgDate(record)} />,
          sort: 'updated_at',
          card: 'hidden',
          list: 'hidden',
        },
      ];
    }

    if (resource === 'repositories') {
      return [
        {
          header: t('Name'),
          cell: (record) => (
            <TextCell
              text={record.name || record.pulp_href || '-'}
              to={getGalaxyNgResourceDetailPath(resource, record)}
              maxWidth={260}
            />
          ),
          sort: 'name',
          card: 'name',
          list: 'name',
        },
        {
          header: t('Description'),
          cell: (record) => <TextCell text={record.description || '-'} maxWidth={360} />,
        },
        {
          header: t('Remote'),
          cell: (record) => <TextCell text={record.remote ? t('Configured') : t('None')} />,
        },
        {
          header: t('Access'),
          cell: (record) => boolLabel(!record.private, t('Public'), t('Private')),
        },
        {
          header: t('Retained versions'),
          cell: (record) => <TextCell text={String(record.retain_repo_versions ?? '-')} />,
        },
        {
          header: t('Updated'),
          cell: (record) => <DateTimeCell value={getGalaxyNgDate(record)} />,
          sort: 'pulp_last_updated',
        },
      ];
    }

    if (resource === 'remotes') {
      return [
        {
          header: t('Name'),
          cell: (record) => (
            <TextCell
              text={record.name || record.pulp_href || '-'}
              to={getGalaxyNgResourceDetailPath(resource, record)}
            />
          ),
          sort: 'name',
          card: 'name',
          list: 'name',
        },
        {
          header: t('URL'),
          cell: (record) => <TextCell text={formatUrl(record.url) || '-'} maxWidth={460} />,
        },
        {
          header: t('Policy'),
          cell: (record) => <TextCell text={record.policy || '-'} />,
        },
        {
          header: t('TLS'),
          cell: (record) => boolLabel(record.tls_validation !== false, t('Verify'), t('Disabled')),
        },
        {
          header: t('Dependencies'),
          cell: (record) => boolLabel(record.sync_dependencies !== false, t('Sync'), t('Skip')),
        },
        {
          header: t('Rate limit'),
          cell: (record) => <TextCell text={record.rate_limit ? String(record.rate_limit) : '-'} />,
        },
        {
          header: t('Updated'),
          cell: (record) => <DateTimeCell value={getGalaxyNgDate(record)} />,
          sort: 'pulp_last_updated',
        },
      ];
    }

    if (resource === 'remote-registries') {
      return [
        {
          header: t('Name'),
          cell: (record) => (
            <TextCell
              text={record.name || record.pulp_href || '-'}
              to={getGalaxyNgResourceDetailPath(resource, record)}
            />
          ),
          sort: 'name',
          card: 'name',
          list: 'name',
        },
        {
          header: t('URL'),
          cell: (record) => <TextCell text={formatUrl(record.url) || '-'} maxWidth={460} />,
        },
        {
          header: t('TLS validation'),
          cell: (record) => boolLabel(record.tls_validation !== false, t('Enabled'), t('Disabled')),
        },
        {
          header: t('Rate limit'),
          cell: (record) => <TextCell text={record.rate_limit ? String(record.rate_limit) : '-'} />,
        },
        {
          header: t('Updated'),
          cell: (record) => <DateTimeCell value={getGalaxyNgDate(record)} />,
          sort: 'updated_at',
        },
      ];
    }

    if (resource === 'signature-keys') {
      return [
        {
          header: t('Name'),
          cell: (record) => (
            <TextCell
              text={record.name || record.pulp_href || '-'}
              to={getGalaxyNgResourceDetailPath(resource, record)}
            />
          ),
          sort: 'name',
          card: 'name',
          list: 'name',
        },
        {
          header: t('Fingerprint'),
          cell: (record) => <TextCell text={record.pubkey_fingerprint || '-'} maxWidth={360} />,
        },
        {
          header: t('Script'),
          cell: (record) => <TextCell text={record.script || '-'} maxWidth={420} />,
        },
        {
          header: t('Created'),
          cell: (record) => <DateTimeCell value={getGalaxyNgDate(record)} />,
          sort: 'pulp_last_updated',
        },
      ];
    }

    if (resource === 'collection-approvals') {
      return [
        {
          header: t('Collection'),
          cell: (record) => (
            <TextCell
              text={getGalaxyNgCollectionName(record)}
              to={getGalaxyNgResourceDetailPath(resource, record)}
            />
          ),
          sort: 'name',
          card: 'name',
          list: 'name',
        },
        {
          header: t('Version'),
          cell: (record) => <TextCell text={record.version || '-'} />,
          sort: 'version',
        },
        {
          header: t('Signature'),
          cell: (record) => <StatusCell status={record.sign_state || 'unknown'} />,
        },
        {
          header: t('Repositories'),
          cell: (record) => <TextCell text={record.repository_list?.join(', ') || 'staging'} />,
        },
        {
          header: t('Created'),
          cell: (record) => <DateTimeCell value={getGalaxyNgDate(record)} />,
          sort: 'pulp_created',
        },
      ];
    }

    if (resource === 'tasks') {
      return [
        {
          header: t('Task'),
          cell: (record) => (
            <TextCell
              text={shortTaskName(record.name) || record.pulp_href || record.href || '-'}
              to={getGalaxyNgResourceDetailPath(resource, record)}
              maxWidth={360}
            />
          ),
          card: 'name',
          list: 'name',
        },
        {
          header: t('State'),
          cell: (record) => <StatusCell status={record.state || 'unknown'} />,
          sort: 'state',
        },
        {
          header: t('Created'),
          cell: (record) => <DateTimeCell value={record.pulp_created} />,
          sort: 'pulp_created',
        },
        {
          header: t('Started'),
          cell: (record) => <DateTimeCell value={record.started_at || record.pulp_created} />,
          sort: 'started_at',
        },
        {
          header: t('Duration'),
          cell: (record) => (
            <TextCell text={formatDuration(record.started_at, record.finished_at) || '-'} />
          ),
        },
        {
          header: t('Progress'),
          cell: (record) => <TextCell text={progressText(record)} maxWidth={260} />,
        },
        {
          header: t('Error'),
          cell: (record) => <TextCell text={record.error?.description || '-'} maxWidth={360} />,
        },
      ];
    }

    if (resource === 'namespaces') {
      return [
        {
          header: t('Namespace'),
          type: 'text',
          value: (record) => record.name || record.namespace || '-',
          to: (record) => getGalaxyNgResourceDetailPath(resource, record),
          sort: 'name',
          card: 'name',
          list: 'name',
          icon: () => <UsersIcon />,
        },
        {
          header: t('Company'),
          type: 'text',
          value: (record) => record.company || t('Private namespace'),
          card: 'subtitle',
          list: 'subtitle',
        },
        {
          header: t('Owners'),
          type: 'count',
          value: (record) => getGalaxyNgOwnerNames(record).length,
        },
        {
          header: t('Description'),
          type: 'description',
          value: (record) =>
            record.description || t('No namespace description has been published yet.'),
          table: 'description',
          card: 'description',
          list: 'description',
        },
        {
          header: t('Metadata'),
          type: 'labels',
          value: (record) => [
            record.metadata_sha256 ? t('Metadata synced') : t('Metadata pending'),
            record.avatar_sha256 || record.avatar_url ? t('Avatar') : '',
          ],
          table: 'hidden',
        },
      ];
    }

    return [
      {
        header: t('Name'),
        cell: (record) => (
          <TextCell
            text={record.name || record.namespace || '-'}
            to={getGalaxyNgResourceDetailPath(resource, record)}
          />
        ),
        sort: 'name',
        card: 'name',
        list: 'name',
      },
      {
        header: t('Description'),
        cell: (record) => <TextCell text={record.description || '-'} />,
      },
      {
        header: t('Updated'),
        cell: (record) => <DateTimeCell value={getGalaxyNgDate(record)} />,
        sort: 'updated_at',
      },
    ];
  }, [resource, t]);
}
