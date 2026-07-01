import { awxAPI } from '../../common/api/awx-utils';
import { QuayRepositories, QuayRepositoryDetails } from './QuayRepositories';

const status = {
  enabled: true,
  configured: true,
  status: 'configured',
  server_url: 'https://quay.example.test',
  registry: 'quay.example.test',
  namespace: 'awx',
  auth_configured: true,
  push_configured: true,
  push_username_configured: true,
  push_token_configured: true,
  can_manage: true,
  management_configured: true,
  management_required_scopes: [
    'repo:read',
    'repo:create',
    'repo:write',
    'repo:admin',
    'user:admin',
    'org:admin',
  ],
  verify_ssl: true,
  request_timeout: 10,
  settings_url: '/api/v2/settings/quay/',
  message: 'Project Quay registry URL is configured.',
  counts: {
    repositories: 1,
    tags: 0,
  },
  controller_error: '',
};

const repositories = {
  count: 1,
  next: null,
  previous: null,
  source: 'quay',
  resource: 'repositories',
  namespace: 'awx',
  controller_error: '',
  results: [
    {
      id: 1,
      _awx_key: 'awx/custom-ee',
      name: 'custom-ee',
      namespace: 'awx',
      description: 'Custom AWX execution environment',
      is_public: false,
      last_modified: '2026-06-29T10:00:00Z',
    },
  ],
};

const tags = {
  count: 1,
  next: null,
  previous: null,
  source: 'quay',
  resource: 'tags',
  namespace: 'awx',
  repository: 'custom-ee',
  controller_error: '',
  results: [
    {
      id: 1,
      _awx_key: 'latest',
      name: 'latest',
      manifest_digest: 'sha256:abc123',
      size: 817,
      last_modified: '2026-06-30T15:48:00Z',
    },
  ],
};

const permissions = {
  source: 'quay',
  resource: 'repository_permissions',
  namespace: 'awx',
  repository: 'custom-ee',
  users: [{ id: 1, _awx_key: 'awx+builder', username: 'awx+builder', role: 'write' }],
  teams: [{ id: 1, _awx_key: 'platform-team', teamname: 'platform-team', role: 'read' }],
  count: 2,
  controller_error: '',
};

