import { ReactNode, useEffect } from 'react';
import { PageNavigationItem } from '../../../../framework';
import { usePageNavigationRoutesContext } from '../../../../framework/PageNavigation/PageNavigationRoutesProvider';
import { awxAPI } from '../../common/api/awx-utils';
import { AwxRoute } from '../../main/AwxRoutes';
import { GatekeeperPolicyManager } from './GatekeeperPolicyManager';
import type { GatekeeperPolicyManagerView } from './GatekeeperPolicyManager';

const gatekeeperResponse = {
  configured: true,
  message: '',
  contexts: [
    {
      name: 'default',
      selected: true,
      configured: true,
      server_url: 'https://kubernetes.example.com',
      verify_ssl: false,
      source: 'settings',
    },
  ],
  cluster: {
    server_url: 'https://kubernetes.example.com',
    context: 'default',
    verify_ssl: false,
  },
  api_versions: {
    constraint_templates: 'v1',
    constraints: ['v1beta1'],
    configs: 'v1alpha1',
  },
  counts: {
    constraint_templates: 0,
    constraints: 0,
    violations: 0,
    filtered_violations: 0,
    configs: 0,
  },
  violation_query: {
    search: '',
    sort: 'constraint',
    limit: 50,
    page: 1,
    offset: 0,
    total_pages: 1,
    returned: 0,
  },
  constraint_templates: [],
  constraints: [],
  violations: [],
  configs: [],
  errors: [],
};

const gatekeeperResult = {
  changed: true,
  persisted: true,
  dry_run: false,
  mode: 'apply',
  operation: 'apply',
  target: {
    api_version: 'templates.gatekeeper.sh/v1',
    kind: 'ConstraintTemplate',
    name: 'k8srequiredlabels',
    resource: 'constrainttemplates',
  },
  before_exists: false,
  before_sha256: '',
  after_sha256: 'after123',
  diff: '',
  rollback_plan: {},
  opa_allowed: true,
  kubernetes_response: {},
  audit: null,
};

interface GatekeeperRequestBody {
  mode?: string;
  human_approved?: boolean;
}

function SeedNavigation(props: { children: ReactNode }) {
  const [, setNavigation] = usePageNavigationRoutesContext();
  useEffect(() => {
    setNavigation([
      {
        id: AwxRoute.SettingsGatekeeper,
        path: 'settings/gatekeeper',
        element: <div />,
      } as PageNavigationItem,
    ]);
  }, [setNavigation]);
  return <>{props.children}</>;
}

function mountGatekeeper(
  response = gatekeeperResponse,
  view: GatekeeperPolicyManagerView = 'overview'
) {
  cy.intercept('GET', '/api/v2/opa/gatekeeper/**', response).as('gatekeeper');
  cy.mount(
    <SeedNavigation>
      <GatekeeperPolicyManager view={view} />
    </SeedNavigation>
  );
  cy.wait('@gatekeeper');
}

