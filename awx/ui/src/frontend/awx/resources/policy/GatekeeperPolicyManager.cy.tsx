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

const awxProjectsResponse = {
  count: 1,
  results: [
    {
      id: 42,
      name: 'Policy Repo',
      scm_type: 'git',
      scm_url: 'https://git.example.test/policies.git',
      scm_branch: 'main',
      scm_revision: 'abc123',
      status: 'successful',
    },
  ],
};

const gatekeeperProjectSyncResult = {
  changed: false,
  persisted: false,
  dry_run: true,
  mode: 'dry_run',
  project: awxProjectsResponse.results[0],
  project_source: {
    project_id: 42,
    project_name: 'Policy Repo',
    path: 'gatekeeper/**/*.yaml',
    scm_revision: 'abc123',
  },
  apply_strategy: 'update',
  field_manager: 'awx',
  force_conflicts: false,
  counts: {
    files: 1,
    manifests: 1,
    created: 1,
    updated: 0,
  },
  results: [
    {
      file_path: 'gatekeeper/templates.yaml',
      document_index: 1,
      manifest: {
        apiVersion: 'templates.gatekeeper.sh/v1',
        kind: 'ConstraintTemplate',
        metadata: { name: 'k8srequiredlabels' },
      },
      manifest_yaml: 'apiVersion: templates.gatekeeper.sh/v1\nkind: ConstraintTemplate\n',
      mode: 'dry_run',
      operation: 'create',
      target: {
        api_version: 'templates.gatekeeper.sh/v1',
        kind: 'ConstraintTemplate',
        name: 'k8srequiredlabels',
        resource: 'constrainttemplates',
        object_path: '/apis/templates.gatekeeper.sh/v1/constrainttemplates/k8srequiredlabels',
      },
      before_exists: false,
      before_sha256: '',
      after_sha256: 'after123',
      diff: '+ ConstraintTemplate',
      rollback_plan: {},
      opa_allowed: true,
      kubernetes_response: {},
      audit: null,
    },
  ],
};

const gatekeeperResponseWithViolation = {
  ...gatekeeperResponse,
  counts: {
    ...gatekeeperResponse.counts,
    constraints: 1,
    violations: 1,
    filtered_violations: 1,
  },
  violation_query: {
    ...gatekeeperResponse.violation_query,
    returned: 1,
  },
  violations: [
    {
      constraint_kind: 'K8sRequiredLabels',
      constraint_name: 'require-owner',
      enforcement_action: 'deny',
      message: 'missing owner label',
      resource_kind: 'Namespace',
      resource_namespace: '',
      resource_name: 'payments',
      resource_api_version: 'v1',
      resource_group: '',
      resource_version: 'v1',
    },
  ],
};

const gatekeeperRemediationResult = {
  changed: false,
  persisted: false,
  dry_run: false,
  mode: 'preview',
  operation: 'remediate',
  target: {
    api_version: 'v1',
    kind: 'Namespace',
    name: 'payments',
    resource: 'namespaces',
    object_path: '/api/v1/namespaces/payments',
  },
  plan: {
    summary: 'Add the required owner label to the payments namespace.',
    rationale: 'The namespace is missing metadata.labels.owner.',
    risk: 'low',
    target: {
      api_version: 'v1',
      kind: 'Namespace',
      name: 'payments',
      resource: 'namespaces',
      object_path: '/api/v1/namespaces/payments',
    },
    patch_type: 'merge',
    patch: {
      metadata: {
        labels: {
          owner: 'platform',
        },
      },
    },
    manual_steps: [],
    can_apply: true,
  },
  before_exists: true,
  before_sha256: 'before123',
  after_sha256: 'after123',
  diff: '+ owner: platform',
  rollback_plan: {},
  opa_allowed: null,
  kubernetes_response: null,
  audit: null,
  provider: 'openai',
  model: 'gpt-test',
};

