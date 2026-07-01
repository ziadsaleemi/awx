import { awxAPI } from '../../common/api/awx-utils';
import { QuayApiToken } from './QuayApiToken';

const status = {
  enabled: true,
  configured: true,
  status: 'configured',
  server_url: 'https://quay.example.test',
  registry: 'quay.example.test',
  namespace: 'awx',
  auth_configured: false,
  push_configured: true,
  push_username_configured: true,
  push_token_configured: true,
  can_manage: true,
  management_configured: false,
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

const tokenPlan = {
  source: 'quay',
  configured: true,
  status: 'configured',
  server_url: 'https://quay.example.test',
  namespace: 'awx',
  auth_configured: false,
  settings_url: '/api/v2/settings/quay/',
  required_scopes: [
    'repo:read',
    'repo:create',
    'repo:write',
    'repo:admin',
    'user:admin',
    'org:admin',
  ],
  token_setting: 'QUAY_API_TOKEN',
  push_settings: ['QUAY_PUSH_USERNAME', 'QUAY_PUSH_TOKEN'],
  oauth_application: {
    name: 'AWX Project Quay Management',
    description: 'OAuth application used by AWX to manage Project Quay.',
    create_method: 'POST',
    create_url: 'https://quay.example.test/api/v1/organization/awx/applications',
    payload: {
      name: 'AWX Project Quay Management',
      description: 'AWX-managed Project Quay integration',
      application_uri: 'https://quay.example.test',
      redirect_uri: 'https://quay.example.test',
    },
  },
  app_specific_token: {
    create_method: 'POST',
    create_url: 'https://quay.example.test/api/v1/user/apptoken',
    payload: { friendlyName: 'AWX Project Quay Management' },
  },
  validation_commands: [
    {
      label: 'Validate repository read access',
      command:
        'curl -fsS -H "Authorization: Bearer $QUAY_API_TOKEN" https://quay.example.test/api/v1/repository?namespace=awx&limit=1',
    },
  ],
  notes: [
    'Store only the final token value in QUAY_API_TOKEN. AWX does not display stored secret values.',
  ],
};

describe('QuayApiToken', () => {
  it('shows required scopes, token creation references, validation commands, and settings link', () => {
    cy.viewport(1920, 1080);
    cy.intercept('GET', awxAPI`/quay/status/`, status).as('status');
    cy.intercept('GET', awxAPI`/quay/api-token-plan/`, tokenPlan).as('tokenPlan');

    cy.mount(<QuayApiToken />);
    cy.wait(['@status', '@tokenPlan']);

    cy.contains('API Token').should('be.visible');
    cy.contains('Missing').should('be.visible');
    cy.contains('repo:admin').should('be.visible');
    cy.contains('org:admin').should('be.visible');
    cy.get('input[value="https://quay.example.test/api/v1/organization/awx/applications"]').should(
      'exist'
    );
    cy.get('input[value="https://quay.example.test/api/v1/user/apptoken"]').should('exist');
    cy.get('input[value*="Authorization: Bearer $QUAY_API_TOKEN"]').should('exist');
    cy.contains('Open Project Quay settings').should('have.attr', 'href', '/settings/quay');
  });
});
