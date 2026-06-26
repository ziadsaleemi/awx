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

const credentialTypeConfig: EdaResourceConfig = {
  resource: 'credential-types',
  title: 'Credential Types',
  description: 'Manage EDA credential type schemas and injectors.',
  emptyStateTitle: 'No EDA credential types found',
  emptyStateDescription: 'Create an EDA credential type to define credential inputs.',
  form: 'credential-type',
  fields: [
    { label: 'Kind', keys: ['kind', 'managed_by'] },
    { label: 'Namespace', keys: ['namespace'] },
  ],
};

const organizationConfig: EdaResourceConfig = {
  resource: 'organizations',
  title: 'Organizations',
  description: 'Manage EDA organizations available on the connected EDA Controller.',
  emptyStateTitle: 'No EDA organizations found',
  emptyStateDescription: 'Create or sync an EDA organization before assigning teams and resources.',
  form: 'organization',
  fields: [{ label: 'Description', keys: ['description'] }],
};

const teamConfig: EdaResourceConfig = {
  resource: 'teams',
  title: 'Teams',
  description: 'Manage EDA teams and their organization membership.',
  emptyStateTitle: 'No EDA teams found',
  emptyStateDescription: 'Create an EDA team to group users for EDA role assignments.',
  form: 'team',
  fields: [{ label: 'Organization', keys: ['organization_name', 'organization'] }],
};

const userConfig: EdaResourceConfig = {
  resource: 'users',
  title: 'Users',
  description: 'Manage EDA users on the connected EDA Controller.',
  emptyStateTitle: 'No EDA users found',
  emptyStateDescription: 'Create or sync users before assigning EDA roles.',
  form: 'user',
  fields: [
    { label: 'Username', keys: ['username'] },
    { label: 'Email', keys: ['email'] },
  ],
};

const roleDefinitionConfig: EdaResourceConfig = {
  resource: 'role-definitions',
  title: 'Roles',
  description: 'Manage EDA role definitions and inspect built-in EDA permissions.',
  emptyStateTitle: 'No EDA roles found',
  emptyStateDescription: 'Create a custom EDA role or verify the EDA Controller connection.',
  form: 'role-definition',
  fields: [{ label: 'Content type', keys: ['content_type', 'content_type_model'] }],
};

const userRoleAssignmentConfig: EdaResourceConfig = {
  resource: 'user-role-assignments',
  title: 'User Role Assignments',
  description: 'Manage EDA role assignments granted directly to users.',
  emptyStateTitle: 'No EDA user role assignments found',
  emptyStateDescription: 'Assign an EDA role to a user to grant access.',
  form: 'user-role-assignment',
  nameSort: 'id',
  fields: [
    { label: 'User', keys: ['user', 'username'] },
    { label: 'Role', keys: ['role_definition', 'role_definition_name'] },
  ],
};