interface GatekeeperRequestBody {
  mode?: string;
  human_approved?: boolean;
  remediation_plan?: unknown;
  project?: number;
  path?: string;
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
  response: object = gatekeeperResponse,
  view: GatekeeperPolicyManagerView = 'overview'
) {
  cy.intercept('GET', '/api/v2/opa/gatekeeper/**', response).as('gatekeeper');
  cy.intercept('GET', '/api/v2/projects/**', awxProjectsResponse).as('projects');
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

  it('syncs Gatekeeper manifests from an AWX Project checkout', () => {
    cy.intercept('POST', awxAPI`/opa/gatekeeper/project-sync/`, (req) => {
      const body = req.body as GatekeeperRequestBody;
      expect(body.mode).to.equal('dry_run');
      expect(body.project).to.equal(42);
      expect(body.path).to.equal('gatekeeper/**/*.yaml');
      expect(body.human_approved).to.equal(false);
      req.reply(gatekeeperProjectSyncResult);
    }).as('projectSyncGatekeeper');

    mountGatekeeper(gatekeeperResponse, 'changes');
    cy.getByDataCy('gatekeeper-project-sync-project').select('42');
    cy.getByDataCy('gatekeeper-project-sync-mode').select('dry_run');
    cy.getByDataCy('gatekeeper-project-sync-button').click();
    cy.wait('@projectSyncGatekeeper');
    cy.contains('dry_run 1 manifest(s) from Policy Repo.').should('be.visible');
    cy.contains('gatekeeper/templates.yaml').should('be.visible');
  });

  it('requires confirmation before applying AWX Project manifests', () => {
    let calls = 0;
    cy.intercept('POST', awxAPI`/opa/gatekeeper/project-sync/`, (req) => {
      calls += 1;
      const body = req.body as GatekeeperRequestBody;
      expect(body.mode).to.equal('apply');
      expect(body.project).to.equal(42);
      expect(body.human_approved).to.equal(true);
      req.reply({ ...gatekeeperProjectSyncResult, mode: 'apply', changed: true, persisted: true });
    }).as('projectSyncGatekeeperApply');

    mountGatekeeper(gatekeeperResponse, 'changes');
    cy.getByDataCy('gatekeeper-project-sync-project').select('42');
    cy.getByDataCy('gatekeeper-project-sync-mode').select('apply');
    cy.getByDataCy('gatekeeper-project-sync-button').click();
    cy.getByDataCy('gatekeeper-live-action-confirm-dialog').should('be.visible');
    cy.getByDataCy('gatekeeper-live-action-cancel-button').click();
    cy.wrap(null).then(() => expect(calls).to.equal(0));

    cy.getByDataCy('gatekeeper-project-sync-button').click();
    cy.getByDataCy('gatekeeper-live-action-confirm-button').click();
    cy.wait('@projectSyncGatekeeperApply');
    cy.wrap(null).then(() => expect(calls).to.equal(1));
  });

  it('suggests and confirms AI remediation for a selected violation', () => {
    let calls = 0;
    cy.intercept('POST', awxAPI`/opa/gatekeeper/remediate/`, (req) => {
      calls += 1;
      const body = req.body as GatekeeperRequestBody;
      if (calls === 1) {
        expect(body.mode).to.equal('preview');
        expect(body.remediation_plan).to.equal(undefined);
        req.reply(gatekeeperRemediationResult);
      } else {
        expect(body.mode).to.equal('apply');
        expect(body.human_approved).to.equal(true);
        expect(body.remediation_plan).to.deep.equal(gatekeeperRemediationResult.plan);
        req.reply({
          ...gatekeeperRemediationResult,
          mode: 'apply',
          changed: true,
          persisted: true,
        });
      }
    }).as('remediateGatekeeper');

    mountGatekeeper(gatekeeperResponseWithViolation, 'violations');
    cy.contains('button', 'payments').click();
    cy.getByDataCy('gatekeeper-remediation-panel').should('be.visible');
    cy.getByDataCy('gatekeeper-remediation-suggest-button').click();
    cy.wait('@remediateGatekeeper');
    cy.contains('Add the required owner label to the payments namespace.').should('be.visible');
    cy.contains('owner').should('be.visible');

    cy.getByDataCy('gatekeeper-remediation-apply-button').click();
    cy.getByDataCy('gatekeeper-live-action-confirm-dialog').should('be.visible');
    cy.getByDataCy('gatekeeper-live-action-confirm-button').click();
    cy.wait('@remediateGatekeeper');
    cy.wrap(null).then(() => expect(calls).to.equal(2));
  });
});
