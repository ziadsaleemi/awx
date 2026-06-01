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
  CardBody,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Spinner,
} from '@patternfly/react-core';
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
  const [hourlyRate] = useState<number>(() => {
    const stored = localStorage.getItem(ROI_HOURLY_RATE_KEY);
    return stored ? parseFloat(stored) : 75;
  });
  const [manualMultiplier] = useState<number>(() => {
    const stored = localStorage.getItem(ROI_MANUAL_MULTIPLIER_KEY);
    return stored ? parseFloat(stored) : 3;
  });

  return { hourlyRate, manualMultiplier };
}

export function AwxROICard() {
  const { t } = useTranslation();
  const { hourlyRate, manualMultiplier } = useRoiConfig();

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

  return (
    <PageDashboardCard title={t('Automation ROI')} width="half" height="sm">
      <CardBody>
        {isLoading ? (
          <Spinner size="lg" />
        ) : (
          <DescriptionList isCompact isHorizontal>
            <DescriptionListGroup>
              <DescriptionListTerm>{t('Successful jobs analysed')}</DescriptionListTerm>
              <DescriptionListDescription>{jobCount.toLocaleString()}</DescriptionListDescription>
            </DescriptionListGroup>
            <DescriptionListGroup>
              <DescriptionListTerm>{t('Hours automated')}</DescriptionListTerm>
              <DescriptionListDescription>
                {hoursAutomated.toFixed(1)} {t('h')}
              </DescriptionListDescription>
            </DescriptionListGroup>
            <DescriptionListGroup>
              <DescriptionListTerm>{t('Estimated hours saved')}</DescriptionListTerm>
              <DescriptionListDescription
                style={{ fontWeight: 600, color: 'var(--pf-v5-global--success-color--100)' }}
              >
                {hoursSaved.toFixed(1)} {t('h')}
              </DescriptionListDescription>
            </DescriptionListGroup>
            <DescriptionListGroup>
              <DescriptionListTerm>{t('Estimated cost avoidance')}</DescriptionListTerm>
              <DescriptionListDescription
                style={{
                  fontWeight: 700,
                  fontSize: 18,
                  color: 'var(--pf-v5-global--success-color--100)',
                }}
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
