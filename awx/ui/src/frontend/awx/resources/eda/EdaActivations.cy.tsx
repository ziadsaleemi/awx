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

const projectConfig: EdaResourceConfig = {
  resource: 'projects',
  title: 'Projects',
  description: 'Manage EDA projects used to discover rulebooks.',
  emptyStateTitle: 'No EDA projects found',
  emptyStateDescription: 'Create or sync an EDA project to load rulebooks.',
  form: 'project',
  fields: [
    { label: 'SCM URL', keys: ['url', 'scm_url'] },
    { label: 'Status', keys: ['import_state', 'status', 'state'], type: 'status' },
  ],
};

const decisionEnvironmentConfig: EdaResourceConfig = {
  resource: 'decision-environments',
  title: 'Decision Environments',
  description: 'Manage execution images used by EDA rulebook activations.',
  emptyStateTitle: 'No decision environments found',
  emptyStateDescription:
    'Create a decision environment image reference before launching rulebooks.',
  form: 'decision-environment',
  fields: [
    { label: 'Image', keys: ['image_url', 'image', 'container_image'] },
    { label: 'Status', keys: ['status', 'state'], type: 'status' },
  ],
};

const eventStreamConfig: EdaResourceConfig = {
  resource: 'event-streams',
  title: 'Event Streams',
  description: 'Manage EDA event stream endpoints for inbound events.',
  emptyStateTitle: 'No event streams found',
  emptyStateDescription: 'Create an event stream to receive webhook or external events.',
  form: 'event-stream',
  fields: [
    { label: 'Status', keys: ['status', 'state'], type: 'status' },
    { label: 'Test mode', keys: ['test_mode', 'is_test_mode'] },
  ],
};