describe('GatekeeperPolicyManager', () => {
  it('uses an AWX-oriented overview with resource workflow links', () => {
    cy.viewport(1920, 1100);
    mountGatekeeper();

    cy.get('[data-cy="gatekeeper-policy-manager"]')
      .should('exist')
      .and('not.have.class', 'pf-m-limit-width');
    cy.getByDataCy('gatekeeper-awx-workflow').should('be.visible');
    cy.contains('a', 'Open governed changes')
      .should('be.visible')
      .and('have.attr', 'href', '/policy-as-code/gatekeeper/changes');
    cy.contains('a', 'Review templates')
      .should('be.visible')
      .and('have.attr', 'href', '/policy-as-code/gatekeeper/templates');
    cy.contains('a', 'Triage violations')
      .should('be.visible')
      .and('have.attr', 'href', '/policy-as-code/gatekeeper/violations');

    cy.contains('.pf-v5-c-card__title', 'Cluster')
      .parents('.pf-v5-c-card')
      .then(($clusterCard) => {
        cy.contains('.pf-v5-c-card__title', 'Inventory')
          .parents('.pf-v5-c-card')
          .then(($inventoryCard) => {
            const clusterRect = $clusterCard[0].getBoundingClientRect();
            const inventoryRect = $inventoryCard[0].getBoundingClientRect();
            expect(Math.abs(clusterRect.top - inventoryRect.top)).to.be.lessThan(2);
            expect(Math.abs(clusterRect.height - inventoryRect.height)).to.be.lessThan(2);
            expect(clusterRect.width).to.be.greaterThan(600);
            expect(inventoryRect.width).to.be.greaterThan(600);
          });
      });
  });

  it('uses full-width policy layout with aligned violation filters', () => {
    cy.viewport(1920, 1100);
    mountGatekeeper(gatekeeperResponse, 'violations');

    cy.get('[data-cy="gatekeeper-policy-manager"]')
      .should('exist')
      .and('not.have.class', 'pf-m-limit-width');
    cy.contains('label', 'Search').should('exist');
    cy.get('#gatekeeper-violation-search').should('exist');
    cy.contains('label', 'Sort').should('exist');
    cy.contains('label', 'Per page').should('exist');
    cy.contains('.pf-v5-c-card__title', 'Governed changes').should('not.exist');
  });

  it('links the unconfigured Gatekeeper state to Gatekeeper settings', () => {
    mountGatekeeper({
      ...gatekeeperResponse,
      configured: false,
      message: 'Configure the Gatekeeper Kubernetes API connection in Settings.',
      contexts: [
        {
          name: 'default',
          selected: true,
          configured: false,
          server_url: '',
          verify_ssl: true,
          source: 'settings',
        },
      ],
      cluster: {
        server_url: '',
        context: 'default',
        verify_ssl: true,
      },
    });

    cy.getByDataCy('gatekeeper-policy-settings-link')
      .should('be.visible')
      .and('have.attr', 'href', '/settings/gatekeeper');
  });

  it('requires confirmation before live apply', () => {
    let calls = 0;
    cy.intercept('POST', awxAPI`/opa/gatekeeper/apply/`, (req) => {
      calls += 1;
      const body = req.body as GatekeeperRequestBody;
      expect(body.mode).to.equal('apply');
      expect(body.human_approved).to.equal(true);
      req.reply(gatekeeperResult);
    }).as('applyGatekeeper');

    mountGatekeeper(gatekeeperResponse, 'changes');
    cy.get('#gatekeeper-apply-mode').select('apply');
    cy.getByDataCy('gatekeeper-apply-button').click();
    cy.getByDataCy('gatekeeper-live-action-confirm-dialog').should('be.visible');
    cy.getByDataCy('gatekeeper-live-action-cancel-button').click();
    cy.get('[data-cy="gatekeeper-live-action-confirm-dialog"]').should('not.exist');
    cy.wrap(null).then(() => expect(calls).to.equal(0));

    cy.getByDataCy('gatekeeper-apply-button').click();
    cy.getByDataCy('gatekeeper-live-action-confirm-button').click();
    cy.wait('@applyGatekeeper');
    cy.wrap(null).then(() => expect(calls).to.equal(1));
  });

  it('requires confirmation before live delete', () => {
    let calls = 0;
    cy.intercept('POST', awxAPI`/opa/gatekeeper/delete/`, (req) => {
      calls += 1;
      const body = req.body as GatekeeperRequestBody;
      expect(body.mode).to.equal('delete');
      expect(body.human_approved).to.equal(true);
      req.reply({ ...gatekeeperResult, operation: 'delete' });
    }).as('deleteGatekeeper');

    mountGatekeeper(gatekeeperResponse, 'changes');
    cy.get('#gatekeeper-delete-mode').select('delete');
    cy.getByDataCy('gatekeeper-delete-button').click();
    cy.getByDataCy('gatekeeper-live-action-confirm-dialog').should('be.visible');
    cy.getByDataCy('gatekeeper-live-action-cancel-button').click();
    cy.get('[data-cy="gatekeeper-live-action-confirm-dialog"]').should('not.exist');
    cy.wrap(null).then(() => expect(calls).to.equal(0));

    cy.getByDataCy('gatekeeper-delete-button').click();
    cy.getByDataCy('gatekeeper-live-action-confirm-button').click();
    cy.wait('@deleteGatekeeper');
    cy.wrap(null).then(() => expect(calls).to.equal(1));
  });

  it('requires confirmation before live rollback', () => {
    let calls = 0;
    cy.intercept('POST', awxAPI`/opa/gatekeeper/rollback/`, (req) => {
      calls += 1;
      const body = req.body as GatekeeperRequestBody;
      expect(body.mode).to.equal('apply');
      expect(body.human_approved).to.equal(true);
      req.reply({ ...gatekeeperResult, operation: 'rollback_restore' });
    }).as('rollbackGatekeeper');

    mountGatekeeper(gatekeeperResponse, 'changes');
    cy.get('#gatekeeper-rollback-mode').select('apply');
    cy.getByDataCy('gatekeeper-rollback-button').click();
    cy.getByDataCy('gatekeeper-live-action-confirm-dialog').should('be.visible');
    cy.getByDataCy('gatekeeper-live-action-cancel-button').click();
    cy.get('[data-cy="gatekeeper-live-action-confirm-dialog"]').should('not.exist');
    cy.wrap(null).then(() => expect(calls).to.equal(0));

    cy.getByDataCy('gatekeeper-rollback-button').click();
    cy.getByDataCy('gatekeeper-live-action-confirm-button').click();
    cy.wait('@rollbackGatekeeper');
    cy.wrap(null).then(() => expect(calls).to.equal(1));
  });
});
