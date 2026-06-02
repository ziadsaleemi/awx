import { ReactNode, useEffect } from 'react';
import { PageNavigationItem } from '../../../../framework';
import { usePageNavigationRoutesContext } from '../../../../framework/PageNavigation/PageNavigationRoutesProvider';
import { awxAPI } from '../../common/api/awx-utils';
import { AwxRoute } from '../../main/AwxRoutes';
import { ExternalAutomationSmokePanel } from './ExternalAutomationSmokePanel';

function SeedNavigation(props: { children: ReactNode }) {
  const [, setNavigation] = usePageNavigationRoutesContext();
  useEffect(() => {
    setNavigation([
      {
        id: AwxRoute.ActivityStream,
        path: 'activity-stream',
        element: <div />,
      } as PageNavigationItem,
    ]);
  }, [setNavigation]);
  return <>{props.children}</>;
}

describe('ExternalAutomationSmokePanel', () => {
  it('runs OPA and Gatekeeper smoke from policy surfaces', () => {
    cy.intercept('POST', awxAPI`/external_automation/check/`, (req) => {
      expect(req.body).to.deep.equal({
        include_eda: false,
        include_opa: true,
        sync_opa_policy: true,
        opa_policy_id: 'awx/managed',
        opa_deny_smoke: true,
        start_eda_activation: false,
        include_gatekeeper: true,
        gatekeeper_context: 'prod',
      });
      req.reply({
        ok: true,
        checks: {
          opa: {
            ok: true,
            status: 'available',
            allowed: true,
            deny_smoke: { requested: true, ok: true, status: 'denied', allowed: false },
            policy_sync: { requested: true, ok: true, status: 'synced', policy_id: 'awx/managed' },
          },
          gatekeeper: {
            ok: true,
            status: 'available',
            context: 'prod',
            counts: {
              constraint_templates: 1,
              constraints: 2,
              violations: 3,
              configs: 1,
            },
          },
        },
        audit: {
          activity_stream_id: 123,
          activity_stream_url: '/api/v2/activity_stream/123/',
        },
      });
    }).as('runSmoke');

    cy.mount(
      <SeedNavigation>
        <ExternalAutomationSmokePanel includeEda={false} includeOpa includeGatekeeper />
      </SeedNavigation>
    );

    cy.get('#external-automation-check-opa').should('be.checked');
    cy.get('#external-automation-check-gatekeeper').should('be.checked');
    cy.getByDataCy('external-automation-gatekeeper-context').type('prod');
    cy.getByDataCy('external-automation-smoke-run-button').click();
    cy.wait('@runSmoke');
    cy.contains('Policy smoke passed.').should('be.visible');
    cy.contains('Gatekeeper').should('be.visible');
    cy.contains('prod').should('be.visible');
    cy.contains('1 templates, 2 constraints, 3 violations, 1 configs').should('be.visible');
    cy.getByDataCy('external-automation-audit-link')
      .should('be.visible')
      .and('have.attr', 'href', '/activity-stream?id=123');
  });

  it('runs Gatekeeper smoke without OPA when selected', () => {
    cy.intercept('POST', awxAPI`/external_automation/check/`, (req) => {
      expect(req.body).to.deep.equal({
        include_eda: false,
        include_opa: false,
        sync_opa_policy: false,
        opa_policy_id: 'awx/managed',
        opa_deny_smoke: false,
        start_eda_activation: false,
        include_gatekeeper: true,
        gatekeeper_context: 'prod',
      });
      req.reply({
        ok: true,
        checks: {
          gatekeeper: {
            ok: true,
            status: 'available',
            context: 'prod',
            counts: {
              constraint_templates: 2,
              constraints: 4,
              violations: 0,
              configs: 1,
            },
          },
        },
        audit: {
          activity_stream_id: 124,
          activity_stream_url: '/api/v2/activity_stream/124/',
        },
      });
    }).as('runSmoke');

    cy.mount(
      <SeedNavigation>
        <ExternalAutomationSmokePanel includeEda={false} includeOpa includeGatekeeper />
      </SeedNavigation>
    );

    cy.get('#external-automation-check-opa').uncheck({ force: true });
    cy.getByDataCy('external-automation-smoke-run-button').should(
      'contain.text',
      'Run Gatekeeper smoke'
    );
    cy.getByDataCy('external-automation-gatekeeper-context').type('prod');
    cy.getByDataCy('external-automation-smoke-run-button').click();
    cy.wait('@runSmoke');
    cy.contains('Gatekeeper smoke passed.').should('be.visible');
    cy.contains('2 templates, 4 constraints, 0 violations, 1 configs').should('be.visible');
    cy.contains('OPA allow').should('not.exist');
  });

  it('requires at least one policy smoke check', () => {
    let runSmokeCalls = 0;
    cy.intercept('POST', awxAPI`/external_automation/check/`, (req) => {
      runSmokeCalls += 1;
      req.reply({ ok: true, checks: {} });
    });

    cy.mount(
      <SeedNavigation>
        <ExternalAutomationSmokePanel includeEda={false} includeOpa includeGatekeeper />
      </SeedNavigation>
    );

    cy.get('#external-automation-check-opa').uncheck({ force: true });
    cy.get('#external-automation-check-gatekeeper').uncheck({ force: true });
    cy.get('[data-cy="external-automation-gatekeeper-context"]').should('not.exist');
    cy.getByDataCy('external-automation-smoke-run-button').click();
    cy.contains('Select at least one policy check.').should('be.visible');
    cy.then(() => expect(runSmokeCalls).to.equal(0));
  });
});
