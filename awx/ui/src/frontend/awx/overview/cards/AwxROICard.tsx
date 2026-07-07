/**
 * G2a — ROI / Value Measurement Dashboard Card
 *
 * Computes automation ROI using job run data:
 *   Hours saved = sum of (elapsed seconds / 3600) * manual_multiplier across all successful jobs
 *   Cost avoidance = hours_saved * configurable hourly rate
 *
 * Configurable via localStorage (no backend setting needed for MVP).
 */

import { CardBody } from '@patternfly/react-core';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { PageDashboardCard } from '../../../../framework/PageDashboard/PageDashboardCard';
import { awxAPI } from '../../common/api/awx-utils';
import {
  OverviewCenteredSpinner,
  OverviewMetricGrid,
  OverviewMetricTile,
  OverviewRow,
  OverviewRows,
  OverviewSection,
  overviewCardBodyStyle,
  overviewMutedTextStyle,
} from './OverviewCardStyles';

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

  const formattedCost = `$${costAvoidance.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  return (
    <PageDashboardCard title={t('Automation ROI')} width="half" height="lg" style={{ minWidth: 0 }}>
      <CardBody style={overviewCardBodyStyle}>
        {isLoading ? (
          <OverviewCenteredSpinner />
        ) : (
          <>
            <div style={{ minWidth: 0 }}>
              <div style={{ ...overviewMutedTextStyle, fontSize: 13, fontWeight: 600 }}>
                {t('Estimated cost avoidance')}
              </div>
              <div
                style={{
                  color: 'var(--pf-v5-global--success-color--100)',
                  fontSize: 34,
                  lineHeight: 1.1,
                  fontWeight: 700,
                  marginTop: 8,
                  overflowWrap: 'anywhere',
                }}
              >
                {formattedCost}
              </div>
              <div style={{ ...overviewMutedTextStyle, marginTop: 8, fontSize: 13 }}>
                {t('Based on the last {{jobCount}} successful jobs.', {
                  jobCount: jobCount.toLocaleString(),
                })}
              </div>
            </div>

            <OverviewMetricGrid minWidth={130}>
              <OverviewMetricTile
                value={jobCount.toLocaleString()}
                label={t('Successful jobs')}
                detail={t('Analyzed')}
              />
              <OverviewMetricTile
                value={`${hoursAutomated.toFixed(1)} ${t('h')}`}
                label={t('Runtime automated')}
                detail={t('Actual execution time')}
              />
              <OverviewMetricTile
                value={`${hoursSaved.toFixed(1)} ${t('h')}`}
                label={t('Time returned')}
                detail={t('{{multiplier}}x manual effort estimate', {
                  multiplier: manualMultiplier.toLocaleString(),
                })}
                tone="success"
              />
            </OverviewMetricGrid>

            <OverviewSection title={t('ROI assumptions')}>
              <OverviewRows>
                <OverviewRow right={`$${hourlyRate.toLocaleString()}/${t('h')}`}>
                  {t('Labor rate')}
                </OverviewRow>
                <OverviewRow right={`${manualMultiplier.toLocaleString()}x`}>
                  {t('Manual effort multiplier')}
                </OverviewRow>
              </OverviewRows>
            </OverviewSection>
          </>
        )}
      </CardBody>
    </PageDashboardCard>
  );
}