describe('QuayRepositories', () => {
  it('shows the repository list without embedding repository details', () => {
    cy.viewport(1280, 800);
    cy.intercept('GET', awxAPI`/quay/status/`, status).as('status');
    cy.intercept('GET', `${awxAPI`/quay/repositories/`}*`, repositories).as('repositories');
    cy.intercept('POST', awxAPI`/quay/repositories/create/`, {
      statusCode: 201,
      body: {
        source: 'quay',
        action: 'create',
        namespace: 'awx',
        repository: 'new-ee',
        repository_path: 'awx/new-ee',
        response: {},
      },
    }).as('createRepository');

    cy.mount(<QuayRepositories />);
    cy.wait(['@status', '@repositories']);

    cy.contains('custom-ee').should('be.visible');
    cy.contains('a', 'custom-ee')
      .should('have.attr', 'href')
      .and('include', '/quay/repositories/awx/custom-ee');
    cy.contains('Pull commands').should('not.exist');
    cy.contains('button', 'Tags').should('not.exist');

    cy.contains('button', 'Create repository').click();
    cy.get('#quay-repository-name').type('new-ee');
    cy.get('#quay-repository-description').type('New EE image repository');
    cy.get('.pf-v5-c-modal-box').within(() => {
      cy.contains('button', 'Create repository').click();
    });
    cy.wait('@createRepository').its('request.body').should('deep.equal', {
      repository: 'new-ee',
      namespace: 'awx',
      description: 'New EE image repository',
      visibility: 'private',
    });
  });

  it('shows repository console content on the details route', () => {
    cy.viewport(1280, 800);
    cy.intercept('GET', awxAPI`/quay/status/`, status).as('status');
    cy.intercept('GET', `${awxAPI`/quay/repositories/`}*`, repositories).as('repositories');
    cy.intercept('GET', `${awxAPI`/quay/tags/`}*`, tags).as('tags');
    cy.intercept('GET', `${awxAPI`/quay/repositories/permissions/`}*`, permissions).as(
      'permissions'
    );
    cy.intercept('POST', awxAPI`/quay/repositories/permissions/user/set/`, {
      source: 'quay',
      action: 'set_user_permission',
      namespace: 'awx',
      repository: 'custom-ee',
      username: 'awx+deployer',
      role: 'write',
    }).as('setUserPermission');
    cy.intercept('POST', awxAPI`/quay/repositories/permissions/team/delete/`, {
      source: 'quay',
      action: 'delete_team_permission',
      namespace: 'awx',
      repository: 'custom-ee',
      teamname: 'platform-team',
    }).as('deleteTeamPermission');

    cy.mount(<QuayRepositoryDetails />, {
      path: '/quay/repositories/:namespace/:repository',
      initialEntries: ['/quay/repositories/awx/custom-ee'],
    });
    cy.wait(['@status', '@repositories']);
    cy.wait('@tags');

    cy.contains('awx/custom-ee').should('be.visible');
    cy.contains('Back to Repositories').should('be.visible');
    cy.contains('button', 'Details').should('be.visible');
    cy.contains('Project Quay repository details, tags, activity, and settings.').should(
      'not.exist'
    );
    cy.contains('Name').should('be.visible');
    cy.contains('custom-ee').should('be.visible');
    cy.contains('Podman pull command').should('be.visible');
    cy.contains('podman pull quay.example.test/awx/custom-ee:latest').should('be.visible');
    cy.contains('Docker pull command').should('be.visible');
    cy.contains('docker pull quay.example.test/awx/custom-ee:latest').should('be.visible');
    cy.contains('button', 'Tags').click();
    cy.contains('sha256:abc123').should('be.visible');
    cy.contains('button', 'Activity').click();
    cy.contains('Usage logs need Quay event data').should('be.visible');
    cy.contains('button', 'Permissions').click();
    cy.wait('@permissions');
    cy.contains('td', 'awx+builder').should('be.visible');
    cy.contains('td', 'platform-team').should('be.visible');
    cy.get('#quay-permission-principal').type('awx+deployer');
    cy.get('#quay-permission-role').then(($select) => {
      const select = $select[0] as HTMLSelectElement;
      select.value = 'write';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    cy.contains('button', 'Save permission').click();
    cy.wait('@setUserPermission').its('request.body').should('deep.equal', {
      namespace: 'awx',
      repository: 'custom-ee',
      role: 'write',
      username: 'awx+deployer',
    });
    cy.contains('tr', 'platform-team').within(() => {
      cy.contains('button', 'Remove').click();
    });
    cy.wait('@deleteTeamPermission').its('request.body').should('deep.equal', {
      namespace: 'awx',
      repository: 'custom-ee',
      teamname: 'platform-team',
    });
    cy.contains('button', 'Settings').click();
    cy.contains('Repository visibility').should('be.visible');
    cy.contains('Delete repository').should('be.visible');
    cy.contains('Manage repository permissions').should('not.exist');
  });

  it('shows repository permission guidance until a Quay API token is configured', () => {
    cy.viewport(1280, 800);
    cy.intercept('GET', awxAPI`/quay/status/`, { ...status, management_configured: false }).as(
      'status'
    );
    cy.intercept('GET', `${awxAPI`/quay/repositories/`}*`, repositories).as('repositories');
    cy.intercept('GET', `${awxAPI`/quay/tags/`}*`, tags).as('tags');

    cy.mount(<QuayRepositoryDetails />, {
      path: '/quay/repositories/:namespace/:repository',
      initialEntries: ['/quay/repositories/awx/custom-ee'],
    });
    cy.wait(['@status', '@repositories']);
    cy.contains('button', 'Permissions').click();
    cy.contains('Project Quay permission management needs an API token.').should('be.visible');
    cy.contains('button', 'Save permission').should('not.exist');
  });

  it('keeps repository management controls hidden for read-only users', () => {
    cy.viewport(1280, 800);
    cy.intercept('GET', awxAPI`/quay/status/`, { ...status, can_manage: false }).as('status');
    cy.intercept('GET', `${awxAPI`/quay/repositories/`}*`, repositories).as('repositories');
    cy.intercept('GET', `${awxAPI`/quay/tags/`}*`, tags).as('tags');

    cy.mount(<QuayRepositories />);
    cy.wait(['@status', '@repositories']);

    cy.contains('Read-only Project Quay access').should('be.visible');
    cy.contains('button', 'Create repository').should('not.exist');
    cy.contains('button', 'Delete repository').should('not.exist');
  });

  it('keeps repository management controls hidden until Quay API token is configured', () => {
    cy.viewport(1280, 800);
    cy.intercept('GET', awxAPI`/quay/status/`, { ...status, management_configured: false }).as(
      'status'
    );
    cy.intercept('GET', `${awxAPI`/quay/repositories/`}*`, repositories).as('repositories');
    cy.intercept('GET', `${awxAPI`/quay/tags/`}*`, tags).as('tags');

    cy.mount(<QuayRepositories />);
    cy.wait(['@status', '@repositories']);

    cy.contains('Project Quay repository management needs an API token.').should('be.visible');
    cy.contains('button', 'Create repository').should('not.exist');
    cy.contains('button', 'Delete repository').should('not.exist');
  });
});
