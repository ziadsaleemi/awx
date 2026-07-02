/* eslint-disable i18next/no-literal-string */
import { CardBody } from '@patternfly/react-core';
import { PageDashboard } from '../../../framework/PageDashboard/PageDashboard';
import { PageDashboardCard } from '../../../framework/PageDashboard/PageDashboardCard';
import { AwxControlHubCard } from './cards/AwxControlHubCard';
import { AwxControlHubSignalsCard } from './cards/AwxControlHubSignalsCard';
import { AwxInsightsCard } from './cards/AwxInsightsCard';
import { AwxROICard } from './cards/AwxROICard';

function listResponse<T>(results: T[]) {
  return { count: results.length, next: null, previous: null, results };
}

function cardRect(dataCy: string) {
  return cy.getByDataCy(dataCy).then(($card) => $card[0].getBoundingClientRect());
}

describe('AwxOverview layout', () => {
  const dashboardData = {
    inventories: {
      url: '/api/v2/inventories/',
      total: 8,
      total_with_inventory_source: 4,
      job_failed: 0,
      inventory_failed: 1,
    },
    inventory_sources: {
      ec2: {
        url: '/api/v2/inventory_sources/',
        failures_url: '/api/v2/inventory_sources/?failed=true',
        label: 'Cloud',
        total: 4,
        failed: 1,
      },
    },
    groups: {
      url: '/api/v2/groups/',
      total: 3,
      inventory_failed: 0,
    },
    hosts: {
      url: '/api/v2/hosts/',
      failures_url: '/api/v2/hosts/?failed=true',
      total: 11,
      failed: 3,
    },
    projects: {
      url: '/api/v2/projects/',
      failures_url: '/api/v2/projects/?failed=true',
      total: 7,
      failed: 0,
    },
    scm_types: {
      git: {
        url: '/api/v2/projects/?scm_type=git',
        label: 'Git',
        failures_url: '/api/v2/projects/?scm_type=git&failed=true',
        total: 7,
        failed: 0,
      },
      svn: {
        url: '/api/v2/projects/?scm_type=svn',
        label: 'SVN',
        failures_url: '/api/v2/projects/?scm_type=svn&failed=true',
        total: 0,
        failed: 0,
      },
      archive: {
        url: '/api/v2/projects/?scm_type=archive',
        label: 'Archive',
        failures_url: '/api/v2/projects/?scm_type=archive&failed=true',
        total: 0,
        failed: 0,
      },
    },
    users: {
      url: '/api/v2/users/',
      total: 5,
    },
    organizations: {
      url: '/api/v2/organizations/',
      total: 2,
    },
    teams: {
      url: '/api/v2/teams/',
      total: 4,
    },
    credentials: {
      url: '/api/v2/credentials/',
      total: 12,
    },
    job_templates: {
      url: '/api/v2/job_templates/',
      total: 9,
    },
  };

  beforeEach(() => {
    cy.intercept('GET', '/api/v2/eda/status/', {
      configured: true,
      status: 'configured',
      controller_url: 'https://eda-controller.example.test',
    });
    cy.intercept('GET', '/api/v2/eda/activations/?page_size=1', listResponse([{ id: 1 }]));
    cy.intercept('GET', '/api/v2/ai/settings/', {
      enabled: true,
      configured: true,
      provider: 'openai_codex',
      model: 'gpt-5-enterprise-long-context',
      openai_codex_connected: true,
    });
    cy.intercept('GET', '/api/v2/opa/policies/', {
      enabled: true,
      server_url: 'http://opa.example.test:8181',
      policies: [
        { id: 'job_launch', path: 'awx/job_launch/allow' },
        { id: 'inventory_access', path: 'awx/inventory_access/allow' },
        { id: 'credential_use', path: 'awx/credential_use/allow' },
      ],
      policy_bundle: { configured: true, size: 128, line_count: 12 },
    });
    cy.intercept('GET', '/api/v2/opa/gatekeeper/', {
      configured: true,
      cluster: { server_url: 'https://host.docker.internal:6443', context: 'docker-desktop' },
      counts: {
        constraint_templates: 1,
        constraints: 2,
        violations: 4,
        filtered_violations: 4,
        configs: 1,
      },
      errors: [],
    });
    cy.intercept('GET', '/api/v2/galaxy_ng/status/', {
      enabled: true,
      configured: true,
      status: 'configured',
      server_url: 'http://galaxy-ng.example.test',
      controller_error: '',
      counts: {
        namespaces: 3,
        collections: 14,
        repositories: 4,
        remotes: 2,
        remote_registries: 1,
        signature_keys: 1,
        collection_approvals: 2,
        tasks: 6,
      },
    });
    cy.intercept('GET', '/api/v2/quay/status/', {
      enabled: true,
      configured: true,
      status: 'configured',
      server_url: 'http://quay.example.test',
      namespace: 'admin',
      controller_error: '',
      auth_configured: true,
      push_configured: true,
      counts: { repositories: 5, tags: 22 },
    });
    cy.intercept(
      'GET',
      '/api/v2/catalog_cloud/connections/?page_size=1',
      listResponse([{ id: 1 }])
    );
    cy.intercept('GET', '/api/v2/catalog_items/?page_size=1', listResponse([{ id: 1 }, { id: 2 }]));
    cy.intercept(
      'GET',
      '/api/v2/catalog_deployments/?page_size=1',
      listResponse([{ id: 1 }, { id: 2 }, { id: 3 }])
    );
  });

  it('shows AWX as a central control hub for integrated modules', () => {
    cy.viewport(1366, 900);
    cy.mount(
      <PageDashboard>
        <AwxControlHubCard data={dashboardData} />
      </PageDashboard>
    );

    cy.contains('AWX Control Hub').should('be.visible');
    cy.contains('Automation execution').should('be.visible');
    cy.contains('Content and registries').should('be.visible');
    cy.contains('Policy as Code').should('be.visible');
    cy.contains('Event-driven automation').should('be.visible');
    cy.contains('Cloud and catalog').should('be.visible');
    cy.contains('Platform services').should('be.visible');
    cy.contains('AI ready').should('be.visible');
    cy.contains('EDA connected').should('be.visible');
    cy.contains('OPA enabled').should('be.visible');
    cy.contains('Gatekeeper connected').should('be.visible');
    cy.getByDataCy('control-hub-metric').should('have.length', 6);
    cy.getByDataCy('control-hub-module').should('have.length', 6);

    cy.getByDataCy('awx-control-hub').then(($card) => {
      const cardRect = $card[0].getBoundingClientRect();
      cy.getByDataCy('control-hub-module').each(($module) => {
        const moduleRect = $module[0].getBoundingClientRect();
        expect(moduleRect.left).to.be.greaterThan(cardRect.left - 1);
        expect(moduleRect.right).to.be.lessThan(cardRect.right + 1);
      });
    });
  });

  it('shows integrated systems in a graph and compact table', () => {
    cy.viewport(1366, 900);
    cy.mount(
      <PageDashboard>
        <AwxControlHubSignalsCard data={dashboardData} />
      </PageDashboard>
    );

    cy.contains('Control hub signals').should('be.visible');
    cy.getByDataCy('control-hub-signals-chart').should('be.visible');
    cy.getByDataCy('control-hub-signals-table').should('be.visible');
    cy.getByDataCy('control-hub-signals-row').should('have.length', 6);
    cy.contains('Automation execution').should('be.visible');
    cy.contains('Self-service catalog').should('be.visible');
    cy.contains('Content supply chain').should('be.visible');
    cy.contains('Policy as Code').should('be.visible');
    cy.contains('Event-driven decisions').should('be.visible');
    cy.contains('Cloud and AI fabric').should('be.visible');
  });

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
