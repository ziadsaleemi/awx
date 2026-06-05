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
        id: AwxRoute.SettingsPolicyAsCode,
        path: 'settings/policy-as-code',
        element: <div />,
      } as PageNavigationItem,
      {
        id: AwxRoute.ActivityStream,
        path: 'activity-stream',
        element: <div />,
      } as PageNavigationItem,
      {
        id: AwxRoute.CloudConnections,
        path: 'cloud/connections',
        element: <div />,
      } as PageNavigationItem,
    ]);
  }, [setNavigation]);
  return <>{props.children}</>;
}

describe('ExternalAutomationSmokePanel', () => {
  it('can include Proxmox VM proof from the external automation smoke surface', () => {
    cy.intercept('GET', awxAPI`/catalog_cloud/connections/?provider_id=proxmox`, {
      count: 2,
      results: [
        {
          id: 6,
          provider_id: 'proxmox',
          name: 'Offline Proxmox',
          status: 'disconnected',
          credential: 16,
          credential_name: 'Offline credential',
          error: '',
          organization: null,
          updated_at: '2026-06-05T00:00:00Z',
        },
        {
          id: 7,
          provider_id: 'proxmox',
          name: 'Lab Proxmox',
          status: 'connected',
          credential: 17,
          credential_name: 'Lab credential',
          error: '',
          organization: null,
          updated_at: '2026-06-05T00:00:00Z',
        },
      ],
    }).as('loadProxmoxConnections');

    cy.intercept('POST', awxAPI`/external_automation/check/`, (req) => {
      expect(req.body).to.deep.equal({
        include_eda: true,
        include_opa: true,
        sync_opa_policy: true,
        opa_policy_id: 'awx/managed',
        opa_deny_smoke: true,
        start_eda_activation: false,
        include_gatekeeper: false,
        gatekeeper_context: '',
        include_proxmox: true,
        proxmox_connection_id: '7',
        proxmox_expected_vms: ['eda-server', 'opa-gatekeeper'],
      });
      req.reply({
        ok: true,
        checks: {
          eda: { ok: true, status: 'available', count: 1 },
          opa: {
            ok: true,
            status: 'available',
            allowed: true,
            deny_smoke: { requested: true, ok: true, status: 'denied', allowed: false },
            policy_sync: { requested: true, ok: true, status: 'synced', policy_id: 'awx/managed' },
          },
          proxmox: {
            ok: true,
            status: 'available',
            connection_name: 'Lab Proxmox',
            counts: {
              nodes: 1,
              vms: 2,
              running_vms: 2,
              containers: 0,
              templates: 4,
            },
            expected_vm_names: ['eda-server', 'opa-gatekeeper'],
            expected_vms_found: 2,
          },
        },
        audit: {
          activity_stream_id: 122,
          activity_stream_url: '/api/v2/activity_stream/122/',
        },
      });
    }).as('runSmoke');

    cy.mount(
      <SeedNavigation>
        <ExternalAutomationSmokePanel />
      </SeedNavigation>
    );

    cy.getByDataCy('external-automation-check-proxmox').check({ force: true });
    cy.wait('@loadProxmoxConnections');
    cy.getByDataCy('external-automation-proxmox-connection-id')
      .should('contain.text', 'Lab Proxmox')
      .select('7');
    cy.getByDataCy('external-automation-proxmox-expected-vms').type('eda-server, opa-gatekeeper');
    cy.getByDataCy('external-automation-smoke-run-button').click();
    cy.wait('@runSmoke');
    cy.contains('External automation smoke passed.').should('be.visible');
    cy.getByDataCy('external-automation-proxmox-connection-result').should(
      'contain.text',
      'Lab Proxmox'
    );
    cy.contains('1 nodes, 2 VMs, 2 running, 0 containers, 4 templates').should('be.visible');
    cy.contains('2 of 2 found').should('be.visible');
  });

  it('links empty Proxmox proof setup to Cloud Connections', () => {
    cy.intercept('GET', awxAPI`/catalog_cloud/connections/?provider_id=proxmox`, {
      count: 0,
      results: [],
    }).as('loadProxmoxConnections');

    cy.mount(
      <SeedNavigation>
        <ExternalAutomationSmokePanel />
      </SeedNavigation>
    );

    cy.getByDataCy('external-automation-check-proxmox').check({ force: true });
    cy.wait('@loadProxmoxConnections');
    cy.contains('No Proxmox VE connections found.').should('be.visible');
    cy.getByDataCy('external-automation-cloud-connections-link')
      .should('be.visible')
      .and('have.attr', 'href', '/cloud/connections');
  });

  it('runs OPA and Gatekeeper smoke from policy surfaces', () => {
    cy.window().then((win) => {
      cy.stub(win.URL, 'createObjectURL').as('createObjectURL').returns('blob:smoke-evidence');
      cy.stub(win.URL, 'revokeObjectURL').as('revokeObjectURL');
    });
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

    cy.getByDataCy('external-automation-smoke')
      .should('be.visible')
      .and('not.have.class', 'pf-m-limit-width');
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
    cy.getByDataCy('external-automation-evidence-download-button').click();
    cy.get('@createObjectURL').should('have.been.calledOnce');
    cy.get('@revokeObjectURL').should('have.been.calledOnce');
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

  it('links failed Gatekeeper smoke to Policy Connections settings', () => {
    cy.intercept('POST', awxAPI`/external_automation/check/`, {
      ok: false,
      checks: {
        gatekeeper: {
          ok: false,
          status: 'not_configured',
          context: 'default',
        },
      },
      audit: {
        activity_stream_id: 125,
        activity_stream_url: '/api/v2/activity_stream/125/',
      },
    }).as('runSmoke');

    cy.mount(
      <SeedNavigation>
        <ExternalAutomationSmokePanel includeEda={false} includeOpa includeGatekeeper />
      </SeedNavigation>
    );

    cy.get('#external-automation-check-opa').uncheck({ force: true });
    cy.getByDataCy('external-automation-smoke-run-button').click();
    cy.wait('@runSmoke');
    cy.contains('Gatekeeper smoke failed.').should('be.visible');
    cy.getByDataCy('external-automation-policy-settings-link')
      .should('be.visible')
      .and('have.attr', 'href', '/settings/policy-as-code');
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
