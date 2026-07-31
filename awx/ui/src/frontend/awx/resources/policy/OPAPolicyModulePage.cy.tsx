import { ReactNode, useEffect } from 'react';
import { PageNavigationItem } from '../../../../framework';
import { usePageNavigationRoutesContext } from '../../../../framework/PageNavigation/PageNavigationRoutesProvider';
import { awxAPI } from '../../common/api/awx-utils';
import { AwxRoute } from '../../main/AwxRoutes';
import { OPAPolicyModuleList, OPAPolicyModulePage } from './PolicyResourcePages';

const moduleSummary = {
  id: 'capstan/job_launch',
  package: 'capstan.job_launch',
  rules: ['allow'],
  decision_paths: ['capstan/job_launch/allow'],
  size: 82,
  line_count: 7,
  sha256: 'abc123',
  awx_managed: true,
};

const moduleDetail = {
  ...moduleSummary,
  raw: 'package capstan.job_launch\n\ndefault allow := false\n',
  project_source: {
    project_id: 42,
    project_name: 'OPA Policy Repo',
    file_path: 'policies/job_launch.rego',
  },
};

const moduleVersion = {
  activity_stream_id: 1295,
  operation: 'update',
  timestamp: '2026-07-29T21:13:38Z',
  actor: { id: 1, username: 'admin' },
  before: { ...moduleSummary, sha256: 'before123' },
  after: moduleSummary,
  can_restore_before: true,
  can_restore_after: true,
};

const moduleDecision = {
  activity_stream_id: 1401,
  operation: 'evaluate',
  timestamp: '2026-07-29T22:00:00Z',
  actor: { id: 1, username: 'admin' },
  object1: 'job_template',
  object2: 'Deploy production',
  source: 'job_launch',
  summary: 'Job launch allowed by policy.',
  policy_id: moduleSummary.id,
  opa_allowed: true,
  is_denial: false,
  project_source: { file_path: 'policies/job_launch.rego' },
  error: '',
  before: null,
  after: null,
};

const moduleDenial = {
  ...moduleDecision,
  activity_stream_id: 1402,
  object2: 'Deploy restricted',
  summary: 'Job launch denied by policy.',
  opa_allowed: false,
  is_denial: true,
  error: 'Denied by OPA policy guardrail.',
};

const unrelatedDecision = {
  ...moduleDecision,
  activity_stream_id: 1403,
  policy_id: 'capstan/inventory_access',
  object2: 'Inventory access',
  summary: 'Unrelated inventory decision.',
};

const project = {
  id: 42,
  name: 'OPA Policy Repo',
  description: 'OPA modules',
  scm_type: 'git',
  type: 'project',
};

const projectFiles = {
  count: 2,
  project,
  project_source: {
    project_id: project.id,
    project_name: project.name,
  },
  results: [
    {
      file_path: 'policies/catalog_launch.rego',
      policy_id: 'awx/projects/42/policies/catalog_launch',
      policy_text: 'package capstan.catalog_launch\n\nallow := true',
      module: {
        ...moduleSummary,
        id: 'awx/projects/42/policies/catalog_launch',
        package: 'capstan.catalog_launch',
      },
    },
    {
      file_path: 'policies/job_launch.rego',
      policy_id: 'awx/projects/42/policies/job_launch',
      policy_text: moduleDetail.raw,
      module: moduleSummary,
    },
  ],
};

function interceptProjectSources() {
  cy.intercept('GET', '/api/v2/projects/?page_size=200', {
    count: 1,
    results: [project],
  }).as('getProjects');
  cy.intercept('GET', '/api/v2/opa/policy-modules/project-sync/**', projectFiles).as(
    'getProjectFiles'
  );
}

function SeedNavigation(props: { children: ReactNode }) {
  const [, setNavigation] = usePageNavigationRoutesContext();
  useEffect(() => {
    setNavigation([
      {
        id: AwxRoute.ActivityStream,
        path: 'activity-stream',
        element: <div />,
      } as PageNavigationItem,
    ]);
  }, [setNavigation]);
  return <>{props.children}</>;
}

