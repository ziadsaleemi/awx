import { ReactNode, useEffect } from 'react';
import { PageNavigationItem } from '../../../../framework';
import { usePageNavigationRoutesContext } from '../../../../framework/PageNavigation/PageNavigationRoutesProvider';
import { awxAPI } from '../../common/api/awx-utils';
import { AwxRoute } from '../../main/AwxRoutes';
import { PolicyAsCodeOverview } from './PolicyAsCodeOverview';

function SeedNavigation(props: { children: ReactNode }) {
  const [, setNavigation] = usePageNavigationRoutesContext();
  useEffect(() => {
    setNavigation([
      {
        id: AwxRoute.ActivityStream,
        path: 'activity-stream',
        element: <div />,
      },
      {
        id: AwxRoute.SettingsOpa,
        path: 'settings/opa',
        element: <div />,
      },
      {
        id: AwxRoute.SettingsGatekeeper,
        path: 'settings/gatekeeper',
        element: <div />,
      },
      {
        id: AwxRoute.PolicyAsCodeOpaOverview,
        path: 'policy-as-code/opa/overview',
        element: <div />,
      },
      {
        id: AwxRoute.PolicyAsCodeOpaTester,
        path: 'policy-as-code/opa/tester',
        element: <div />,
      },
      {
        id: AwxRoute.PolicyAsCodeOpaProjectSync,
        path: 'policy-as-code/opa/project-sync',
        element: <div />,
      },
      {
        id: AwxRoute.PolicyAsCodeGatekeeperOverview,
        path: 'policy-as-code/gatekeeper/overview',
        element: <div />,
      },
      {
        id: AwxRoute.PolicyAsCodeGatekeeperChanges,
        path: 'policy-as-code/gatekeeper/changes',
        element: <div />,
      },
      {
        id: AwxRoute.PolicyAsCodeGatekeeperTemplates,
        path: 'policy-as-code/gatekeeper/templates',
        element: <div />,
      },
      {
        id: AwxRoute.PolicyAsCodeGatekeeperConstraints,
        path: 'policy-as-code/gatekeeper/constraints',
        element: <div />,
      },
      {
        id: AwxRoute.PolicyAsCodeGatekeeperViolations,
        path: 'policy-as-code/gatekeeper/violations',
        element: <div />,
      },
      {
        id: AwxRoute.PolicyAsCodeGatekeeperConfigs,
        path: 'policy-as-code/gatekeeper/configurations',
        element: <div />,
      },
    ] as PageNavigationItem[]);
  }, [setNavigation]);
  return <>{props.children}</>;
}

describe('PolicyAsCodeOverview', () => {
  it('summarizes OPA, Gatekeeper, governed paths, and recent activity', () => {
    cy.viewport(1920, 1100);
    cy.intercept('GET', awxAPI`/opa/policies/`, {
      enabled: true,
      server_url: 'http://opa.example.test:8181',
      policies: [
        { id: 'awx/job_launch', path: 'awx/job_launch/allow' },
        { id: 'awx/gatekeeper_resource', path: 'awx/gatekeeper_resource/allow' },
      ],
      policy_bundle: {
        configured: true,
        size: 2048,
        line_count: 42,
        sha256: 'abc123',
      },
    }).as('opaStatus');
    cy.intercept('GET', awxAPI`/opa/gatekeeper/**`, {
      configured: true,
      message: '',
      contexts: [{ name: 'docker-desktop', selected: true, configured: true }],
      cluster: {
        server_url: 'https://host.docker.internal:6443',
        context: 'docker-desktop',
        verify_ssl: false,
      },
      api_versions: {
        constraint_templates: 'v1',
        constraints: ['v1beta1'],
        configs: 'v1alpha1',
      },
      counts: {
        constraint_templates: 1,
        constraints: 2,
        violations: 4,
        filtered_violations: 4,
        configs: 1,
      },
      constraint_templates: [],
      constraints: [],
      violations: [],
      configs: [],
      errors: [],
    }).as('gatekeeperStatus');
    cy.intercept('GET', '/api/v2/activity_stream/**', {
      count: 1,
      results: [
        {
          id: 77,
          timestamp: '2026-06-03T12:00:00Z',
          operation: 'update',
          object1: 'opa_policy_module',
          object2: 'awx/gatekeeper_resource',
          object_type: 'opa_policy_module',
          changes: '{"policy_id":"awx/gatekeeper_resource"}',
        },
      ],
    }).as('activity');

    cy.mount(
      <SeedNavigation>
        <PolicyAsCodeOverview canManagePolicy opaEnabled gatekeeperEnabled />
      </SeedNavigation>
    );

    cy.wait(['@opaStatus', '@gatekeeperStatus']);
    cy.getByDataCy('policy-control-plane').should('be.visible');
    cy.getByDataCy('policy-control-plane').then(($card) => {
      const card = $card[0];
      expect(card.scrollWidth).to.be.at.most(card.clientWidth + 1);
    });
    cy.getByDataCy('policy-control-plane')
      .find('[data-cy="policy-metric-tile"]')
      .should('have.length', 5)
      .each(($tile) => {
        const tile = $tile[0];
        expect(tile.scrollWidth).to.be.at.most(tile.clientWidth + 1);
      });
    cy.contains('OPA enabled')
      .parents('.pf-v5-c-label')
      .should('have.class', 'pf-m-green')
      .find('svg')
      .should('exist');
    cy.contains('Gatekeeper connected')
      .parents('.pf-v5-c-label')
      .should('have.class', 'pf-m-green')
      .find('svg')
      .should('exist');
    cy.contains('2.0 KB').should('be.visible');
    cy.contains('docker-desktop').should('be.visible');
    cy.contains('4').should('be.visible');
    cy.getByDataCy('policy-opa-guardrails')
      .should('be.visible')
      .within(() => {
        cy.contains('awx/job_launch/allow').should('be.visible');
        cy.contains('a', 'Open OPA settings').should('have.attr', 'href', '/settings/opa');
      });
    cy.getByDataCy('policy-gatekeeper-posture')
      .should('be.visible')
      .within(() => {
        cy.contains('https://host.docker.internal:6443').should('be.visible');
        cy.contains('a', 'Open Gatekeeper settings').should(
          'have.attr',
          'href',
          '/settings/gatekeeper'
        );
      });
    cy.getByDataCy('policy-governed-change-paths')
      .contains('a', 'Gatekeeper governed changes')
      .should('have.attr', 'href', '/policy-as-code/gatekeeper/changes');
    cy.getByDataCy('policy-resource-review')
      .contains('a', 'Configurations')
      .should('have.attr', 'href', '/policy-as-code/gatekeeper/configurations');
    cy.getByDataCy('policy-recent-activity')
      .contains('a', 'update awx/gatekeeper_resource')
      .should('have.attr', 'href', '/activity-stream?id=77');
  });
});
