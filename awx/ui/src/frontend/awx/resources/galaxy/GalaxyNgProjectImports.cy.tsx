import { awxAPI } from '../../common/api/awx-utils';
import { GalaxyNgProjectImports } from './GalaxyNgProjectImports';

const status = {
  enabled: true,
  configured: true,
  status: 'configured',
  server_url: 'https://hub.example.test',
  api_root_url: 'https://hub.example.test/api/galaxy/',
  api_browser_url: 'https://hub.example.test/api/galaxy/v3/swagger-ui/',
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

describe('GalaxyNgProjectImports', () => {
  it('generates collection build and publish commands from a Capstan Project', () => {
    cy.viewport(1920, 1080);
    cy.intercept('GET', awxAPI`/galaxy_ng/status/`, status).as('status');
    cy.intercept('GET', `${awxAPI`/projects/`}*`, {
      count: 1,
      next: null,
      previous: null,
      results: [
        {
          id: 7,
          name: 'Collection Project',
          local_path: 'collection-project',
          scm_type: 'git',
          scm_url: 'https://git.example.test/collections.git',
          scm_branch: 'main',
          status: 'successful',
        },
      ],
    }).as('projects');
    cy.intercept('POST', awxAPI`/galaxy_ng/collection-imports/build-plan/`, {
      statusCode: 200,
      body: {
        source: 'galaxy_ng',
        project: {
          project_id: 7,
          project_name: 'Collection Project',
          scm_type: 'git',
          scm_url: 'https://git.example.test/collections.git',
          scm_branch: 'main',
          scm_revision: 'abc123',
          local_path: 'collection-project',
          project_path: '/var/lib/awx/projects/collection-project',
          collection_path: 'collections/infra/network',
          collection_root: '/var/lib/awx/projects/collection-project/collections/infra/network',
          galaxy_yml:
            '/var/lib/awx/projects/collection-project/collections/infra/network/galaxy.yml',
          artifact_dir: 'dist',
          artifact_path:
            '/var/lib/awx/projects/collection-project/collections/infra/network/dist/infra-network-1.2.3.tar.gz',
          metadata: {
            namespace: 'infra',
            name: 'network',
            version: '1.2.3',
            description: 'Network automation content',
          },
        },
        hub: {
          server_url: 'https://hub.example.test',
          api_root_url: 'https://hub.example.test/api/galaxy/',
          verify_ssl: false,
          auth_configured: true,
        },
        collection: {
          namespace: 'infra',
          name: 'network',
          version: '1.2.3',
          fqcn: 'infra.network',
          reference: 'infra.network:1.2.3',
          artifact:
            '/var/lib/awx/projects/collection-project/collections/infra/network/dist/infra-network-1.2.3.tar.gz',
        },
        commands: [
          {
            label: 'Build collection artifact',
            command:
              'cd /var/lib/awx/projects/collection-project/collections/infra/network && ansible-galaxy collection build --output-path dist',
            working_directory: '/var/lib/awx/projects/collection-project/collections/infra/network',
          },
          {
            label: 'Publish collection to Galaxy NG',
            command:
              'ansible-galaxy collection publish /var/lib/awx/projects/collection-project/collections/infra/network/dist/infra-network-1.2.3.tar.gz --server https://hub.example.test/api/galaxy/ --api-key "$GALAXY_TOKEN" --ignore-certs',
          },
          {
            label: 'Install from Galaxy NG',
            command:
              'ansible-galaxy collection install infra.network:1.2.3 --server https://hub.example.test/api/galaxy/ --ignore-certs',
          },
        ],
        approval: {
          required: 'depends_on_galaxy_ng_settings',
          next_url: '/galaxy-ng/collection-approvals',
          message:
            'If Galaxy NG requires content approval, the uploaded collection will appear in Collection Approvals before it is published.',
        },
        notes: [
          'Set GALAXY_TOKEN to a Galaxy NG token before running the generated publish command.',
        ],
      },
    }).as('buildPlan');

    cy.mount(<GalaxyNgProjectImports />);
    cy.wait('@status');
    cy.wait('@projects');

    cy.get('#galaxy-ng-import-project').then(($select) => {
      const select = $select[0] as HTMLSelectElement;
      select.value = '7';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    cy.get('#galaxy-ng-import-collection-path').clear().type('collections/infra/network');
    cy.get('#galaxy-ng-import-artifact-dir').clear().type('dist');
    cy.contains('button', 'Generate commands').click();

    cy.wait('@buildPlan').its('request.body').should('deep.equal', {
      project_id: 7,
      collection_path: 'collections/infra/network',
      artifact_dir: 'dist',
    });
    cy.contains('Collection artifact').should('be.visible');
    cy.contains('dd', 'Collection Project').should('be.visible');
    cy.get('input[value*="ansible-galaxy collection build"]').should('exist');
    cy.get('input[value*="ansible-galaxy collection publish"]').should('exist');
    cy.get('input[value*="ansible-galaxy collection install infra.network:1.2.3"]').should('exist');
    cy.get('input[value*="infra-network-1.2.3.tar.gz"]').should('exist');
  });
});
