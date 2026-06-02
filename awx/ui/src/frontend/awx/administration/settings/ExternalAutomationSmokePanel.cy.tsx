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
        gatekeeper_context: '',
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
});
