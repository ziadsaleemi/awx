import {
  ClipboardCopy,
  ClipboardCopyVariant,
  PageSection,
  Stack,
  StackItem,
} from '@patternfly/react-core';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { Job } from '../../interfaces/Job';
import { QuayImageBuildJob } from '../../interfaces/QuayImageBuildJob';
import { JobStatusBar } from '../../views/jobs/JobOutput/JobStatusBar';

const OutputBlock = styled.pre`
  background-color: #030303;
  color: #f0f0f0;
  min-height: 240px;
  margin: 0;
  padding: 16px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--pf-v5-global--FontFamily--monospace);
`;

function commandPlanToText(job: QuayImageBuildJob) {
  return (job.command_summary ?? [])
    .map((entry) => {
      const label = entry.label ? `${entry.label}\n` : '';
      return `${label}${entry.command ?? entry.cmd ?? ''}`;
    })
    .filter(Boolean)
    .join('\n\n');
}

export function QuayImageBuildJobOutput(props: { job: Job & QuayImageBuildJob }) {
  const { job } = props;
  const { t } = useTranslation();
  const commandPlan = useMemo(() => commandPlanToText(job), [job]);
  const stdout =
    job.result_stdout || commandPlan || t('No output has been captured for this build yet.');

  return (
    <PageSection variant="light">
      <Stack hasGutter>
        <StackItem>
          <JobStatusBar job={job} />
        </StackItem>
        {commandPlan ? (
          <StackItem>
            <ClipboardCopy
              isReadOnly
              hoverTip={t('Copy')}
              clickTip={t('Copied')}
              variant={ClipboardCopyVariant.expansion}
            >
              {commandPlan}
            </ClipboardCopy>
          </StackItem>
        ) : null}
        <StackItem>
          <OutputBlock>{stdout}</OutputBlock>
        </StackItem>
      </Stack>
    </PageSection>
  );
}