const teamRoleAssignmentConfig: EdaResourceConfig = {
  resource: 'team-role-assignments',
  title: 'Team Role Assignments',
  description: 'Manage EDA role assignments granted to teams.',
  emptyStateTitle: 'No EDA team role assignments found',
  emptyStateDescription: 'Assign an EDA role to a team to grant access.',
  form: 'team-role-assignment',
  nameSort: 'id',
  fields: [
    { label: 'Team', keys: ['team', 'team_name'] },
    { label: 'Role', keys: ['role_definition', 'role_definition_name'] },
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

  it('shows activations linked to an EDA event stream', () => {
    cy.intercept('GET', '/api/v2/eda/event-streams/?order_by=name&page=1&page_size=10', {
      count: 1,
      next: null,
      previous: null,
      results: [
        {
          id: 21,
          name: 'Webhook intake',
          status: 'enabled',
          test_mode: false,
        },
      ],
    }).as('eventStreams');
    cy.intercept('GET', '/api/v2/eda/event-streams/21/activations/?page_size=50&order_by=name', {
      count: 1,
      next: null,
      previous: null,
      results: [
        {
          id: 42,
          name: 'Webhook activation',
          status: 'running',
          created_at: '2026-06-01T12:00:00Z',
          modified_at: '2026-06-01T12:05:00Z',
        },
      ],
    }).as('eventStreamActivations');

    cy.mount(<EdaResourceList config={eventStreamConfig} />, {
      path: '/eda/event-streams',
      initialEntries: ['/eda/event-streams'],
    });

    cy.verifyPageTitle('Event Streams');
    cy.wait('@eventStreams');
    cy.contains('Webhook intake').should('be.visible');
    cy.get('[aria-label="kebab dropdown toggle"]').click();
    cy.contains('button', 'View activations').click();
    cy.wait('@eventStreamActivations');
    cy.contains('Event stream activations').should('be.visible');
    cy.contains('Webhook activation').should('be.visible');
    cy.contains('Running').should('be.visible');
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

  it('creates EDA credential types with fields and generated injectors', () => {
    cy.intercept('GET', '/api/v2/eda/credential-types/?order_by=name&page=1&page_size=10', {
      count: 0,
      next: null,
      previous: null,
      results: [],
    }).as('credentialTypes');
    cy.intercept('POST', '/api/v2/eda/credential-types/', {
      id: 41,
      name: 'Kafka Source',
    }).as('createCredentialType');

    cy.mount(<EdaResourceList config={credentialTypeConfig} />, {
      path: '/eda/infrastructure/credential-types',
      initialEntries: ['/eda/infrastructure/credential-types'],
    });

    cy.verifyPageTitle('Credential Types');
    cy.wait('@credentialTypes');
    cy.contains('button', /^Create$/).click();
    cy.contains('Resource JSON').should('not.exist');
    cy.get('#eda-credential-type-name').type('Kafka Source');
    cy.get('#eda-credential-type-description').type('Kafka source plugin secrets');
    cy.get('#eda-credential-type-field-id-field-0').type('sasl_plain_password');
    cy.get('#eda-credential-type-field-label-field-0').type('SASL Password');
    cy.get('#eda-credential-type-field-help-field-0').type('Kafka SASL password');
    cy.get('#eda-credential-type-field-secret-field-0').click();
    cy.contains('button', /^Add field$/).click();
    cy.get('#eda-credential-type-field-id-field-1').type('security_mechanism');
    cy.get('#eda-credential-type-field-label-field-1').type('Security mechanism');
    cy.get('#eda-credential-type-field-choices-field-1').type('PLAIN, SCRAM-SHA-512');
    cy.contains('button', /^Save$/).click();

    cy.wait('@createCredentialType')
      .its('request.body')
      .then((body: Record<string, unknown>) => {
        expect(body.name).to.equal('Kafka Source');
        expect(body.description).to.equal('Kafka source plugin secrets');
        expect(body.inputs).to.deep.equal({
          fields: [
            {
              id: 'sasl_plain_password',
              label: 'SASL Password',
              type: 'string',
              help_text: 'Kafka SASL password',
              secret: true,
            },
            {
              id: 'security_mechanism',
              label: 'Security mechanism',
              type: 'string',
              choices: ['PLAIN', 'SCRAM-SHA-512'],
            },
          ],
        });
        expect(body.injectors).to.deep.equal({
          extra_vars: {
            sasl_plain_password: '{{sasl_plain_password}}',
            security_mechanism: '{{security_mechanism}}',
          },
        });
      });
  });

  it('creates EDA organizations with structured fields instead of raw JSON', () => {
    cy.intercept('GET', '/api/v2/eda/organizations/?order_by=name&page=1&page_size=10', {
      count: 0,
      next: null,
      previous: null,
      results: [],
    }).as('organizations');
    cy.intercept('POST', '/api/v2/eda/organizations/', {
      id: 51,
      name: 'Operations',
    }).as('createOrganization');

    cy.mount(<EdaResourceList config={organizationConfig} />, {
      path: '/eda/access/organizations',
      initialEntries: ['/eda/access/organizations'],
    });

    cy.verifyPageTitle('Organizations');
    cy.wait('@organizations');
    cy.contains('button', /^Create$/).click();
    cy.contains('Resource JSON').should('not.exist');
    cy.get('#eda-organization-name').type('Operations');
    cy.get('#eda-organization-description').type('Operations automation');
    cy.contains('button', /^Save$/).click();

    cy.wait('@createOrganization')
      .its('request.body')
      .then((body: Record<string, unknown>) => {
        expect(body).to.deep.equal({
          name: 'Operations',
          description: 'Operations automation',
        });
      });
  });

  it('creates EDA teams with an organization selector', () => {
    cy.intercept('GET', '/api/v2/eda/teams/?order_by=name&page=1&page_size=10', {
      count: 0,
      next: null,
      previous: null,
      results: [],
    }).as('teams');
    cy.intercept('GET', '/api/v2/eda/organizations/?page_size=200&order_by=name', {
      count: 1,
      next: null,
      previous: null,
      results: [{ id: 1, name: 'Default' }],
    }).as('organizationLookup');
    cy.intercept('POST', '/api/v2/eda/teams/', { id: 52, name: 'EDA Operators' }).as('createTeam');

    cy.mount(<EdaResourceList config={teamConfig} />, {
      path: '/eda/access/teams',
      initialEntries: ['/eda/access/teams'],
    });

    cy.verifyPageTitle('Teams');
    cy.wait('@teams');
    cy.contains('button', /^Create$/).click();
    cy.contains('Resource JSON').should('not.exist');
    cy.wait('@organizationLookup');
    cy.get('#eda-team-name').type('EDA Operators');
    cy.get('#eda-team-description').type('Operators for event-driven automation');
    cy.get('#eda-team-organization').select('1');
    cy.contains('button', /^Save$/).click();

    cy.wait('@createTeam')
      .its('request.body')
      .then((body: Record<string, unknown>) => {
        expect(body).to.deep.equal({
          name: 'EDA Operators',
          description: 'Operators for event-driven automation',
          organization_id: 1,
        });
      });
  });

  it('creates EDA users with profile and privilege fields', () => {
    cy.intercept('GET', '/api/v2/eda/users/?order_by=name&page=1&page_size=10', {
      count: 0,
      next: null,
      previous: null,
      results: [],
    }).as('users');
    cy.intercept('POST', '/api/v2/eda/users/', { id: 53, username: 'eda-admin' }).as('createUser');

    cy.mount(<EdaResourceList config={userConfig} />, {
      path: '/eda/access/users',
      initialEntries: ['/eda/access/users'],
    });

    cy.verifyPageTitle('Users');
    cy.wait('@users');
    cy.contains('button', /^Create$/).click();
    cy.contains('Resource JSON').should('not.exist');
    cy.get('#eda-user-username').type('eda-admin');
    cy.get('#eda-user-first-name').type('EDA');
    cy.get('#eda-user-last-name').type('Admin');
    cy.get('#eda-user-email').type('eda-admin@example.test');
    cy.get('#eda-user-password').type('Welcome123!');
    cy.get('#eda-user-superuser').click();
    cy.get('#eda-user-staff').click();
    cy.contains('button', /^Save$/).click();

    cy.wait('@createUser')
      .its('request.body')
      .then((body: Record<string, unknown>) => {
        expect(body).to.deep.equal({
          username: 'eda-admin',
          first_name: 'EDA',
          last_name: 'Admin',
          email: 'eda-admin@example.test',
          password: 'Welcome123!',
          is_superuser: true,
          is_staff: true,
        });
      });
  });

  it('creates EDA roles with permission fields', () => {
    cy.intercept('GET', '/api/v2/eda/role-definitions/?order_by=name&page=1&page_size=10', {
      count: 0,
      next: null,
      previous: null,
      results: [],
    }).as('roles');
    cy.intercept('POST', '/api/v2/eda/role-definitions/', { id: 54, name: 'Activation Admin' }).as(
      'createRole'
    );

    cy.mount(<EdaResourceList config={roleDefinitionConfig} />, {
      path: '/eda/access/roles',
      initialEntries: ['/eda/access/roles'],
    });

    cy.verifyPageTitle('Roles');
    cy.wait('@roles');
    cy.contains('button', /^Create$/).click();
    cy.contains('Resource JSON').should('not.exist');
    cy.get('#eda-role-definition-name').type('Activation Admin');
    cy.get('#eda-role-definition-description').type('Can administer EDA activations');
    cy.get('#eda-role-definition-content-type').type('activation');
    cy.get('#eda-role-definition-permissions').type('view_activation, change_activation');
    cy.contains('button', /^Save$/).click();

    cy.wait('@createRole')
      .its('request.body')
      .then((body: Record<string, unknown>) => {
        expect(body).to.deep.equal({
          name: 'Activation Admin',
          description: 'Can administer EDA activations',
          content_type: 'activation',
          permissions: ['view_activation', 'change_activation'],
        });
      });
  });

  it('creates EDA user role assignments with user and role selectors', () => {
    cy.intercept('GET', /\/api\/v2\/eda\/user-role-assignments\/\?.*/, {
      count: 0,
      next: null,
      previous: null,
      results: [],
    }).as('assignments');
    cy.intercept('GET', '/api/v2/eda/users/?page_size=200&order_by=username', {
      count: 1,
      next: null,
      previous: null,
      results: [{ id: 53, username: 'eda-admin', email: 'eda-admin@example.test' }],
    }).as('userLookup');
    cy.intercept('GET', '/api/v2/eda/role-definitions/?page_size=200&order_by=name', {
      count: 1,
      next: null,
      previous: null,
      results: [{ id: 54, name: 'Activation Admin' }],
    }).as('roleLookup');
    cy.intercept('POST', '/api/v2/eda/user-role-assignments/', { id: 55 }).as(
      'createUserAssignment'
    );

    cy.mount(<EdaResourceList config={userRoleAssignmentConfig} />, {
      path: '/eda/access/user-role-assignments',
      initialEntries: ['/eda/access/user-role-assignments'],
    });

    cy.verifyPageTitle('User Role Assignments');
    cy.wait('@assignments');
    cy.contains('button', /^Create$/).click();
    cy.contains('Resource JSON').should('not.exist');
    cy.wait(['@userLookup', '@roleLookup']);
    cy.get('#eda-user-role-assignment-user').select('53');
    cy.get('#eda-user-role-assignment-user-role-definition').select('54');
    cy.get('#eda-user-role-assignment-user-content-type').type('activation');
    cy.get('#eda-user-role-assignment-user-object-id').type('99');
    cy.contains('button', /^Save$/).click();

    cy.wait('@createUserAssignment')
      .its('request.body')
      .then((body: Record<string, unknown>) => {
        expect(body).to.deep.equal({
          user: 53,
          role_definition: 54,
          content_type: 'activation',
          object_id: 99,
        });
      });
  });

  it('creates EDA team role assignments with team and role selectors', () => {
    cy.intercept('GET', /\/api\/v2\/eda\/team-role-assignments\/\?.*/, {
      count: 0,
      next: null,
      previous: null,
      results: [],
    }).as('assignments');
    cy.intercept('GET', '/api/v2/eda/teams/?page_size=200&order_by=name', {
      count: 1,
      next: null,
      previous: null,
      results: [{ id: 52, name: 'EDA Operators' }],
    }).as('teamLookup');
    cy.intercept('GET', '/api/v2/eda/role-definitions/?page_size=200&order_by=name', {
      count: 1,
      next: null,
      previous: null,
      results: [{ id: 54, name: 'Activation Admin' }],
    }).as('roleLookup');
    cy.intercept('POST', '/api/v2/eda/team-role-assignments/', { id: 56 }).as(
      'createTeamAssignment'
    );

    cy.mount(<EdaResourceList config={teamRoleAssignmentConfig} />, {
      path: '/eda/access/team-role-assignments',
      initialEntries: ['/eda/access/team-role-assignments'],
    });

    cy.verifyPageTitle('Team Role Assignments');
    cy.wait('@assignments');
    cy.contains('button', /^Create$/).click();
    cy.contains('Resource JSON').should('not.exist');
    cy.wait(['@teamLookup', '@roleLookup']);
    cy.get('#eda-team-role-assignment-team').select('52');
    cy.get('#eda-team-role-assignment-team-role-definition').select('54');
    cy.contains('button', /^Save$/).click();

    cy.wait('@createTeamAssignment')
      .its('request.body')
      .then((body: Record<string, unknown>) => {
        expect(body).to.deep.equal({
          team: 52,
          role_definition: 54,
        });
      });
  });
});
