import { Dispatch, SetStateAction } from 'react';
import { Toolbar, ToolbarContent, Button, Tooltip } from '@patternfly/react-core';
import {
  CompressArrowsAltIcon,
  ExpandArrowsAltIcon,
  OutlinedCommentDotsIcon,
} from '@patternfly/react-icons';
import { useTranslation } from 'react-i18next';
import {
  IFilterState,
  PageToolbarFilters,
} from '../../../../../framework/PageToolbar/PageToolbarFilter';
import { IToolbarFilter } from '../../../../../framework';
import { JobStatus, isJobRunning } from './util';
import { Job } from '../../../interfaces/Job';
import { openAIAssistantWithContext, useAIAssistantEnabled } from '../../../common/AIAssistant';

interface IJobOutputToolbarProps {
  job: Job;
  toolbarFilters: IToolbarFilter[];
  filterState: IFilterState;
  setFilterState: Dispatch<SetStateAction<IFilterState>>;
  jobStatus?: JobStatus;
  isFollowModeEnabled: boolean;
  setIsFollowModeEnabled: (value: boolean) => void;
  isFullScreen?: boolean;
  onToggleFullScreen?: () => void;
}

export function JobOutputToolbar(props: IJobOutputToolbarProps) {
  const {
    toolbarFilters,
    filterState,
    setFilterState,
    jobStatus,
    isFollowModeEnabled,
    setIsFollowModeEnabled,
    isFullScreen,
    onToggleFullScreen,
  } = props;
  const { t } = useTranslation();
  const { enabled: aiEnabled } = useAIAssistantEnabled();

  const handleFollowToggle = () => {
    if (isFollowModeEnabled) {
      setIsFollowModeEnabled(false);
    } else {
      setIsFollowModeEnabled(true);
    }
  };

  const openOutputAssistant = () => {
    openAIAssistantWithContext({
      prompt: t(
        'Use this job output, diagnostic events, and related project code to help me debug failures and improve the automation. Explain likely causes, concrete fixes, and safer code changes.'
      ),
      source: 'job_output',
      job_id: props.job.id,
      job_type: props.job.type,
      job_status: props.job.status,
      job_name: props.job.name,
    });
  };

  return (
    <Toolbar clearAllFilters={() => setFilterState({})}>
      <ToolbarContent>
        <PageToolbarFilters
          toolbarFilters={toolbarFilters}
          filterState={filterState}
          setFilterState={setFilterState}
        />
        {isJobRunning(jobStatus) ? (
          <Button
            variant={isFollowModeEnabled ? 'secondary' : 'primary'}
            onClick={handleFollowToggle}
          >
            {isFollowModeEnabled ? t('Unfollow') : t('Follow')}
          </Button>
        ) : null}
        {aiEnabled ? (
          <Tooltip content={t('Ask assistant about this output')}>
            <Button
              variant="plain"
              aria-label={t('Ask assistant about this output')}
              title={t('Ask assistant about this output')}
              onClick={openOutputAssistant}
              data-cy="job-output-ai-assistant"
              style={{ marginLeft: 'auto' }}
            >
              <OutlinedCommentDotsIcon />
            </Button>
          </Tooltip>
        ) : null}
        {onToggleFullScreen ? (
          <Button
            variant="plain"
            aria-label={isFullScreen ? t('Exit full screen') : t('Full screen')}
            title={isFullScreen ? t('Exit full screen') : t('Full screen')}
            onClick={onToggleFullScreen}
            style={{ marginLeft: aiEnabled ? undefined : 'auto' }}
          >
            {isFullScreen ? <CompressArrowsAltIcon /> : <ExpandArrowsAltIcon />}
          </Button>
        ) : null}
      </ToolbarContent>
    </Toolbar>
  );
}
