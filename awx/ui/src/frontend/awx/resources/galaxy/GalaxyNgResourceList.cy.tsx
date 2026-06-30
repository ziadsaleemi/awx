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
  settings_url: '/api/v2/settings/galaxy-ng/',
  message: 'Galaxy NG server URL is configured.',
  counts: {
    namespaces: 1,
    collections: 1,
    repositories: 1,
    remotes: 1,
    remote_registries: 1,
    signature_keys: 1,
    collection_approvals: 1,
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

  it('renders Galaxy NG remotes', () => {
    cy.viewport(1920, 1080);
    cy.intercept('GET', awxAPI`/galaxy_ng/status/`, status).as('status');
    cy.intercept('GET', `${awxAPI`/galaxy_ng/remotes/`}*`, {
      count: 1,
      next: null,
      previous: null,
      source: 'galaxy_ng',
      resource: 'remotes',
      controller_error: '',
      results: [
        {
          id: 1,
          name: 'community',
          url: 'https://galaxy.ansible.com/api/',
          policy: 'immediate',
        },
      ],
    }).as('remotes');

    cy.mount(<GalaxyNgResourceList resource="remotes" />);
    cy.wait('@status');
    cy.wait('@remotes');

    cy.get('table[aria-label="Simple table"]').should('contain', 'community');
    cy.get('table[aria-label="Simple table"]').should('contain', 'https://galaxy.ansible.com/api/');
    cy.get('table[aria-label="Simple table"]').should('contain', 'immediate');
  });

  it('renders Galaxy NG remote registries', () => {
    cy.viewport(1920, 1080);
    cy.intercept('GET', awxAPI`/galaxy_ng/status/`, status).as('status');
    cy.intercept('GET', `${awxAPI`/galaxy_ng/remote-registries/`}*`, {
      count: 1,
      next: null,
      previous: null,
      source: 'galaxy_ng',
      resource: 'remote-registries',
      controller_error: '',
      results: [
        {
          id: 1,
          name: 'quay-remote',
          url: 'https://quay.io',
          tls_validation: true,
          rate_limit: 8,
        },
      ],
    }).as('remoteRegistries');

    cy.mount(<GalaxyNgResourceList resource="remote-registries" />);
    cy.wait('@status');
    cy.wait('@remoteRegistries');

    cy.get('table[aria-label="Simple table"]').should('contain', 'quay-remote');
    cy.get('table[aria-label="Simple table"]').should('contain', 'https://quay.io');
    cy.get('table[aria-label="Simple table"]').should('contain', 'Enabled');
  });

  it('renders Galaxy NG collection approvals from staging', () => {
    cy.viewport(1920, 1080);
    cy.intercept('GET', awxAPI`/galaxy_ng/status/`, status).as('status');
    cy.intercept('GET', `${awxAPI`/galaxy_ng/collection-approvals/`}*`, {
      count: 1,
      next: null,
      previous: null,
      source: 'galaxy_ng',
      resource: 'collection-approvals',
      controller_error: '',
      results: [
        {
          id: 1,
          namespace: 'infra',
          name: 'network',
          version: '1.0.0',
          sign_state: 'unsigned',
          repository_list: ['staging'],
        },
      ],
    }).as('collectionApprovals');

    cy.mount(<GalaxyNgResourceList resource="collection-approvals" />);
    cy.wait('@status');
    cy.wait('@collectionApprovals');

    cy.get('table[aria-label="Simple table"]').should('contain', 'infra.network');
    cy.get('table[aria-label="Simple table"]').should('contain', '1.0.0');
    cy.get('table[aria-label="Simple table"]').should('contain', 'unsigned');
  });
});
