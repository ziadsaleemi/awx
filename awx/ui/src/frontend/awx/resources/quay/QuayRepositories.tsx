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
import { useGet } from '../../../common/crud/useGet';
import { ModuleAIAssistantAction } from '../../common/ModuleAIAssistantAction';
import { awxAPI } from '../../common/api/awx-utils';
import { useAwxView } from '../../common/useAwxView';
import { QuayStatus } from './QuayOverview';

interface QuayRepository {
  id: number;
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

export function QuayRepositories() {
  const { t } = useTranslation();
  const toolbarFilters = useQuayFilters();
  const tableColumns = useQuayRepositoryColumns();
  const status = useGet<QuayStatus>(awxAPI`/quay/status/`);
  const view = useAwxView<QuayRepository>({
    url: awxAPI`/quay/repositories/`,
    toolbarFilters,
    tableColumns,
  });

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
              namespace: status.data?.namespace,
              registry: status.data?.registry,
            }}
          />
        }
      />
      {status.data && (!status.data.configured || status.data.controller_error) ? (
        <Alert
          isInline
          variant="warning"
          title={t('Project Quay is not ready')}
          style={{ margin: '0 24px 16px' }}
        >
          {status.data.controller_error || status.data.message}
        </Alert>
      ) : null}
      <PageTable<QuayRepository>
        id="quay-repositories-table"
        toolbarFilters={toolbarFilters}
        tableColumns={tableColumns}
        errorStateTitle={t('Error loading Project Quay repositories')}
        emptyStateTitle={t('No Project Quay repositories found')}
        emptyStateDescription={t(
          'Configure Project Quay settings or push an execution environment image to populate this view.'
        )}
        {...view}
      />
    </PageLayout>
  );
}
