import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@patternfly/react-core';
import { CheckCircleIcon, SyncAltIcon, TimesCircleIcon } from '@patternfly/react-icons';
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
import { StatusCell } from '../../../common/Status';
import { postRequest } from '../../../common/crud/Data';
import { useGet } from '../../../common/crud/useGet';
import { awxAPI } from '../../common/api/awx-utils';
import { ModuleAIAssistantAction } from '../../common/ModuleAIAssistantAction';
import { useAwxActiveUser } from '../../common/useAwxActiveUser';
import { useAwxView } from '../../common/useAwxView';
import { GalaxyNgStatus } from './GalaxyNgOverview';

export type GalaxyNgResourceKind =
  | 'namespaces'
  | 'collections'
  | 'repositories'
  | 'remotes'
  | 'remote-registries'
  | 'signature-keys'
  | 'collection-approvals'
  | 'tasks';

interface GalaxyNgRecord {
  id: number;
  name?: string;
  namespace?: string;
  base_path?: string;
  description?: string;
  pulp_href?: string;
  href?: string;
  state?: string;
  version?: string;
  latest_version?: {
    version?: string;
  };
  metadata?: {
    description?: string;
    tags?: string[];
    signatures?: unknown[];
  };
  contents?: unknown[];
  repository_list?: string[];
  sign_state?: string;
  repository?: string;
  remote?: string;
  url?: string;
  policy?: string;
  tls_validation?: boolean;
  rate_limit?: number;
  download_concurrency?: number;
  script?: string;
  pubkey_fingerprint?: string;
  created_at?: string;
  updated_at?: string;
  pulp_created?: string;
  pulp_last_updated?: string;
  started_at?: string;
  finished_at?: string;
  error?: {
    description?: string;
  };
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

const resourceTitles: Record<GalaxyNgResourceKind, string> = {
  namespaces: 'Namespaces',
  collections: 'Collections',
  repositories: 'Repositories',
  remotes: 'Remotes',
  'remote-registries': 'Remote Registries',
  'signature-keys': 'Signature Keys',
  'collection-approvals': 'Collection Approvals',
  tasks: 'Tasks',
};

const resourceDescriptions: Record<GalaxyNgResourceKind, string> = {
  namespaces: 'Collection namespaces available in the private automation hub.',
  collections: 'Collections available to AWX project updates and execution environments.',
  repositories: 'Pulp Ansible repositories backing Galaxy NG content distribution.',
  remotes: 'Remote Automation Hub sources Galaxy NG can sync collections from.',
  'remote-registries':
    'Remote container registries Galaxy NG can sync execution environment content from.',
  'signature-keys': 'Signing services used to sign and verify Automation Hub content.',
  'collection-approvals': 'Staged collection versions waiting for review before promotion.',
  tasks: 'Galaxy NG and Pulp import, sync, copy, and publish tasks.',
};

function getText(record: GalaxyNgRecord, ...keys: Array<keyof GalaxyNgRecord>) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return '';
}

function getDate(record: GalaxyNgRecord) {
  return (
    record.started_at ||
    record.finished_at ||
    record.updated_at ||
    record.created_at ||
    record.pulp_last_updated ||
    record.pulp_created ||
    undefined
  );
}

function collectionName(record: GalaxyNgRecord) {
  const namespace = record.namespace || '';
  const name = record.name || '';
  return namespace && name ? `${namespace}.${name}` : name || namespace || record.pulp_href || '';
}

