import { awxAPI } from '../../common/api/awx-utils';
import {
  GatekeeperResourceDetailPage,
  GatekeeperResourceList,
  OPAPolicyModuleList,
} from './PolicyResourcePages';

const opaModules = {
  enabled: true,
  server_url: 'http://opa.example.test:8181',
  count: 2,
  modules: [
    {
      id: 'capstan/job-launch',
      package: 'capstan.job_launch',
      rules: ['allow'],
      decision_paths: ['capstan/job_launch/allow'],
      size: 64,
      line_count: 4,
      sha256: 'managed123',
      awx_managed: true,
    },
    {
      id: 'external/audit',
      package: 'external.audit',
      rules: ['deny'],
      decision_paths: ['external/audit/deny'],
      size: 48,
      line_count: 3,
      sha256: 'external123',
      awx_managed: false,
    },
  ],
};

const violation = {
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
};

const gatekeeperResponse = {
  configured: true,
  version: '3.18.2',
  contexts: [
    {
      name: 'docker-desktop',
      selected: true,
      configured: true,
      server_url: 'https://kubernetes.example.test',
      verify_ssl: false,
      source: 'settings',
    },
  ],
  cluster: {
    server_url: 'https://kubernetes.example.test',
    context: 'docker-desktop',
    verify_ssl: false,
  },
  counts: {
    constraint_templates: 1,
    constraints: 1,
    violations: 1,
    filtered_violations: 1,
    configs: 1,
  },
  violation_query: {
    search: '',
    sort: 'constraint',
    limit: 50,
    page: 1,
    offset: 0,
    total_pages: 1,
    returned: 1,
  },
  constraint_templates: [
    {
      name: 'k8srequiredlabels',
      kind: 'K8sRequiredLabels',
      api_version: 'templates.gatekeeper.sh/v1',
      created: true,
      observed_generation: 2,
      by_pod: [],
      constraint_count: 1,
      errors: [],
      schema: {},
      targets: [{ target: 'admission.k8s.gatekeeper.sh', rego: 'package labels', libs: [] }],
      constraints: [{ kind: 'K8sRequiredLabels', name: 'require-owner' }],
    },
  ],
  constraints: [
    {
      kind: 'K8sRequiredLabels',
      name: 'require-owner',
      api_version: 'constraints.gatekeeper.sh/v1beta1',
      enforcement_action: 'deny',
      match: {},
      parameters: {},
      total_violations: 1,
      audit_timestamp: '2026-07-13T12:00:00Z',
      by_pod: [],
      violations: [violation],
    },
  ],
  violations: [violation],
  configs: [
    {
      name: 'config',
      api_version: 'config.gatekeeper.sh/v1alpha1',
      sync_only_count: 1,
      sync_only: [{ group: '', version: 'v1', kind: 'Namespace' }],
      match: [],
      readiness_stats_enabled: true,
    },
  ],
  errors: [],
};

