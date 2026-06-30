import { awxAPI } from '../../common/api/awx-utils';
import { QuayRepositoryPermissions } from './QuayRepositoryPermissions';

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

describe('QuayRepositoryPermissions', () => {
  it('sets and removes Project Quay repository permissions through AWX', () => {
    cy.viewport(1920, 1080);
    cy.intercept('GET', awxAPI`/quay/status/`, status).as('status');
    cy.intercept('GET', `${awxAPI`/quay/repositories/`}*`, repositories).as('repositories');
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

    cy.mount(<QuayRepositoryPermissions />);
    cy.wait(['@status', '@repositories']);

    cy.get('select[aria-label="Repository"]').then(($select) => {
      const select = $select[0] as HTMLSelectElement;
      select.value = 'custom-ee';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
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
  });

  it('hides permission actions until a Quay API token is configured', () => {
    cy.viewport(1920, 1080);
    cy.intercept('GET', awxAPI`/quay/status/`, { ...status, management_configured: false }).as(
      'status'
    );

    cy.mount(<QuayRepositoryPermissions />);
    cy.wait('@status');

    cy.contains('Project Quay permission management needs an API token.').should('be.visible');
    cy.contains('button', 'Save permission').should('be.disabled');
  });
});
