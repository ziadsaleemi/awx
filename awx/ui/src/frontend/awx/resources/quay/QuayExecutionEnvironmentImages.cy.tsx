import { awxAPI } from '../../common/api/awx-utils';
import { QuayExecutionEnvironmentImages } from './QuayExecutionEnvironmentImages';

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
  verify_ssl: false,
  request_timeout: 10,
  settings_url: '/api/v2/settings/quay/',
  message: 'Project Quay registry URL is configured.',
  counts: {
    repositories: 1,
    tags: 1,
  },
  controller_error: '',
};

describe('QuayExecutionEnvironmentImages', () => {
  it('renders hosted image tags and generates build commands', () => {
    cy.viewport(1920, 1080);
    cy.intercept('GET', awxAPI`/quay/status/`, status).as('status');
    cy.intercept('GET', `${awxAPI`/projects/`}*`, {
      count: 1,
      next: null,
      previous: null,
      results: [
        {
          id: 7,
          name: 'Execution Environment Project',
          local_path: 'ee-project',
          scm_type: 'git',
          scm_url: 'https://git.example.test/ee.git',
          scm_branch: 'main',
          status: 'successful',
        },
      ],
    }).as('projects');
    cy.intercept('GET', `${awxAPI`/quay/tags/`}*`, {
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
          name: 'latest',
          manifest_digest: 'sha256:abc',
          size: 42,
          last_modified: '2026-06-29T10:00:00Z',
        },
      ],
    }).as('images');
    cy.intercept('POST', awxAPI`/quay/execution-environment-images/build-plan/`, {
      statusCode: 200,
      body: {
        source: 'quay',
        project: {
          project_id: 7,
          project_name: 'Execution Environment Project',
          scm_type: 'git',
          scm_url: 'https://git.example.test/ee.git',
          scm_branch: 'main',
          scm_revision: 'abc123',
          local_path: 'ee-project',
          project_path: '/var/lib/awx/projects/ee-project',
          definition_file: 'ee/execution-environment.yml',
          context: 'ee',
        },
        registry: {
          registry: 'quay.example.test',
          namespace: 'awx',
          server_url: 'https://quay.example.test',
          insecure: false,
          api_token_configured: true,
          push_username_configured: true,
          push_token_configured: true,
        },
        image: {
          repository: 'custom-ee',
          tag: 'v1',
          repository_path: 'awx/custom-ee',
          push: 'quay.example.test/awx/custom-ee:v1',
          awx: 'quay.example.test/awx/custom-ee:v1',
        },
        commands: [
          {
            label: 'Build execution environment',
            command:
              'cd /var/lib/awx/projects/ee-project && ansible-builder build --container-runtime podman -f ee/execution-environment.yml -t quay.example.test/awx/custom-ee:v1 ee',
            working_directory: '/var/lib/awx/projects/ee-project',
          },
          {
            label: 'Log in to Project Quay',
            command:
              'echo "$QUAY_TOKEN" | podman login quay.example.test --username awx+robot --password-stdin',
          },
          {
            label: 'Push to Project Quay',
            command: 'podman push quay.example.test/awx/custom-ee:v1',
          },
        ],
        awx_execution_environment: {
          image: 'quay.example.test/awx/custom-ee:v1',
          pull: 'missing',
        },
        notes: ['Use the AWX image value when creating or updating an AWX execution environment.'],
      },
    }).as('buildPlan');

    cy.mount(<QuayExecutionEnvironmentImages />);
    cy.wait('@status');
    cy.wait('@projects');
    cy.wait('@images');

    cy.contains('td', 'latest').should('exist');
    cy.get('#quay-ee-project').then(($select) => {
      const select = $select[0] as HTMLSelectElement;
      select.value = '7';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    cy.get('#quay-ee-image-name').clear().type('custom-ee');
    cy.get('#quay-ee-image-tag').clear().type('v1');
    cy.get('#quay-ee-definition-file').clear().type('ee/execution-environment.yml');
    cy.get('#quay-ee-context').clear().type('ee');
    cy.contains('button', 'Generate commands').click();

    cy.wait('@buildPlan').its('request.body').should('deep.equal', {
      project_id: 7,
      namespace: 'awx',
      image_name: 'custom-ee',
      tag: 'v1',
      runtime: 'podman',
      definition_file: 'ee/execution-environment.yml',
      context: 'ee',
    });
    cy.get('input[value="quay.example.test/awx/custom-ee:v1"]').should('exist');
    cy.get('input[value*="cd /var/lib/awx/projects/ee-project && ansible-builder build"]').should(
      'exist'
    );
    cy.contains('Source project').should('be.visible');
    cy.contains('dd', 'Execution Environment Project').should('be.visible');
    cy.get('input[value="podman push quay.example.test/awx/custom-ee:v1"]').should('exist');
  });
});
