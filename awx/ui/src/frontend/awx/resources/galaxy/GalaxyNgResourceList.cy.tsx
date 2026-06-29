import { awxAPI } from '../../common/api/awx-utils';
import { GalaxyNgResourceList } from './GalaxyNgResourceList';

const status = {
  enabled: true,
  configured: true,
  status: 'configured',
  server_url: 'https://hub.example.test',
  api_root_url: 'https://hub.example.test/api/galaxy/',
  content_url: 'https://hub.example.test/pulp/content/',
  ui_url: 'https://hub.example.test/ui/',
  auth_configured: true,
  verify_ssl: false,
  request_timeout: 10,
  api_path_prefix: '/api/galaxy/',
  content_path_prefix: '/pulp/content/',
  settings_url: '/api/v2/settings/galaxy_ng/',
  message: 'Galaxy NG server URL is configured.',
  counts: {
    namespaces: 1,
    collections: 1,
    repositories: 1,
    tasks: 1,
  },
  pulp_status: {},
  controller_error: '',
};

describe('GalaxyNgResourceList', () => {
  it('renders Galaxy NG collection rows', () => {
    cy.viewport(1920, 1080);
    cy.intercept('GET', awxAPI`/galaxy_ng/status/`, status).as('status');
    cy.intercept('GET', `${awxAPI`/galaxy_ng/collections/`}*`, {
      count: 1,
      next: null,
      previous: null,
      source: 'galaxy_ng',
      resource: 'collections',
      controller_error: '',
      results: [
        {
          id: 1,
          namespace: 'infra',
          name: 'network',
          latest_version: { version: '1.2.3' },
          description: 'Network automation content',
        },
      ],
    }).as('collections');

    cy.mount(<GalaxyNgResourceList resource="collections" />);
    cy.wait('@status');
    cy.wait('@collections');

    cy.get('table[aria-label="Simple table"]').should('contain', 'infra.network');
    cy.get('table[aria-label="Simple table"]').should('contain', '1.2.3');
    cy.get('table[aria-label="Simple table"]').should('contain', 'Network automation content');
  });

  it('syncs a Galaxy NG repository from the row action', () => {
    cy.viewport(1920, 1080);
    cy.intercept('GET', awxAPI`/galaxy_ng/status/`, status).as('status');
    cy.intercept('GET', `${awxAPI`/galaxy_ng/repositories/`}*`, {
      count: 1,
      next: null,
      previous: null,
      source: 'galaxy_ng',
      resource: 'repositories',
      controller_error: '',
      results: [
        {
          id: 1,
          name: 'published',
          base_path: 'published',
          remote: 'community',
          pulp_last_updated: '2026-06-29T10:00:00Z',
        },
      ],
    }).as('repositories');
    cy.intercept('POST', awxAPI`/galaxy_ng/repositories/sync/`, {
      statusCode: 202,
      body: {
        source: 'galaxy_ng',
        repository: 'published',
        base_path: 'published',
        task: 'sync-task-1',
        response: { task: 'sync-task-1' },
      },
    }).as('syncRepository');

    cy.mount(<GalaxyNgResourceList resource="repositories" />);
    cy.wait('@status');
    cy.wait('@repositories');

    cy.get('[data-cy="actions-dropdown"]').click();
    cy.get('[data-cy="sync"]').click();
    cy.wait('@syncRepository')
      .its('request.body')
      .should('deep.equal', { repository: 'published' });
    cy.get('[data-cy="alert-toaster"]').should('contain', 'sync-task-1');
  });
});
