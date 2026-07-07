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
import { Ansi } from '../../../common/Ansi';
import { Job } from '../../interfaces/Job';
import { QuayImageBuildJob } from '../../interfaces/QuayImageBuildJob';
import { JobStatusBar } from '../../views/jobs/JobOutput/JobStatusBar';

const OutputGrid = styled.div<{ $lineChars: number }>`
  --quay-output-line-column-width: calc(40px + ${(props) => props.$lineChars}ch);
  display: grid;
  grid-template-columns: minmax(var(--quay-output-line-column-width), auto) 1fr;
  align-content: start;
  min-height: 240px;
  border: 1px solid var(--pf-v5-global--BorderColor--100);
  background-color: var(--pf-v5-global--BackgroundColor--100);
  color: var(--pf-v5-global--Color--100);
  overflow: auto;
  font-family: var(--pf-v5-global--FontFamily--monospace);

  .pf-v5-theme-dark & {
    background-color: var(--pf-v5-global--BackgroundColor--200);
  }
`;

const OutputRow = styled.div`
  display: contents;
`;

const LineNumberGutter = styled.div`
  position: sticky;
  left: 0;
  grid-column: 1;
  padding-block: 2px;
  padding-inline: 8px;
  border-right: 1px solid var(--pf-v5-global--BorderColor--100);
  background-color: var(--pf-v5-global--BackgroundColor--200);
  color: var(--pf-v5-global--Color--200);
  text-align: right;
  user-select: none;
  z-index: 1;

  .pf-v5-theme-dark & {
    background-color: var(--pf-v5-global--BackgroundColor--100);
  }
`;

const StdOutColumn = styled.div`
  grid-column: 2;
  min-width: max-content;
  padding-block: 2px;
  padding-inline: 16px;
  white-space: pre-wrap;
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
  const outputLines = useMemo(() => stdout.replace(/\r?\n$/, '').split(/\r?\n/), [stdout]);
  const lineChars = String(outputLines.length).length;

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
          <OutputGrid aria-label={t('Build output')} $lineChars={lineChars}>
            {outputLines.map((line, index) => (
              <OutputRow key={`${index}-${line}`}>
                <LineNumberGutter data-cy="quay-output-line-number">
                  {index + 1}
                </LineNumberGutter>
                <StdOutColumn>
                  <Ansi input={line || ' '} />
                </StdOutColumn>
              </OutputRow>
            ))}
          </OutputGrid>
        </StackItem>
      </Stack>
    </PageSection>
  );
}
