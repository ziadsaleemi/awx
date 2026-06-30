import { awxAPI } from '../../common/api/awx-utils';
import { QuayRobots } from './QuayRobots';

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

const robots = {
  count: 1,
  next: null,
  previous: null,
  source: 'quay',
  resource: 'robots',
  namespace: 'awx',
  namespace_kind: 'organization',
  controller_error: '',
  results: [
    {
      id: 1,
      _awx_key: 'awx+builder',
      name: 'awx+builder',
      shortname: 'builder',
      description: 'AWX image builder',
      repositories: [{ name: 'custom-ee' }],
      created: '2026-06-29T10:00:00Z',
    },
  ],
};

describe('QuayRobots', () => {
  it('creates, rotates, and deletes Project Quay robot accounts through AWX', () => {
    cy.viewport(1920, 1080);
    cy.intercept('GET', awxAPI`/quay/status/`, status).as('status');
    cy.intercept('GET', `${awxAPI`/quay/robots/`}*`, robots).as('robots');
    cy.intercept('POST', awxAPI`/quay/robots/create/`, {
      statusCode: 201,
      body: {
        source: 'quay',
        action: 'create_robot',
        namespace_kind: 'organization',
        namespace: 'awx',
        robot: 'deployer',
      },
    }).as('createRobot');
    cy.intercept('POST', awxAPI`/quay/robots/regenerate-token/`, {
      source: 'quay',
      action: 'regenerate_robot_token',
      namespace_kind: 'organization',
      namespace: 'awx',
      robot: 'builder',
    }).as('regenerateRobot');
    cy.intercept('POST', awxAPI`/quay/robots/delete/`, {
      source: 'quay',
      action: 'delete_robot',
      namespace_kind: 'organization',
      namespace: 'awx',
      robot: 'builder',
    }).as('deleteRobot');

    cy.mount(<QuayRobots />);
    cy.wait(['@status', '@robots']);

    cy.contains('td', 'awx+builder').should('be.visible');
    cy.contains('button', 'Create robot').click();
    cy.get('#quay-robot-shortname').type('deployer');
    cy.get('#quay-robot-description').type('AWX deployment image pusher');
    cy.get('.pf-v5-c-modal-box').within(() => {
      cy.contains('button', 'Create robot').click();
    });
    cy.wait('@createRobot').its('request.body').should('deep.equal', {
      namespace_kind: 'organization',
      namespace: 'awx',
      robot: 'deployer',
      description: 'AWX deployment image pusher',
    });

    cy.contains('button', 'Regenerate token').click();
    cy.wait('@regenerateRobot').its('request.body').should('deep.equal', {
      namespace_kind: 'organization',
      namespace: 'awx',
      robot: 'builder',
    });

    cy.contains('button', 'Delete').click();
    cy.wait('@deleteRobot').its('request.body').should('deep.equal', {
      namespace_kind: 'organization',
      namespace: 'awx',
      robot: 'builder',
    });
  });

  it('hides robot actions until a Quay API token is configured', () => {
    cy.viewport(1920, 1080);
    cy.intercept('GET', awxAPI`/quay/status/`, { ...status, management_configured: false }).as(
      'status'
    );

    cy.mount(<QuayRobots />);
    cy.wait('@status');

    cy.contains('Project Quay robot management needs an API token.').should('be.visible');
    cy.contains('button', 'Create robot').should('be.disabled');
  });
});
