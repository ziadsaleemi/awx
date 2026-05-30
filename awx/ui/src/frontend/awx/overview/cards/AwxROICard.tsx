/**
 * G2a — ROI / Value Measurement Dashboard Card
 *
 * Computes automation ROI using job run data:
 *   Hours saved = sum of (elapsed seconds / 3600) * manual_multiplier across all successful jobs
 *   Cost avoidance = hours_saved * configurable hourly rate
 *
 * Configurable via localStorage (no backend setting needed for MVP).
 */

import {
  Button,
  CardBody,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Flex,
  FlexItem,
  NumberInput,
  Popover,
  Spinner,
} from '@patternfly/react-core';
import { CogIcon } from '@patternfly/react-icons';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { PageDashboardCard } from '../../../../framework/PageDashboard/PageDashboardCard';
import { awxAPI } from '../../common/api/awx-utils';

const ROI_HOURLY_RATE_KEY = 'awx-roi-hourly-rate';
const ROI_MANUAL_MULTIPLIER_KEY = 'awx-roi-manual-multiplier';

interface JobSummary {
  elapsed: number;
  status: string;
}

interface JobsResponse {
  count: number;
  results: JobSummary[];
}

function useRoiConfig() {
  const [hourlyRate, setHourlyRateState] = useState<number>(() => {
    const stored = localStorage.getItem(ROI_HOURLY_RATE_KEY);
    return stored ? parseFloat(stored) : 75;
  });
  const [manualMultiplier, setManualMultiplierState] = useState<number>(() => {
    const stored = localStorage.getItem(ROI_MANUAL_MULTIPLIER_KEY);
    return stored ? parseFloat(stored) : 3;
  });

  const setHourlyRate = (v: number) => {
    localStorage.setItem(ROI_HOURLY_RATE_KEY, String(v));
    setHourlyRateState(v);
  };
  const setManualMultiplier = (v: number) => {
    localStorage.setItem(ROI_MANUAL_MULTIPLIER_KEY, String(v));
    setManualMultiplierState(v);
  };

  return { hourlyRate, setHourlyRate, manualMultiplier, setManualMultiplier };
}

export function AwxROICard() {
  const { t } = useTranslation();
  const { hourlyRate, setHourlyRate, manualMultiplier, setManualMultiplier } = useRoiConfig();

  // Fetch last 500 successful unified jobs to compute ROI
  const { data, isLoading } = useSWR<JobsResponse>(
    awxAPI`/unified_jobs/?status=successful&page_size=500&order_by=-finished`,
    (url: string) =>
      fetch(url)
        .then((r) => r.json())
        .catch(() => ({ count: 0, results: [] }))
  );

  const { hoursAutomated, hoursSaved, costAvoidance, jobCount } = useMemo(() => {
    if (!data?.results) return { hoursAutomated: 0, hoursSaved: 0, costAvoidance: 0, jobCount: 0 };
    const hoursAutomated = data.results.reduce((sum, j) => sum + (j.elapsed ?? 0) / 3600, 0);
    const hoursSaved = hoursAutomated * manualMultiplier;
    const costAvoidance = hoursSaved * hourlyRate;
    return { hoursAutomated, hoursSaved, costAvoidance, jobCount: data.results.length };
  }, [data, hourlyRate, manualMultiplier]);

  const configPopover = (
    <Popover
      aria-label={t('ROI configuration')}
      headerContent={t('Configure ROI assumptions')}
      bodyContent={
        <Flex direction={{ default: 'column' }} style={{ gap: 12 }}>
          <FlexItem>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>
              {t('Hourly labour rate (USD)')}
            </label>
            <NumberInput
              value={hourlyRate}
              min={1}
              max={9999}
              onMinus={() => setHourlyRate(Math.max(1, hourlyRate - 5))}
              onPlus={() => setHourlyRate(hourlyRate + 5)}
              onChange={(e) => {
                const v = parseInt((e.target as HTMLInputElement).value, 10);
                if (!isNaN(v) && v >= 1) setHourlyRate(v);
              }}
            />
          </FlexItem>
          <FlexItem>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>
              {t('Manual time multiplier')}
              <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--pf-v5-global--Color--200)' }}>
                {t('(estimated manual hours per automation hour)')}
              </span>
            </label>
            <NumberInput
              value={manualMultiplier}
              min={1}
              max={20}
              onMinus={() => setManualMultiplier(Math.max(1, manualMultiplier - 0.5))}
              onPlus={() => setManualMultiplier(manualMultiplier + 0.5)}
              onChange={(e) => {
                const v = parseFloat((e.target as HTMLInputElement).value);
                if (!isNaN(v) && v >= 1) setManualMultiplier(v);
              }}
            />
          </FlexItem>
        </Flex>
      }
    >
      <Button variant="plain" aria-label={t('Configure ROI assumptions')}>
        <CogIcon />
      </Button>
    </Popover>
  );

  return (
    <PageDashboardCard
      title={t('Automation ROI')}
      width="md"
      height="sm"
      headerControls={configPopover}
    >
      <CardBody>
        {isLoading ? (
          <Spinner size="lg" />
        ) : (
          <DescriptionList isCompact isHorizontal>
            <DescriptionListGroup>
              <DescriptionListTerm>{t('Successful jobs analysed')}</DescriptionListTerm>
              <DescriptionListDescription>
                {jobCount.toLocaleString()}
              </DescriptionListDescription>
            </DescriptionListGroup>
            <DescriptionListGroup>
              <DescriptionListTerm>{t('Hours automated')}</DescriptionListTerm>
              <DescriptionListDescription>
                {hoursAutomated.toFixed(1)} h
              </DescriptionListDescription>
            </DescriptionListGroup>
            <DescriptionListGroup>
              <DescriptionListTerm>{t('Estimated hours saved')}</DescriptionListTerm>
              <DescriptionListDescription
                style={{ fontWeight: 600, color: 'var(--pf-v5-global--success-color--100)' }}
              >
                {hoursSaved.toFixed(1)} h
              </DescriptionListDescription>
            </DescriptionListGroup>
            <DescriptionListGroup>
              <DescriptionListTerm>{t('Estimated cost avoidance')}</DescriptionListTerm>
              <DescriptionListDescription
                style={{ fontWeight: 700, fontSize: 18, color: 'var(--pf-v5-global--success-color--100)' }}
              >
                ${costAvoidance.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </DescriptionListDescription>
            </DescriptionListGroup>
          </DescriptionList>
        )}
      </CardBody>
    </PageDashboardCard>
  );
}
