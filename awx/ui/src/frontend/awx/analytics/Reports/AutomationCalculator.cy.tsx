import { awxAPI } from '../../common/api/awx-utils';
import { AutomationCalculator } from './AutomationCalculator';

describe('AutomationCalculator', () => {
  it('renders ROI calculated from local Capstan jobs', () => {
    cy.intercept('POST', awxAPI`/analytics/roi_templates_options/`, {
      org_id: [{ key: '1', value: 'Default' }],
      cluster_id: [],
      template_id: [{ key: '7', value: 'Configure web servers' }],
      inventory_id: [{ key: '2', value: 'Production' }],
      quick_date_range: [
        { key: 'roi_last_year', value: 'Last 12 months' },
        { key: 'roi_all_time', value: 'All time' },
      ],
      sort_options: [
        { key: 'host_count', value: 'Host runs' },
        { key: 'monetary_gain', value: 'Estimated savings' },
      ],
    }).as('calculatorOptions');
    cy.intercept('POST', `${awxAPI`/analytics/roi_templates/`}*`, {
      meta: {
        count: 1,
        legend: [
          {
            id: 7,
            name: 'Configure web servers',
            elapsed: 120,
            host_count: 8,
            total_count: 2,
            total_org_count: 1,
            total_cluster_count: 1,
            total_inventory_count: 1,
            successful_hosts_total: 8,
            successful_elapsed_total: 120,
            template_success_rate: 100,
            successful_hosts_savings: 599.67,
            failed_hosts_costs: 0,
            manual_effort_minutes: 60,
            monetary_gain: 599.67,
            enabled: true,
          },
        ],
      },
      monetary_gain_current_page: 599.67,
      monetary_gain_other_pages: 0,
      cost: {
        hourly_manual_labor_cost: 75,
        hourly_automation_cost: 10,
      },
    }).as('calculatorData');

    cy.mount(<AutomationCalculator />, {
      path: '/analytics/automation-calculator',
      initialEntries: ['/analytics/automation-calculator'],
    });

    cy.wait('@calculatorOptions');
    cy.wait('@calculatorData');
    cy.contains('Automation savings').should('be.visible');
    cy.contains('Configure web servers').should('be.visible');
    cy.contains('$599.67').should('be.visible');
  });
});