describe('OPA policy module form', () => {
  it('shows a pinned edit action on each manageable policy module row', () => {
    cy.viewport(1440, 900);
    cy.intercept('GET', awxAPI`/opa/policy-modules/`, {
      enabled: true,
      server_url: 'http://opa:8181',
      count: 1,
      modules: [moduleSummary],
    }).as('getModules');

    cy.mount(<OPAPolicyModuleList canManagePolicy />, {
      path: '/policy-as-code/opa/modules',
      initialEntries: ['/policy-as-code/opa/modules'],
    });

    cy.wait('@getModules');
    cy.contains('tr', moduleSummary.id).within(() => {
      cy.getByDataCy('edit-policy-module')
        .should('be.visible')
        .and('have.attr', 'href')
        .and('include', '/policy-as-code/opa/modules/edit?policy=capstan%2Fjob_launch');
    });
  });

  it('creates a module with the native page form', () => {
    interceptProjectSources();
    cy.intercept('POST', awxAPI`/opa/policy-modules/project-sync/`, (request) => {
      const requestBody = request.body as Record<string, unknown>;
      expect(requestBody).to.deep.equal({
        policy_id: 'capstan/catalog_launch',
        project: 42,
        path: 'policies/catalog_launch.rego',
        mode: 'apply',
      });
      request.reply({
        changed: true,
        persisted: true,
        results: [
          {
            policy_id: 'capstan/catalog_launch',
            file_path: 'policies/catalog_launch.rego',
            changed: true,
            persisted: true,
            after: projectFiles.results[0].module,
          },
        ],
      });
    }).as('createModule');

    cy.mount(<OPAPolicyModulePage mode="create" canManagePolicy />, {
      path: '/policy-as-code/opa/modules/new',
      initialEntries: ['/policy-as-code/opa/modules/new'],
    });

    cy.verifyPageTitle('Create OPA policy module');
    cy.selectDropdownOptionByResourceName('project', project.name);
    cy.wait('@getProjectFiles');
    cy.selectDropdownOptionByResourceName('rego_file', 'policies/catalog_launch.rego');
    cy.getByDataCy('opa-policy-id').clear().type('capstan/catalog_launch');
    cy.getByDataCy('opa-policy-text')
      .should('have.value', 'package capstan.catalog_launch\n\nallow := true')
      .and('have.attr', 'readonly');
    cy.clickButton('Create policy module');
    cy.wait('@createModule');
  });

  it('loads and updates an existing module without changing its policy ID', () => {
    interceptProjectSources();
    cy.intercept('GET', awxAPI`/opa/policy-modules/${'capstan/job_launch'}/`, moduleDetail).as(
      'getModule'
    );
    cy.intercept('POST', awxAPI`/opa/policy-modules/project-sync/`, (request) => {
      const requestBody = request.body as Record<string, unknown>;
      expect(requestBody).to.deep.equal({
        policy_id: 'capstan/job_launch',
        project: 42,
        path: 'policies/job_launch.rego',
        mode: 'apply',
      });
      request.reply({
        changed: true,
        persisted: true,
        results: [
          {
            policy_id: 'capstan/job_launch',
            file_path: 'policies/job_launch.rego',
            changed: true,
            persisted: true,
            after: moduleSummary,
          },
        ],
      });
    }).as('updateModule');

    cy.mount(<OPAPolicyModulePage mode="edit" canManagePolicy />, {
      path: '/policy-as-code/opa/modules/edit',
      initialEntries: ['/policy-as-code/opa/modules/edit?policy=capstan%2Fjob_launch'],
    });

    cy.wait('@getModule');
    cy.wait('@getProjectFiles');
    cy.verifyPageTitle('Edit capstan/job_launch');
    cy.get('#project').should('contain.text', project.name);
    cy.contains('button', 'policies/job_launch.rego').should('be.visible');
    cy.getByDataCy('opa-policy-id')
      .should('have.value', 'capstan/job_launch')
      .and('have.attr', 'readonly');
    cy.getByDataCy('opa-policy-text').should('have.value', moduleDetail.raw);
    cy.clickButton('Save policy module');
    cy.wait('@updateModule');
  });

  it('renders a native tabbed detail resource with policy-scoped activity', () => {
    cy.intercept('GET', awxAPI`/opa/policy-modules/${'capstan/job_launch'}/`, moduleDetail).as(
      'getModule'
    );
    cy.intercept('GET', awxAPI`/opa/policy-modules/${'capstan/job_launch'}/versions/`, {
      policy_id: moduleSummary.id,
      count: 1,
      versions: [moduleVersion],
    }).as('getModuleVersions');
    cy.intercept('GET', awxAPI`/opa/activity/?limit=200`, {
      count: 3,
      denial_count: 1,
      decisions: [moduleDecision, moduleDenial, unrelatedDecision],
      denials: [moduleDenial],
    }).as('getActivity');

    cy.mount(
      <SeedNavigation>
        <OPAPolicyModulePage mode="detail" canManagePolicy />
      </SeedNavigation>,
      {
        path: '/policy-as-code/opa/modules/detail',
        initialEntries: ['/policy-as-code/opa/modules/detail?policy=capstan%2Fjob_launch'],
      }
    );

    cy.wait(['@getModule', '@getModuleVersions']);
    cy.verifyPageTitle(moduleSummary.id);
    cy.getByDataCy('page-details').should('be.visible');
    cy.contains('Policy ID').should('be.visible');
    cy.getByDataCy('code-block-value').should('contain.text', 'package capstan.job_launch');
    cy.getByDataCy('edit-policy-module')
      .should('be.visible')
      .and('have.attr', 'href')
      .and('include', '/policy-as-code/opa/modules/edit?policy=capstan%2Fjob_launch');

    cy.contains('[role="tab"]', 'Version History').click();
    cy.contains('[role="tab"]', 'Version History').should('have.attr', 'aria-selected', 'true');
    cy.contains('a', 'View Activity Stream #1295')
      .should('have.attr', 'href')
      .and('include', 'id=1295');

    cy.contains('[role="tab"]', 'Decisions').click();
    cy.wait('@getActivity');
    cy.contains('[role="tab"]', 'Decisions').should('have.attr', 'aria-selected', 'true');
    cy.contains('Job launch allowed by policy.').should('be.visible');
    cy.contains('Denied by OPA policy guardrail.').should('be.visible');
    cy.contains('Unrelated inventory decision.').should('not.exist');

    cy.contains('[role="tab"]', 'Violations').click();
    cy.contains('[role="tab"]', 'Violations').should('have.attr', 'aria-selected', 'true');
    cy.contains('Denied by OPA policy guardrail.').should('be.visible');
    cy.contains('Job launch allowed by policy.').should('not.exist');
    cy.contains('Unrelated inventory decision.').should('not.exist');
  });
});
