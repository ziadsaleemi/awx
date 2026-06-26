import { EdaActivationPage } from './EdaActivationPage';
import { EdaActivations } from './EdaActivations';
import { EdaResourceConfig, EdaResourceList } from './EdaResourceList';

const activation = {
  id: 42,
  name: 'Restart web on alert',
  status: 'running',
  started: '2026-06-01T12:00:00Z',
  finished: null,
  rulebook: 'restart-web.yml',
  event_source: 'Webhook',
  source: 'eda_controller',
  related: {
    controller_activation: 'https://eda.example.test/api/eda/v1/activations/42/',
  },
};

const rulebookConfig: EdaResourceConfig = {
  resource: 'rulebooks',
  title: 'Rulebooks',
  description: 'Inspect rulebooks discovered by synced EDA projects.',
  emptyStateTitle: 'No rulebooks found',
  emptyStateDescription: 'Sync an EDA project to discover rulebooks.',
  readOnly: true,
  fields: [
    { label: 'Project', keys: ['project_name', 'project'] },
    { label: 'Rulesets', keys: ['rulesets', 'ruleset_count'] },
  ],
};

describe('EdaActivations', () => {
  beforeEach(() => {
    cy.intercept('GET', '/api/v2/eda/status/', {
      configured: true,
      status: 'configured',
      controller_url: 'https://eda.example.test',
      auth_configured: true,
      activations_url: '/api/v2/eda/activations/',
      settings_url: '/api/v2/settings/eda/',
      message: 'EDA Controller URL is configured.',
    });
  });

  function interceptEdaRoleDefinitions(userId: number, roleId: number, permissions: string[]) {
    cy.intercept('GET', `/api/v2/role_user_assignments/?user_id=${userId}&page_size=200`, {
      count: 0,
      next: null,
      previous: null,
      results: [],
    });
    cy.intercept('GET', `/api/v2/users/${userId}/teams/`, {
      count: 0,
      next: null,
      previous: null,
      results: [],
    });
    cy.intercept('GET', `/api/v2/role_definitions/${roleId}/`, {
      id: roleId,
      permissions,
    });
  }

  function interceptActivationStartLookups() {
    cy.intercept('GET', '/api/v2/eda/rulebooks/?page_size=200&order_by=name', {
      count: 1,
      next: null,
      previous: null,
      results: [{ id: 11, name: 'restart-web.yml', project_name: 'EDA Samples' }],
    }).as('activationRulebooks');
    cy.intercept('GET', '/api/v2/eda/decision-environments/?page_size=200&order_by=name', {
      count: 1,
      next: null,
      previous: null,
      results: [
        {
          id: 12,
          name: 'Rulebook runtime',
          image_url: 'quay.io/ansible/ansible-rulebook:latest',
        },
      ],
    }).as('activationDecisionEnvironments');
    cy.intercept('GET', '/api/v2/eda/credentials/?page_size=200&order_by=name', {
      count: 2,
      next: null,
      previous: null,
      results: [
        {
          id: 7,
          name: 'Controller credential',
          credential_type: {
            id: 20,
            name: 'Red Hat Ansible Automation Platform',
            namespace: 'controller',
          },
        },
        {
          id: 8,
          name: 'Rule engine credential',
          credential_type: {
            id: 30,
            name: 'Event-Driven Ansible Rule Engine',
            namespace: 'drools',
          },
        },
      ],
    }).as('activationCredentials');
  }

  it('renders activations and starts a new activation', () => {
    cy.intercept('GET', '/api/v2/eda/activations/?order_by=name&page=1&page_size=10', {
      count: 1,
      next: null,
      previous: null,
      results: [activation],
    }).as('activations');
    cy.intercept('POST', '/api/v2/eda/activations/start/', {
      source: 'eda_controller',
      activation,
      actions: ['created', 'started'],
      events: [],
    }).as('startActivation');
    interceptActivationStartLookups();

    cy.mount(<EdaActivations />, {
      path: '/eda/activations',
      initialEntries: ['/eda/activations'],
    });

    cy.verifyPageTitle('Rulebook Activations');
    cy.contains('Restart web on alert').should('be.visible');
    cy.contains('restart-web.yml').should('be.visible');
    cy.contains('button', 'Create/start activation').click();
    cy.get('#eda-rulebook-name').type('restart-web.yml');
    cy.contains('button', /^Start$/).click();
    cy.wait('@startActivation');
  });

  it('renders activation detail events and restart action', () => {
    cy.intercept('GET', '/api/v2/eda/activations/42/', activation).as('activation');
    cy.intercept('GET', '/api/v2/eda/activations/42/events/?page_size=50', {
      count: 1,
      next: null,
      previous: null,
      results: [
        {
          id: 9,
          event_type: 'rule',
          status: 'ok',
          rule: 'restart',
          message: 'activation started',
          created: '2026-06-01T12:00:01Z',
        },
      ],
    }).as('events');
    cy.intercept('POST', '/api/v2/eda/activations/42/restart/', {
      source: 'eda_controller',
      activation,
      actions: ['restart'],
    }).as('restartActivation');

    cy.mount(<EdaActivationPage />, {
      path: '/eda/activations/:id',
      initialEntries: ['/eda/activations/42'],
    });

    cy.verifyPageTitle('Restart web on alert');
    cy.contains('Activation events').should('be.visible');
    cy.contains('activation started').should('be.visible');
    cy.contains('button', /^Restart$/).click();
    cy.wait('@restartActivation');
  });

  it('lets EDA operators operate existing activations without delete or create-by-rulebook access', () => {
    interceptEdaRoleDefinitions(33, 54, [
      'shared.view_edaactivation',
      'shared.execute_edaactivation',
    ]);
    cy.intercept('GET', '/api/v2/eda/activations/?order_by=name&page=1&page_size=10', {
      count: 1,
      next: null,
      previous: null,
      results: [activation],
    }).as('activations');
    cy.intercept('POST', '/api/v2/eda/activations/start/', {
      source: 'eda_controller',
      activation,
      actions: ['started'],
      events: [],
    }).as('startActivation');
    interceptActivationStartLookups();

    cy.mount(
      <EdaActivations />,
      {
        path: '/eda/activations',
        initialEntries: ['/eda/activations'],
      },
      'activeUserEdaOperator.json'
    );

    cy.verifyPageTitle('Rulebook Activations');
    cy.contains('button', 'Create/start activation').click();
    cy.get('#eda-rulebook-name').should('be.disabled');
    cy.contains('button', /^Start$/).should('be.disabled');
    cy.get('#eda-activation-id').type('42');
    cy.contains('button', /^Start$/).click();
    cy.wait('@startActivation')
      .its('request.body')
      .then((body: { activation_id: string; rulebook_name: string }) => {
        expect(body.activation_id).to.equal('42');
        expect(body.rulebook_name).to.equal('');
      });
  });

  it('lets EDA administrators create activations by rulebook', () => {
    interceptEdaRoleDefinitions(34, 55, [
      'shared.view_edaactivation',
      'shared.execute_edaactivation',
      'shared.change_edaactivation',
    ]);
    cy.intercept('GET', '/api/v2/eda/activations/?order_by=name&page=1&page_size=10', {
      count: 0,
      next: null,
      previous: null,
      results: [],
    });
    cy.intercept('POST', '/api/v2/eda/activations/start/', {
      source: 'eda_controller',
      activation,
      actions: ['created', 'started'],
      events: [],
    }).as('startActivation');
    interceptActivationStartLookups();

    cy.mount(
      <EdaActivations />,
      {
        path: '/eda/activations',
        initialEntries: ['/eda/activations'],
      },
      'activeUserEdaAdmin.json'
    );

    cy.contains('button', 'Create/start activation').click();
    cy.get('#eda-rulebook-name').should('not.be.disabled').type('restart-web.yml');
    cy.contains('button', /^Start$/).click();
    cy.wait('@startActivation')
      .its('request.body')
      .then((body: { rulebook_name: string }) => {
        expect(body.rulebook_name).to.equal('restart-web.yml');
      });
  });

  it('lets EDA administrators start rulebooks with credentials and decision environment fields', () => {
    interceptEdaRoleDefinitions(34, 55, [
      'shared.view_edaactivation',
      'shared.execute_edaactivation',
      'shared.change_edaactivation',
    ]);
    cy.intercept('GET', '/api/v2/eda/activations/?order_by=name&page=1&page_size=10', {
      count: 0,
      next: null,
      previous: null,
      results: [],
    });
    cy.intercept('POST', '/api/v2/eda/activations/start/', {
      source: 'eda_controller',
      activation,
      actions: ['created', 'started'],
      events: [],
    }).as('startActivation');
    interceptActivationStartLookups();

    cy.mount(
      <EdaActivations />,
      {
        path: '/eda/activations',
        initialEntries: ['/eda/activations'],
      },
      'activeUserEdaAdmin.json'
    );

    cy.contains('button', 'Create/start activation').click();
    cy.get('#eda-rulebook-select').select('11');
    cy.get('#eda-activation-name').type('restart-web-proof');
    cy.get('#eda-decision-environment').select('12');
    cy.get('#eda-credential-7').click();
    cy.get('#eda-log-level').select('debug');
    cy.get('#eda-enable-persistence').click();
    cy.get('#eda-rule-engine-credential').select('8');
    cy.contains('button', /^Start$/).click();
    cy.wait('@startActivation')
      .its('request.body')
      .then((body: Record<string, unknown>) => {
        expect(body.name).to.equal('restart-web-proof');
        expect(body.rulebook_name).to.equal('restart-web.yml');
        expect(body.rulebook_id).to.equal(11);
        expect(body.decision_environment_id).to.equal(12);
        expect(body.eda_credentials).to.deep.equal([7]);
        expect(body.log_level).to.equal('debug');
        expect(body.enable_persistence).to.equal(true);
        expect(body.rule_engine_credential_id).to.equal(8);
      });
  });

  it('starts an activation from a discovered rulebook row', () => {
    cy.intercept('GET', '/api/v2/eda/rulebooks/?order_by=name&page=1&page_size=10', {
      count: 1,
      next: null,
      previous: null,
      results: [
        {
          id: 11,
          name: 'codex-smoke.yml',
          project_name: 'EDA Samples',
          ruleset_count: 1,
        },
      ],
    }).as('rulebooks');
    cy.intercept('POST', '/api/v2/eda/activations/start/', {
      source: 'eda_controller',
      activation,
      actions: ['created', 'started'],
      events: [],
    }).as('startFromRulebook');
    interceptActivationStartLookups();

    cy.mount(<EdaResourceList config={rulebookConfig} />, {
      path: '/eda/rulebooks',
      initialEntries: ['/eda/rulebooks'],
    });

    cy.verifyPageTitle('Rulebooks');
    cy.wait('@rulebooks');
    cy.contains('codex-smoke.yml').should('be.visible');
    cy.get('[aria-label="kebab dropdown toggle"]').click();
    cy.contains('button', 'Create/start activation').click();
    cy.get('#eda-rulebook-name').should('have.value', 'codex-smoke.yml');
    cy.get('#eda-credential-7').click();
    cy.contains('button', /^Start$/).click();
    cy.wait('@startFromRulebook')
      .its('request.body')
      .then(
        (body: {
          rulebook_name: string;
          rulebook_id: number;
          poll: boolean;
          eda_credentials: number[];
        }) => {
          expect(body.rulebook_name).to.equal('codex-smoke.yml');
          expect(body.rulebook_id).to.equal(11);
          expect(body.eda_credentials).to.deep.equal([7]);
          expect(body.poll).to.equal(true);
        }
      );
  });
});
