/* eslint-disable i18next/no-literal-string */
import { CardBody } from '@patternfly/react-core';
import { PageDashboard } from '../../../framework/PageDashboard/PageDashboard';
import { PageDashboardCard } from '../../../framework/PageDashboard/PageDashboardCard';
import { AwxInsightsCard } from './cards/AwxInsightsCard';
import { AwxROICard } from './cards/AwxROICard';

function listResponse<T>(results: T[]) {
  return { count: results.length, next: null, previous: null, results };
}

function cardRect(dataCy: string) {
  return cy.getByDataCy(dataCy).then(($card) => $card[0].getBoundingClientRect());
}

describe('AwxOverview layout', () => {
  it('keeps variable-height overview cards aligned and contained', () => {
    const now = new Date().toISOString();
    const longName =
      'Demo Workflow - Resume Test With Extra Long Name That Previously Overflowed The Dashboard Card';
    const recentJobs = [
      ...Array.from({ length: 8 }, (_unused, index) => ({
        id: index + 1,
        name: `${longName} ${index + 1}`,
        type: 'job',
        status: 'failed',
        elapsed: 120 + index,
        finished: now,
        unified_job_template: { name: longName },
      })),
      {
        id: 99,
        name: 'AI approval smoke workflow',
        type: 'workflow_job',
        status: 'successful',
        elapsed: 172611,
        finished: now,
        unified_job_template: { name: 'AI approval smoke workflow' },
      },
      {
        id: 100,
        name: 'Short baseline',
        type: 'job',
        status: 'successful',
        elapsed: 20,
        finished: now,
        unified_job_template: { name: 'Short baseline' },
      },
    ];

    cy.intercept(
      'GET',
      '/api/v2/unified_jobs/?status=successful&page_size=500&order_by=-finished',
      {
        ...listResponse(recentJobs.filter((job) => job.status === 'successful')),
      }
    );
    cy.intercept('GET', '/api/v2/unified_jobs/?page_size=200&order_by=-finished', {
      ...listResponse(recentJobs),
    });
    cy.intercept('GET', '/api/v2/projects/?page_size=100&order_by=-modified', {
      ...listResponse([{ name: 'Project with long sync failure', status: 'failed' }]),
    });
    cy.intercept('GET', '/api/v2/inventories/?page_size=100&order_by=-modified', {
      ...listResponse([
        {
          name: 'Demo Inventory With Active Failure And Very Long Name',
          inventory_sources_with_failures: 1,
        },
      ]),
    });
    cy.intercept('GET', '/api/v2/inventory_sources/?page_size=100&order_by=-modified', {
      ...listResponse([
        {
          name: 'DigitalOcean VMs With Very Long Source Name',
          source: 'ec2',
          status: 'failed',
          last_job_failed: true,
          summary_fields: {
            inventory: {
              name: 'Demo Inventory With Active Failure And Very Long Name',
              hosts_with_active_failures: 3,
            },
          },
        },
      ]),
    });
    cy.intercept('GET', '/api/v2/ai/settings/', { enabled: false, configured: false });

    cy.viewport(1920, 1100);
    cy.mount(
      <PageDashboard>
        <AwxROICard />
        <AwxInsightsCard />
        <PageDashboardCard title="Performance Metrics" width="full" height="sm">
          <CardBody>Performance content</CardBody>
        </PageDashboardCard>
      </PageDashboard>
    );

    cy.contains('Automation ROI').should('be.visible');
    cy.contains('Automation Insights').should('be.visible');
    cy.contains('Performance Metrics').should('be.visible');

    cardRect('automation-roi').then((roiRect) => {
      cardRect('automation-insights').then((insightsRect) => {
        expect(Math.abs(roiRect.height - insightsRect.height)).to.be.lessThan(2);
        expect(Math.abs(roiRect.bottom - insightsRect.bottom)).to.be.lessThan(2);
      });
    });

    cardRect('automation-insights').then((insightsRect) => {
      cardRect('performance-metrics').then((performanceRect) => {
        expect(insightsRect.bottom).to.be.lessThan(performanceRect.top);
      });
    });
  });
});