const credentialConfig: EdaResourceConfig = {
  resource: 'credentials',
  title: 'Credentials',
  description: 'Manage credentials used by EDA projects, rulebooks, and event streams.',
  emptyStateTitle: 'No EDA credentials found',
  emptyStateDescription: 'Create an EDA credential or sync credentials from the EDA Controller.',
  form: 'credential',
  fields: [
    { label: 'Type', keys: ['credential_type_name', 'credential_type', 'kind'] },
    { label: 'Organization', keys: ['organization_name', 'organization'] },
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
            kind: 'cloud',
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

  function interceptCredentialTypes() {
    cy.intercept('GET', '/api/v2/eda/credential-types/?page_size=200&order_by=name', {
      count: 1,
      next: null,
      previous: null,
      results: [
        {
          id: 20,
          name: 'Red Hat Ansible Automation Platform',
          namespace: 'controller',
          kind: 'cloud',
          inputs: {
            fields: [
              { id: 'host', label: 'Host', type: 'string' },
              { id: 'username', label: 'Username', type: 'string' },
              { id: 'password', label: 'Password', type: 'string', secret: true },
              { id: 'verify_ssl', label: 'Verify SSL', type: 'boolean', default: true },
            ],
            required: ['host', 'username', 'password'],
          },
        },
      ],
    }).as('credentialTypes');
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

  it('creates EDA projects with structured fields instead of raw JSON', () => {
    cy.intercept('GET', '/api/v2/eda/projects/?order_by=name&page=1&page_size=10', {
      count: 0,
      next: null,
      previous: null,
      results: [],
    }).as('projects');
    cy.intercept('POST', '/api/v2/eda/projects/', {
      id: 9,
      name: 'EDA Samples',
      url: 'https://github.com/example/eda-samples.git',
    }).as('createProject');
    interceptActivationStartLookups();

    cy.mount(<EdaResourceList config={projectConfig} />, {
      path: '/eda/projects',
      initialEntries: ['/eda/projects'],
    });

    cy.verifyPageTitle('Projects');
    cy.wait('@projects');
    cy.contains('button', /^Create$/).click();
    cy.contains('Resource JSON').should('not.exist');
    cy.get('#eda-project-name').type('EDA Samples');
    cy.get('#eda-project-description').type('Sample event-driven project');
    cy.get('#eda-project-url').type('https://github.com/example/eda-samples.git');
    cy.get('#eda-project-branch').clear().type('main');
    cy.get('#eda-project-refspec').type('refs/heads/main');
    cy.get('#eda-project-credential').select('7');
    cy.get('#eda-project-cache-timeout').type('60');
    cy.get('#eda-project-update-revision').click();
    cy.contains('button', /^Save$/).click();

    cy.wait('@createProject')
      .its('request.body')
      .then((body: Record<string, unknown>) => {
        expect(body.name).to.equal('EDA Samples');
        expect(body.description).to.equal('Sample event-driven project');
        expect(body.url).to.equal('https://github.com/example/eda-samples.git');
        expect(body.scm_branch).to.equal('main');
        expect(body.scm_refspec).to.equal('refs/heads/main');
        expect(body.eda_credential_id).to.equal(7);
        expect(body.verify_ssl).to.equal(true);
        expect(body.update_revision_on_launch).to.equal(true);
        expect(body.scm_update_cache_timeout).to.equal(60);
      });
  });

  it('edits EDA decision environments with image, pull policy, and credential fields', () => {
    cy.intercept('GET', '/api/v2/eda/decision-environments/?order_by=name&page=1&page_size=10', {
      count: 1,
      next: null,
      previous: null,
      results: [
        {
          id: 12,
          name: 'Rulebook runtime',
          description: 'Old runtime',
          image_url: 'quay.io/ansible/ansible-rulebook:latest',
          pull_policy: 'always',
          eda_credential_id: 7,
        },
      ],
    }).as('decisionEnvironments');
    cy.intercept('PATCH', '/api/v2/eda/decision-environments/12/', {
      id: 12,
      name: 'Rulebook runtime',
      image_url: 'quay.io/example/eda:stable',
    }).as('updateDecisionEnvironment');
    interceptActivationStartLookups();

    cy.mount(<EdaResourceList config={decisionEnvironmentConfig} />, {
      path: '/eda/decision-environments',
      initialEntries: ['/eda/decision-environments'],
    });

    cy.verifyPageTitle('Decision Environments');
    cy.wait('@decisionEnvironments');
    cy.get('[aria-label="kebab dropdown toggle"]').click();
    cy.contains('button', /^Edit$/).click();
    cy.contains('Resource JSON').should('not.exist');
    cy.get('#eda-decision-environment-name').should('have.value', 'Rulebook runtime');
    cy.get('#eda-decision-environment-description').clear().type('Stable runtime');
    cy.get('#eda-decision-environment-image').clear().type('quay.io/example/eda:stable');
    cy.get('#eda-decision-environment-pull-policy').select('missing');
    cy.get('#eda-decision-environment-credential').select('');
    cy.contains('button', /^Save$/).click();

    cy.wait('@updateDecisionEnvironment')
      .its('request.body')
      .then((body: Record<string, unknown>) => {
        expect(body.name).to.equal('Rulebook runtime');
        expect(body.description).to.equal('Stable runtime');
        expect(body.image_url).to.equal('quay.io/example/eda:stable');
        expect(body.pull_policy).to.equal('missing');
        expect(body.eda_credential_id).to.equal(null);
      });
  });

  it('creates EDA event streams with credential and header fields', () => {
    cy.intercept('GET', '/api/v2/eda/event-streams/?order_by=name&page=1&page_size=10', {
      count: 0,
      next: null,
      previous: null,
      results: [],
    }).as('eventStreams');
    cy.intercept('POST', '/api/v2/eda/event-streams/', {
      id: 21,
      name: 'Webhook intake',
      test_mode: true,
    }).as('createEventStream');
    interceptActivationStartLookups();

    cy.mount(<EdaResourceList config={eventStreamConfig} />, {
      path: '/eda/event-streams',
      initialEntries: ['/eda/event-streams'],
    });

    cy.verifyPageTitle('Event Streams');
    cy.wait('@eventStreams');
    cy.contains('button', /^Create$/).click();
    cy.contains('Resource JSON').should('not.exist');
    cy.get('#eda-event-stream-name').type('Webhook intake');
    cy.get('#eda-event-stream-credential').select('7');
    cy.get('#eda-event-stream-uuid').type('stream-uuid-1');
    cy.get('#eda-event-stream-additional-data-headers')
      .clear()
      .type('{ "X-EDA-Tenant": "acme" }', { parseSpecialCharSequences: false });
    cy.get('#eda-event-stream-test-mode').click();
    cy.contains('button', /^Save$/).click();

    cy.wait('@createEventStream')
      .its('request.body')
      .then((body: Record<string, unknown>) => {
        expect(body.name).to.equal('Webhook intake');
        expect(body.eda_credential_id).to.equal(7);
        expect(body.uuid).to.equal('stream-uuid-1');
        expect(body.test_mode).to.equal(true);
        expect(body.additional_data_headers).to.deep.equal({ 'X-EDA-Tenant': 'acme' });
      });
  });

  it('creates EDA credentials from credential type input schemas', () => {
    cy.intercept('GET', '/api/v2/eda/credentials/?order_by=name&page=1&page_size=10', {
      count: 0,
      next: null,
      previous: null,
      results: [],
    }).as('credentials');
    cy.intercept('POST', '/api/v2/eda/credentials/', {
      id: 31,
      name: 'Controller API',
    }).as('createCredential');
    interceptCredentialTypes();

    cy.mount(<EdaResourceList config={credentialConfig} />, {
      path: '/eda/infrastructure/credentials',
      initialEntries: ['/eda/infrastructure/credentials'],
    });

    cy.verifyPageTitle('Credentials');
    cy.wait('@credentials');
    cy.contains('button', /^Create$/).click();
    cy.contains('Resource JSON').should('not.exist');
    cy.wait('@credentialTypes');
    cy.get('#eda-credential-name').type('Controller API');
    cy.get('#eda-credential-description').type('AWX controller access for EDA');
    cy.get('#eda-credential-type').select('20');
    cy.get('#eda-credential-input-host').type('https://awx.example.test');
    cy.get('#eda-credential-input-username').type('admin');
    cy.get('#eda-credential-input-password').type('password');
    cy.contains('button', /^Save$/).click();

    cy.wait('@createCredential')
      .its('request.body')
      .then((body: Record<string, unknown>) => {
        expect(body.name).to.equal('Controller API');
        expect(body.description).to.equal('AWX controller access for EDA');
        expect(body.credential_type_id).to.equal(20);
        expect(body.inputs).to.deep.equal({
          host: 'https://awx.example.test',
          username: 'admin',
          password: 'password',
          verify_ssl: true,
        });
      });
  });
});
