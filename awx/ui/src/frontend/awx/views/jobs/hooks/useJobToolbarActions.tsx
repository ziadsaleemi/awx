import { BanIcon, TrashIcon } from '@patternfly/react-icons';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { IPageAction, PageActionSelection, PageActionType } from '../../../../../framework';
import { requestGet } from '../../../../common/crud/Data';
import { AwxItemsResponse } from '../../../common/AwxItemsResponse';
import { awxAPI } from '../../../common/api/awx-utils';
import { UnifiedJob } from '../../../interfaces/UnifiedJob';
import { useCancelJobs } from './useCancelJobs';
import { useDeleteJobs } from './useDeleteJobs';

export function useJobToolbarActions(onComplete: (jobs: UnifiedJob[]) => void) {
  const { t } = useTranslation();
  const deleteJobs = useDeleteJobs(onComplete);
  const cancelJobs = useCancelJobs(onComplete);

  const cancelAllRunningJobs = useCallback(() => {
    void requestGet<AwxItemsResponse<UnifiedJob>>(
      awxAPI`/unified_jobs/` + '?status__in=running,waiting&page_size=200'
    ).then((response) => {
      if (response.results.length > 0) {
        cancelJobs(response.results);
      }
    });
  }, [cancelJobs]);

  return useMemo<IPageAction<UnifiedJob>[]>(
    () => [
      {
        type: PageActionType.Button,
        selection: PageActionSelection.None,
        icon: BanIcon,
        label: t('Cancel all running jobs'),
        onClick: cancelAllRunningJobs,
      },
      {
        type: PageActionType.Button,
        selection: PageActionSelection.Multiple,
        icon: BanIcon,
        label: t('Cancel selected jobs'),
        onClick: cancelJobs,
      },
      { type: PageActionType.Seperator },
      {
        type: PageActionType.Button,
        selection: PageActionSelection.Multiple,
        icon: TrashIcon,
        label: t('Delete jobs'),
        onClick: deleteJobs,
        isDanger: true,
      },
    ],
    [deleteJobs, cancelJobs, cancelAllRunningJobs, t]
  );
}