function latestVersion(record: GalaxyNgRecord) {
  return record.latest_version?.version || record.version || '';
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

  const title = t(resourceTitles[resource]);
  const description = t(resourceDescriptions[resource]);

  return (
    <PageLayout>
      <PageHeader
        title={title}
        description={description}
        headerActions={
          <ModuleAIAssistantAction
            module="galaxy_ng"
            page={title}
            prompt={t(
              'Help me review this Galaxy NG resource page for AWX. Explain what this resource does, what looks missing or unhealthy, and what actions should be taken next.'
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
      ) : null}
      <PageTable<GalaxyNgRecord>
        id={`galaxy-ng-${resource}-table`}
        toolbarFilters={toolbarFilters}
        tableColumns={tableColumns}
        rowActions={rowActions}
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
          cell: (record) => <TextCell text={collectionName(record)} />,
          sort: 'name',
          card: 'name',
          list: 'name',
        },
        {
          header: t('Latest version'),
          cell: (record) => <TextCell text={latestVersion(record) || '-'} />,
        },
        {
          header: t('Description'),
          cell: (record) => <TextCell text={record.description || '-'} />,
        },
      ];
    }

    if (resource === 'repositories') {
      return [
        {
          header: t('Name'),
          cell: (record) => <TextCell text={record.name || record.pulp_href || '-'} />,
          sort: 'name',
          card: 'name',
          list: 'name',
        },
        {
          header: t('Remote'),
          cell: (record) => <TextCell text={getText(record, 'remote', 'repository') || '-'} />,
        },
        {
          header: t('Updated'),
          cell: (record) => <DateTimeCell value={getDate(record)} />,
          sort: 'pulp_last_updated',
        },
      ];
    }

    if (resource === 'remotes') {
      return [
        {
          header: t('Name'),
          cell: (record) => <TextCell text={record.name || record.pulp_href || '-'} />,
          sort: 'name',
          card: 'name',
          list: 'name',
        },
        {
          header: t('URL'),
          cell: (record) => <TextCell text={record.url || '-'} />,
        },
        {
          header: t('Policy'),
          cell: (record) => <TextCell text={record.policy || '-'} />,
        },
        {
          header: t('Updated'),
          cell: (record) => <DateTimeCell value={getDate(record)} />,
          sort: 'pulp_last_updated',
        },
      ];
    }

    if (resource === 'remote-registries') {
      return [
        {
          header: t('Name'),
          cell: (record) => <TextCell text={record.name || record.pulp_href || '-'} />,
          sort: 'name',
          card: 'name',
          list: 'name',
        },
        {
          header: t('URL'),
          cell: (record) => <TextCell text={record.url || '-'} />,
        },
        {
          header: t('TLS validation'),
          cell: (record) => (
            <TextCell text={record.tls_validation === false ? t('Disabled') : t('Enabled')} />
          ),
        },
        {
          header: t('Rate limit'),
          cell: (record) => <TextCell text={record.rate_limit ? String(record.rate_limit) : '-'} />,
        },
        {
          header: t('Updated'),
          cell: (record) => <DateTimeCell value={getDate(record)} />,
          sort: 'updated_at',
        },
      ];
    }

    if (resource === 'signature-keys') {
      return [
        {
          header: t('Name'),
          cell: (record) => <TextCell text={record.name || record.pulp_href || '-'} />,
          sort: 'name',
          card: 'name',
          list: 'name',
        },
        {
          header: t('Fingerprint'),
          cell: (record) => <TextCell text={record.pubkey_fingerprint || '-'} />,
        },
        {
          header: t('Script'),
          cell: (record) => <TextCell text={record.script || '-'} />,
        },
        {
          header: t('Updated'),
          cell: (record) => <DateTimeCell value={getDate(record)} />,
          sort: 'pulp_last_updated',
        },
      ];
    }

    if (resource === 'collection-approvals') {
      return [
        {
          header: t('Collection'),
          cell: (record) => <TextCell text={collectionName(record)} />,
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
          cell: (record) => <DateTimeCell value={getDate(record)} />,
          sort: 'pulp_created',
        },
      ];
    }

    if (resource === 'tasks') {
      return [
        {
          header: t('Task'),
          cell: (record) => (
            <TextCell text={record.name || record.pulp_href || record.href || '-'} />
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
          header: t('Started'),
          cell: (record) => <DateTimeCell value={record.started_at || record.pulp_created} />,
          sort: 'started_at',
        },
        {
          header: t('Error'),
          cell: (record) => <TextCell text={record.error?.description || '-'} />,
        },
      ];
    }

    return [
      {
        header: t('Name'),
        cell: (record) => <TextCell text={record.name || record.namespace || '-'} />,
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
        cell: (record) => <DateTimeCell value={getDate(record)} />,
        sort: 'updated_at',
      },
    ];
  }, [resource, t]);
}
