import { Route, Routes } from 'react-router-dom';
import { EdaActivationPage } from './EdaActivationPage';
import { EdaActivationStartPage } from './EdaActivationStartPage';
import { EdaActivations } from './EdaActivations';
import {
  EdaResourceConfig,
  EdaResourceDetailsPage,
  EdaResourceFormPage,
  EdaResourceList,
} from './EdaResourceList';

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
  basePath: '/eda/rulebooks',
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
  resource: 'project-sources',
  basePath: '/eda/projects',
  title: 'Event Engine Projects',
  description: 'Use accessible Capstan Projects as the source of truth for Event Engine rulebooks.',
  emptyStateTitle: 'No source control projects found',
  emptyStateDescription: 'Create a Git project in Capstan, then synchronize it with Event Engine.',
  projectBacked: true,
  fields: [
    { label: 'Source status', keys: ['source_status'], type: 'status' },
    { label: 'Event Engine status', keys: ['integration_status'], type: 'status' },
  ],
};

const decisionEnvironmentConfig: EdaResourceConfig = {
  resource: 'decision-environments',
  basePath: '/eda/decision-environments',
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
  basePath: '/eda/event-streams',
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

const fallbackDataConfig: EdaResourceConfig = {
  resource: 'custom-resources',
  basePath: '/eda/custom-resources',
  title: 'Custom Resources',
  description: 'Manage unstructured EDA resources.',
  emptyStateTitle: 'No custom resources found',
  emptyStateDescription: 'Create a custom EDA resource.',
  createSample: {},
  fields: [{ label: 'Description', keys: ['description'] }],
};

function EdaResourceTestRoutes(props: { config: EdaResourceConfig }) {
  const { config } = props;
  return (
    <Routes>
      <Route path={config.basePath} element={<EdaResourceList config={config} />} />
      <Route
        path={`${config.basePath}/create`}
        element={<EdaResourceFormPage config={config} mode="create" />}
      />
      <Route
        path={`${config.basePath}/:id/edit`}
        element={<EdaResourceFormPage config={config} mode="edit" />}
      />
      <Route path={`${config.basePath}/:id`} element={<EdaResourceDetailsPage config={config} />} />
      <Route path="/eda/activations/create" element={<EdaActivationStartPage />} />
      <Route path="/projects/create" element={<div>Native project create</div>} />
      <Route path="/projects/:id/edit" element={<div>Native project edit</div>} />
      <Route path="/projects/:id/details" element={<div>Native project details</div>} />
    </Routes>
  );
}

function mountEdaResource(
  config: EdaResourceConfig,
  fixture?: string,
  initialEntry = config.basePath
) {
  cy.mount(
    <EdaResourceTestRoutes config={config} />,
    {
      path: '*',
      initialEntries: [initialEntry],
    },
    fixture
  );
}

function EdaActivationTestRoutes() {
  return (
    <Routes>
      <Route path="/eda/activations" element={<EdaActivations />} />
      <Route path="/eda/activations/create" element={<EdaActivationStartPage />} />
      <Route path="/eda/activations/:id" element={<EdaActivationPage />} />
    </Routes>
  );
}

function mountEdaActivations(fixture?: string) {
  cy.mount(
    <EdaActivationTestRoutes />,
    {
      path: '*',
      initialEntries: ['/eda/activations'],
    },
    fixture
  );
}

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
    cy.intercept('GET', /\/api\/v2\/eda\/[^/?]+\/\d+\/$/, (request) => {
      const id = Number(request.url.match(/\/(\d+)\/$/)?.[1] ?? 1);
      request.reply({ id, name: 'Saved EDA resource' });
    });
    cy.intercept('GET', /\/api\/v2\/eda\/activations\/\d+\/events\/\?page_size=50$/, {
      count: 0,
      next: null,
      previous: null,
      results: [],
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

  it('renders activations and starts a new activation', () => {
    cy.intercept('GET', '/api/v2/eda/activations/?order_by=name&page=1&page_size=*', {
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

    mountEdaActivations();

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
    cy.intercept('GET', '/api/v2/eda/activations/?order_by=name&page=1&page_size=*', {
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

    mountEdaActivations('activeUserEdaOperator.json');

    cy.verifyPageTitle('Rulebook Activations');
    cy.contains('button', 'Create/start activation').click();
    cy.get('#eda-rulebook-name').should('be.disabled');
    cy.contains('Operators can start existing activations by ID only.').should('be.visible');
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
    cy.intercept('GET', '/api/v2/eda/activations/?order_by=name&page=1&page_size=*', {
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

    mountEdaActivations('activeUserEdaAdmin.json');

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
    cy.intercept('GET', '/api/v2/eda/activations/?order_by=name&page=1&page_size=*', {
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

    mountEdaActivations('activeUserEdaAdmin.json');

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
    cy.intercept('GET', '/api/v2/eda/rulebooks/?order_by=name&page=1&page_size=*', {
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
    cy.intercept('GET', '/api/v2/eda/rulebooks/?page_size=200&order_by=name', {
      count: 1,
      next: null,
      previous: null,
      results: [
        {
          id: 11,
          name: 'codex-smoke.yml',
          project_name: 'EDA Samples',
        },
      ],
    }).as('activationRulebooks');

    mountEdaResource(rulebookConfig);

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

  it('uses YAML and JSON editor views on EDA resource detail pages', () => {
    cy.intercept('GET', '/api/v2/eda/custom-resources/?order_by=name&page=1&page_size=*', {
      count: 1,
      next: null,
      previous: null,
      results: [
        {
          id: 77,
          name: 'Unstructured resource',
          description: 'Fallback data',
          settings: { enabled: true },
        },
      ],
    }).as('customResources');
    cy.intercept('GET', '/api/v2/eda/custom-resources/77/', {
      id: 77,
      name: 'Unstructured resource',
      description: 'Fallback data',
      settings: { enabled: true },
    }).as('customResource');

    mountEdaResource(fallbackDataConfig);

    cy.verifyPageTitle('Custom Resources');
    cy.wait('@customResources');
    cy.get('[aria-label="kebab dropdown toggle"]').click();
    cy.contains('button', 'View details').click();
    cy.wait('@customResource');
    cy.contains('Resource data').should('be.visible');
    cy.contains('settings:').should('be.visible');
    cy.get('[aria-label="Toggle to JSON"]').click();
    cy.contains('"settings"').should('be.visible');
    cy.contains('a', 'Custom Resources').click();
    cy.verifyPageTitle('Custom Resources');
  });

  it('uses Capstan Projects as Event Engine sources and reconciles the managed mirror', () => {
    cy.intercept('GET', '/api/v2/eda/project-sources/?order_by=name&page=1&page_size=*', {
      count: 1,
      next: null,
      previous: null,
      results: [
        {
          id: 9,
          name: 'EDA Samples',
          description: 'Sample event-driven project',
          source_status: 'successful',
          integration_status: 'not_synced',
          user_capabilities: { edit: true, sync: true },
        },
      ],
    }).as('projects');
    cy.intercept('POST', '/api/v2/eda/project-sources/9/sync/', {
      source: 'capstan_project',
      capstan_project_id: 9,
      project_update: 314,
      id: 314,
      type: 'project_update',
      eda_sync: true,
    }).as('syncProject');

    mountEdaResource(projectConfig);

    cy.verifyPageTitle('Event Engine Projects');
    cy.wait('@projects');
    cy.contains('EDA Samples').should('be.visible');
    cy.contains('not_synced').should('be.visible');
    cy.get('button[aria-label="Sync with Event Engine"]').should('be.visible').click();
    cy.wait('@syncProject');
    cy.contains('Event Engine project sync job 314 started').should('be.visible');
  });

  it('renders a native project detail experience for Event Engine project sources', () => {
    cy.intercept('GET', '/api/v2/eda/project-sources/9/', {
      id: 9,
      name: 'EDA Samples',
      description: 'Sample event-driven project',
      scm_type: 'git',
      scm_url: 'https://github.com/example/eda-samples.git',
      scm_branch: 'main',
      source_status: 'successful',
      source_last_updated: '2026-07-30T16:55:40Z',
      organization_id: 1,
      organization_name: 'Default',
      credential_mapping: 'not_required',
      integration_status: 'synced',
      controller_status: 'configured',
      eda_project_id: 22,
      eda_project_name: 'Capstan Project 9 - EDA Samples',
      eda_status: 'completed',
      eda_last_synced_at: '2026-07-30T17:09:52Z',
      eda_git_hash: 'f38058f06d415f269dd9904af14eefb442008a85',
      mismatched_fields: [],
      created: '2026-07-30T16:55:38Z',
      modified: '2026-07-30T16:55:38Z',
      user_capabilities: { edit: true, sync: true },
    }).as('projectSource');
    cy.intercept('POST', '/api/v2/eda/project-sources/9/sync/', {
      source: 'capstan_project',
      capstan_project_id: 9,
      project_update: 315,
      id: 315,
      type: 'project_update',
      eda_sync: true,
    }).as('syncProjectSource');

    mountEdaResource(projectConfig, undefined, '/eda/projects/9');

    cy.wait('@projectSource');
    cy.verifyPageTitle('EDA Samples');
    cy.contains('[role="tab"]', 'Back to Event Engine Projects').should('be.visible');
    cy.contains('[role="tab"]', 'Details').should('have.attr', 'aria-selected', 'true');
    cy.contains('Source control URL').should('be.visible');
    cy.contains('https://github.com/example/eda-samples.git').should('be.visible');
    cy.contains('Credential mapping').should('be.visible');
    cy.contains('Not Required').should('be.visible');
    cy.contains('Resource data').should('not.exist');
    cy.contains('button', 'Edit project').should('be.visible');

    cy.contains('[role="tab"]', /^Event Engine$/).click();
    cy.contains('Managed Event Engine project').should('be.visible');
    cy.contains('Capstan Project 9 - EDA Samples').should('be.visible');
    cy.contains('Imported revision').should('be.visible');

    cy.contains('button', 'Sync with Event Engine').click();
    cy.wait('@syncProjectSource');
    cy.contains('Event Engine project sync job 315 started').should('be.visible');
  });

  it('routes Event Engine project create and edit to native Capstan Project pages', () => {
    cy.intercept('GET', '/api/v2/eda/project-sources/?order_by=name&page=1&page_size=*', {
      count: 1,
      next: null,
      previous: null,
      results: [
        {
          id: 9,
          name: 'EDA Samples',
          source_status: 'successful',
          integration_status: 'synced',
        },
      ],
    }).as('projects');

    mountEdaResource(projectConfig);

    cy.wait('@projects');
    cy.contains('button', /^Create project$/).click();
    cy.contains('Native project create').should('be.visible');

    mountEdaResource(projectConfig);
    cy.wait('@projects');
    cy.get('[aria-label="kebab dropdown toggle"]').click();
    cy.contains('button', /^Edit$/).click();
    cy.contains('Native project edit').should('be.visible');
  });

  it('edits EDA decision environments with image, pull policy, and credential fields', () => {
    cy.intercept('GET', '/api/v2/eda/decision-environments/?order_by=name&page=1&page_size=*', {
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
    cy.intercept('GET', '/api/v2/eda/decision-environments/12/', {
      id: 12,
      name: 'Rulebook runtime',
      description: 'Old runtime',
      image_url: 'quay.io/ansible/ansible-rulebook:latest',
      pull_policy: 'always',
      eda_credential_id: 7,
    }).as('decisionEnvironment');
    interceptActivationStartLookups();

    mountEdaResource(decisionEnvironmentConfig);

    cy.verifyPageTitle('Decision Environments');
    cy.wait('@decisionEnvironments');
    cy.get('[aria-label="kebab dropdown toggle"]').click();
    cy.contains('button', /^Edit$/).click();
    cy.wait('@decisionEnvironment');
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
    cy.intercept('GET', '/api/v2/eda/event-streams/?order_by=name&page=1&page_size=*', {
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

    mountEdaResource(eventStreamConfig);

    cy.verifyPageTitle('Event Streams');
    cy.wait('@eventStreams');
    cy.contains('button', /^Create$/).click();
    cy.contains('Resource JSON').should('not.exist');
    cy.get('#eda-event-stream-name').type('Webhook intake');
    cy.get('#eda-event-stream-credential').select('7');
    cy.get('#eda-event-stream-uuid').type('stream-uuid-1');
    cy.get('[data-cy="eda-event-stream-additional-data-headers"]').click();
    cy.get('[data-cy="eda-event-stream-additional-data-headers"] textarea')
      .first()
      .type('X-EDA-Tenant: acme', { force: true });
    cy.get('[aria-label="Toggle to JSON"]').click();
    cy.contains('"X-EDA-Tenant": "acme"').should('be.visible');
    cy.get('#eda-event-stream-test-mode').click();
    cy.contains('button', /^Create$/).click();

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
    cy.intercept('GET', '/api/v2/eda/event-streams/?order_by=name&page=1&page_size=*', {
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

    mountEdaResource(eventStreamConfig);

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
});
