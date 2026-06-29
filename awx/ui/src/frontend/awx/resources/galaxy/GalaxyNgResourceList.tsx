import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@patternfly/react-core';
import {
  DateTimeCell,
  ITableColumn,
  IToolbarFilter,
  PageHeader,
  PageLayout,
  PageTable,
  TextCell,
  ToolbarFilterType,
} from '../../../../framework';
import { StatusCell } from '../../../common/Status';
import { useGet } from '../../../common/crud/useGet';
import { awxAPI } from '../../common/api/awx-utils';
import { useAwxView } from '../../common/useAwxView';
import { GalaxyNgStatus } from './GalaxyNgOverview';

export type GalaxyNgResourceKind = 'namespaces' | 'collections' | 'repositories' | 'tasks';

interface GalaxyNgRecord {
  id: number;
  name?: string;
  namespace?: string;
  description?: string;
  pulp_href?: string;
  href?: string;
  state?: string;
  version?: string;
  latest_version?: {
    version?: string;
  };
  repository?: string;
  remote?: string;
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

const resourceTitles: Record<GalaxyNgResourceKind, string> = {
  namespaces: 'Namespaces',
  collections: 'Collections',
  repositories: 'Repositories',
  tasks: 'Tasks',
};

const resourceDescriptions: Record<GalaxyNgResourceKind, string> = {
  namespaces: 'Collection namespaces available in the private automation hub.',
  collections: 'Collections available to AWX project updates and execution environments.',
  repositories: 'Pulp Ansible repositories backing Galaxy NG content distribution.',
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
  const tableColumns = useGalaxyNgColumns(resource);
  const toolbarFilters = useGalaxyNgFilters();
  const status = useGet<GalaxyNgStatus>(awxAPI`/galaxy_ng/status/`);
  const view = useAwxView<GalaxyNgRecord>({
    url: awxAPI`/galaxy_ng/${resource}/`,
    toolbarFilters,
    tableColumns,
  });

  const title = t(resourceTitles[resource]);
  const description = t(resourceDescriptions[resource]);

  return (
    <PageLayout>
      <PageHeader title={title} description={description} />
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
