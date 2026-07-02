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

const projects = {
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
};

const template = {
  id: 11,
  type: 'quay_image_build_template',
  url: `${awxAPI`/quay/execution-environment-images/templates/`}11/`,
  launch_url: `${awxAPI`/quay/execution-environment-images/templates/`}11/launch/`,
  created: '2026-07-01T10:00:00Z',
  modified: '2026-07-01T10:00:00Z',
  name: 'Platform EE',
  description: 'Base execution environment for platform jobs.',
  project: {
    id: 7,
    name: 'Execution Environment Project',
    organization: { id: 1, name: 'Default' },
  },
  namespace: 'awx',
  repository: 'platform-ee',
  repository_path: 'awx/platform-ee',
  tag: 'latest',
  image: 'quay.example.test/awx/platform-ee:latest',
  runtime: 'podman',
  definition_file: 'ee/execution-environment.yml',
  context: 'ee',
  latest_build: {
    id: 41,
    url: `${awxAPI`/quay/execution-environment-images/builds/`}41/`,
    created: '2026-07-01T10:01:00Z',
    project: {
      id: 7,
      name: 'Execution Environment Project',
      path: '/var/lib/awx/projects/ee-project',
      scm_revision: 'abc123',
    },
    template: { id: 11, name: 'Platform EE' },
    namespace: 'awx',
    repository: 'platform-ee',
    repository_path: 'awx/platform-ee',
    tag: 'latest',
    image: 'quay.example.test/awx/platform-ee:latest',
    runtime: 'podman',
    definition_file: 'ee/execution-environment.yml',
    context: 'ee',
    status: 'successful',
    progress: 100,
    started: '2026-07-01T10:01:00Z',
    finished: '2026-07-01T10:04:00Z',
    error: '',
    log: 'Starting Project Quay image build quay.example.test/awx/platform-ee:latest\n$ ansible-builder build --container-runtime podman\nBuild completed successfully.\n',
  },
};

const builds = {
  count: 1,
  next: null,
  previous: null,
  source: 'quay',
  resource: 'image_builds',
  results: [template.latest_build],
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
      name: 'latest',
      manifest_digest: 'sha256:abc',
      size: 42,
      last_modified: '2026-06-29T10:00:00Z',
    },
  ],
};

