import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardCopy, ClipboardCopyVariant } from '@patternfly/react-core';
import { DateTimeCell, ITableColumn, PageTable } from '../../../../framework';
import { useGet } from '../../../common/crud/useGet';
import { awxAPI } from '../../common/api/awx-utils';
import { useAwxView } from '../../common/useAwxView';
import { QuayImageBuildTemplate } from '../../interfaces/QuayImageBuildTemplate';
import { QuayStatus } from './QuayStatus';
import { useParams } from 'react-router-dom';

interface QuayImageTag {
  id: number;
  _awx_key?: string;
  name?: string;
  manifest_digest?: string;
  size?: number;
  last_modified?: string;
}

function formatBytes(bytes?: number) {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

export function QuayImageBuildTemplateTags() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const { data: template } = useGet<QuayImageBuildTemplate>(
    params.id ? awxAPI`/quay/execution-environment-images/templates/${params.id}/` : ''
  );
  const { data: status } = useGet<QuayStatus>(awxAPI`/quay/status/`);
  const canLoadTags = Boolean(status?.configured && status.auth_configured && template);

  const tableColumns = useMemo<ITableColumn<QuayImageTag>[]>(
    () => [
      {
        header: t('Tag'),
        cell: (tag) => tag.name,
        sort: 'name',
        card: 'name',
        list: 'name',
      },
      {
        header: t('Digest'),
        cell: (tag) => (
          <ClipboardCopy
            isReadOnly
            hoverTip={t('Copy')}
            clickTip={t('Copied')}
            variant={ClipboardCopyVariant.inlineCompact}
          >
            {tag.manifest_digest || '-'}
          </ClipboardCopy>
        ),
      },
      {
        header: t('Image'),
        cell: (tag) => {
          const image = `${status?.registry ?? ''}/${template?.namespace ?? ''}/${
            template?.repository ?? ''
          }:${tag.name}`;
          return (
            <ClipboardCopy
              isReadOnly
              hoverTip={t('Copy')}
              clickTip={t('Copied')}
              variant={ClipboardCopyVariant.inlineCompact}
            >
              {image}
            </ClipboardCopy>
          );
        },
        card: 'hidden',
        list: 'secondary',
      },
      {
        header: t('Size'),
        cell: (tag) => formatBytes(tag.size),
      },
      {
        header: t('Last modified'),
        cell: (tag) => <DateTimeCell value={tag.last_modified ?? undefined} />,
        sort: 'last_modified',
        defaultSort: true,
        defaultSortDirection: 'desc',
      },
    ],
    [status?.registry, t, template?.namespace, template?.repository]
  );

  const view = useAwxView<QuayImageTag>({
    url: canLoadTags ? awxAPI`/quay/tags/` : awxAPI`/quay/tags/`,
    queryParams: canLoadTags
      ? {
          namespace: template?.namespace ?? '',
          repository: template?.repository ?? '',
        }
      : {
          namespace: '__not_configured__',
          repository: '__not_configured__',
        },
    tableColumns,
  });

  return (
    <PageTable<QuayImageTag>
      id="awx-quay-ee-template-tags-table"
      tableColumns={tableColumns}
      errorStateTitle={t('Error loading image tags')}
      emptyStateTitle={
        canLoadTags
          ? t('No tags found for this repository.')
          : t(
              'Project Quay is not configured for tag reads. Open Project Quay settings to configure registry access.'
            )
      }
      {...view}
      defaultSubtitle={t('Image tag')}
    />
  );
}