describe('Policy resource pages', () => {
  it('uses a searchable PageTable and full-page links for OPA modules', () => {
    cy.intercept('GET', awxAPI`/opa/policy-modules/`, opaModules).as('modules');
    cy.mount(<OPAPolicyModuleList canManagePolicy />);
    cy.wait('@modules');

    cy.contains('a', 'capstan/job-launch')
      .should('have.attr', 'href')
      .and('include', '/policy-as-code/opa/modules/detail?policy=capstan%2Fjob-launch');
    cy.contains('a', 'Create module')
      .should('be.visible')
      .and('have.attr', 'href', '/policy-as-code/opa/modules/new');

    cy.getByDataCy('text-input').find('input').type('external{enter}');
    cy.contains('external/audit').should('be.visible');
    cy.contains('capstan/job-launch').should('not.exist');
    cy.contains('button', 'Clear all filters').click();
    cy.contains('capstan/job-launch').should('be.visible');
  });

  it('uses a PageTable and full-page links for Gatekeeper resources', () => {
    cy.intercept('GET', '/api/v2/opa/gatekeeper/**', gatekeeperResponse).as('gatekeeper');
    cy.mount(<GatekeeperResourceList kind="templates" />, {
      path: '/policy-as-code/gatekeeper/templates',
      initialEntries: ['/policy-as-code/gatekeeper/templates'],
    });
    cy.wait('@gatekeeper');

    cy.contains('a', 'k8srequiredlabels')
      .should('have.attr', 'href')
      .and('include', '/policy-as-code/gatekeeper/templates/detail?');
    cy.contains('Constraints').should('be.visible');
    cy.contains('Targets').should('be.visible');
  });

  it('links a ConstraintTemplate only to identified constraints', () => {
    cy.intercept('GET', '/api/v2/opa/gatekeeper/**', {
      ...gatekeeperResponse,
      constraint_templates: [
        {
          ...gatekeeperResponse.constraint_templates[0],
          constraints: [{ kind: 'K8sRequiredLabels', name: '' }],
        },
      ],
    }).as('gatekeeper');
    cy.mount(<GatekeeperResourceDetailPage kind="templates" canManagePolicy />, {
      path: '/policy-as-code/gatekeeper/templates/detail',
      initialEntries: [
        '/policy-as-code/gatekeeper/templates/detail?name=k8srequiredlabels&context=docker-desktop',
      ],
    });
    cy.wait('@gatekeeper');

    cy.contains('a', 'K8sRequiredLabels/require-owner')
      .should('have.attr', 'href')
      .and('include', 'name=require-owner');
    cy.get('a[href*="name=&"]').should('not.exist');
  });

  it('opens a violation as a full detail page and preserves AI remediation', () => {
    cy.intercept('GET', '/api/v2/opa/gatekeeper/**', gatekeeperResponse).as('gatekeeper');
    cy.intercept('POST', awxAPI`/opa/gatekeeper/remediate/`, (request) => {
      const body = request.body as {
        mode: string;
        violation: { resource_name: string };
      };
      expect(body.mode).to.equal('preview');
      expect(body.violation.resource_name).to.equal('payments');
      request.reply({
        changed: false,
        persisted: false,
        dry_run: false,
        mode: 'preview',
        operation: 'remediate',
        target: { api_version: 'v1', kind: 'Namespace', name: 'payments' },
        plan: {
          summary: 'Add the required owner label.',
          rationale: 'The namespace is missing metadata.labels.owner.',
          risk: 'low',
          target: { api_version: 'v1', kind: 'Namespace', name: 'payments' },
          patch_type: 'merge',
          patch: { metadata: { labels: { owner: 'platform' } } },
          manual_steps: [],
          can_apply: true,
        },
        before_exists: true,
        before_sha256: 'before',
        after_sha256: 'after',
        diff: '+ owner: platform',
        rollback_plan: {},
        opa_allowed: true,
        audit: { activity_stream_id: 91 },
      });
    }).as('remediate');
    const key = [
      violation.constraint_kind,
      violation.constraint_name,
      violation.resource_kind,
      violation.resource_name,
      violation.message,
    ].join('/');
    const query = new URLSearchParams({
      key,
      resource: violation.resource_name,
      constraint_kind: violation.constraint_kind,
      constraint_name: violation.constraint_name,
      context: 'docker-desktop',
    });

    cy.mount(<GatekeeperResourceDetailPage kind="violations" canManagePolicy />, {
      path: '/policy-as-code/gatekeeper/violations/detail',
      initialEntries: [`/policy-as-code/gatekeeper/violations/detail?${query.toString()}`],
    });
    cy.wait('@gatekeeper');

    cy.contains('h1', 'Namespace/payments').should('be.visible');
    cy.contains('missing owner label').should('be.visible');
    cy.getByDataCy('gatekeeper-remediation-suggest-button').click();
    cy.wait('@remediate');
    cy.contains('Add the required owner label.').should('be.visible');
    cy.contains('a', 'Activity Stream #91').should('have.attr', 'href', '/activity-stream?id=91');
  });
});
