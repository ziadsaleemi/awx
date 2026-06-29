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
});