describe('QuayExecutionEnvironmentImages', () => {
  it('saves and launches reusable EE build templates', () => {
    cy.viewport(1280, 800);
    cy.intercept('GET', awxAPI`/quay/status/`, status).as('status');
    cy.intercept('GET', `${awxAPI`/projects/`}*`, projects).as('projects');
    cy.intercept('GET', `${awxAPI`/quay/execution-environment-images/templates/`}*`, {
      count: 1,
      next: null,
      previous: null,
      source: 'quay',
      resource: 'image_build_templates',
      results: [template],
    }).as('templates');
    cy.intercept(
      {
        method: 'GET',
        pathname: awxAPI`/quay/execution-environment-images/builds/`,
      },
      builds
    ).as('builds');
    cy.intercept('GET', `${awxAPI`/quay/execution-environment-images/builds/`}41/`, {
      statusCode: 200,
      body: {
        ...template.latest_build,
      },
    }).as('build41');
    cy.intercept('GET', `${awxAPI`/quay/execution-environment-images/builds/`}42/`, {
      statusCode: 200,
      body: {
        ...template.latest_build,
        id: 42,
        status: 'running',
        progress: 55,
        log: 'Starting Project Quay image build quay.example.test/awx/platform-ee:latest\n$ ansible-builder build --container-runtime podman -f ee/execution-environment.yml\n',
      },
    }).as('build42');
    cy.intercept('GET', `${awxAPI`/quay/tags/`}*`, tags).as('tags');
    cy.intercept('POST', awxAPI`/quay/execution-environment-images/templates/`, {
      statusCode: 201,
      body: {
        ...template,
        id: 12,
        name: 'Custom EE',
        repository: 'custom-ee',
        image: 'quay.example.test/awx/custom-ee:v1',
        tag: 'v1',
      },
    }).as('saveTemplate');
    cy.intercept('PATCH', `${awxAPI`/quay/execution-environment-images/templates/`}11/`, {
      statusCode: 200,
      body: {
        ...template,
        tag: 'v2',
        image: 'quay.example.test/awx/platform-ee:v2',
      },
    }).as('updateTemplate');
    cy.intercept('POST', template.launch_url, {
      statusCode: 202,
      body: {
        ...template.latest_build,
        id: 42,
        status: 'pending',
        progress: 0,
        log: '',
      },
    }).as('launchTemplate');
    cy.intercept('DELETE', template.url, { statusCode: 204, body: '' }).as('deleteTemplate');
    cy.intercept('POST', awxAPI`/quay/tags/delete/`, {
      source: 'quay',
      action: 'delete_tag',
      namespace: 'awx',
      repository: 'custom-ee',
      tag: 'latest',
    }).as('deleteTag');

    cy.mount(<QuayExecutionEnvironmentImages />);
    cy.wait(['@status', '@projects', '@templates', '@builds']);

    cy.contains('[data-cy="page-title"]', 'EE Build Templates').should('be.visible');
    cy.contains('button', 'Create template').should('be.visible');
    cy.contains('Platform EE').should('be.visible').click();
    cy.wait('@tags');

    cy.contains('[data-cy="page-title"]', 'Platform EE').should('be.visible');
    cy.contains('Back to Templates').should('be.visible');
    cy.contains('Details').should('be.visible');
    cy.contains('Team Access').should('be.visible');
    cy.contains('User Access').should('be.visible');
    cy.contains('Schedules').should('be.visible');
    cy.contains('Jobs').should('be.visible');
    cy.contains('Notifications').should('be.visible');
    cy.contains('Tags').should('be.visible');
    cy.contains('Default').should('be.visible');
    cy.contains('Execution Environment Project').should('be.visible');
    cy.get('input[value="quay.example.test/awx/platform-ee:latest"]').should('exist');

    cy.contains('Team Access').click();
    cy.contains('Team Access requires native AWX template integration.').should('be.visible');
    cy.contains('Jobs').click();

    cy.contains('Edit template').click();
    cy.get('#quay-ee-image-tag').clear().type('v2');
    cy.contains('button', 'Save template').click();
    cy.wait('@updateTemplate').its('request.body').should('include', {
      name: 'Platform EE',
      repository: 'platform-ee',
      tag: 'v2',
    });

    cy.contains('button', 'Launch template').click();
    cy.wait('@launchTemplate');
    cy.wait('@build42');
    cy.contains('Selected build').should('be.visible');
    cy.contains('#42').should('be.visible');
    cy.contains('Build output').should('be.visible');
    cy.contains('$ ansible-builder build --container-runtime podman').should('be.visible');

    cy.contains('Tags').click();
    cy.contains('button', 'Delete tag').click();
    cy.wait('@deleteTag').its('request.body').should('deep.equal', {
      namespace: 'awx',
      repository: 'platform-ee',
      tag: 'latest',
    });

    cy.contains('Back to Templates').click();
    cy.contains('[data-cy="page-title"]', 'EE Build Templates').should('be.visible');
    cy.contains('button', 'Create template').click();
    cy.contains('[data-cy="page-title"]', 'Create EE build template').should('be.visible');
    cy.get('#quay-ee-template-name').type('Custom EE');
    cy.get('#quay-ee-repository').clear().type('custom-ee');
    cy.get('#quay-ee-image-tag').clear().type('v1');
    cy.get('#quay-ee-definition-file').clear().type('ee/execution-environment.yml');
    cy.get('#quay-ee-context').clear().type('ee');
    cy.contains('button', 'Create template').click();
    cy.wait('@saveTemplate').its('request.body').should('deep.equal', {
      name: 'Custom EE',
      description: '',
      project_id: 7,
      namespace: 'awx',
      repository: 'custom-ee',
      tag: 'v1',
      runtime: 'podman',
      definition_file: 'ee/execution-environment.yml',
      context: 'ee',
    });
  });
});
