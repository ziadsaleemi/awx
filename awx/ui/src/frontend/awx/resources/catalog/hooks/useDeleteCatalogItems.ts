import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useDeleteRequest } from '../../../../common/crud/useDeleteRequest';
import { awxAPI } from '../../../common/api/awx-utils';
import { CatalogItem } from '../../../interfaces/CatalogItem';
import { usePageAlertToaster } from '../../../../../framework';

export function useDeleteCatalogItems(onComplete?: (deleted: CatalogItem[]) => void) {
  const { t } = useTranslation();
  const deleteRequest = useDeleteRequest();
  const alertToaster = usePageAlertToaster();

  return useCallback(
    async (items: CatalogItem[]) => {
      const deleted: CatalogItem[] = [];
      const errors: string[] = [];

      for (const item of items) {
        try {
          await deleteRequest(awxAPI`/catalog_items/${item.id.toString()}/`);
          deleted.push(item);
        } catch (err) {
          errors.push(
            t('Failed to delete {{name}}: {{error}}', {
              name: item.name,
              error: err instanceof Error ? err.message : String(err),
            })
          );
        }
      }

      if (errors.length) {
        alertToaster.addAlert({
          variant: 'danger',
          title: t('Failed to delete one or more catalog items'),
          children: errors.join(', '),
        });
      }

      if (deleted.length && onComplete) {
        onComplete(deleted);
      }
    },
    [alertToaster, deleteRequest, onComplete, t]
  );
}
