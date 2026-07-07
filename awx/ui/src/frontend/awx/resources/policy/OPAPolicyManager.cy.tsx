import { ReactNode, useEffect } from 'react';
import { PageNavigationItem } from '../../../../framework';
import { usePageNavigationRoutesContext } from '../../../../framework/PageNavigation/PageNavigationRoutesProvider';
import { awxAPI } from '../../common/api/awx-utils';
import { AwxRoute } from '../../main/AwxRoutes';
import { OPAPolicyManager } from './OPAPolicyManager';
import type { OPAPolicyManagerView } from './OPAPolicyManager';

const opaStatus = {
  enabled: true,
  server_url: 'http://opa.example.test:8181',
  policies: [
    { id: 'job_launch', path: 'awx/job_launch/allow', description: 'Controls launches' },
    { id: 'ai_action', path: 'awx/ai_action/allow', description: 'Controls AI actions' },
  ],
  policy_bundle: {
    configured: true,
    size: 64,
    line_count: 4,
    sha256: 'abc123',
  },
};

const opaModules = {
  enabled: true,
  server_url: 'http://opa.example.test:8181',
  count: 1,
  modules: [
    {
      id: 'awx/project-sync/opa/job_launch',
      package: 'awx.project',
      rules: ['allow'],
      decision_paths: ['awx/project/allow'],
      size: 58,
      line_count: 3,
      sha256: 'module123',
      awx_managed: true,
    },
  ],
};

const opaActivity = {
  count: 2,
  denial_count: 1,
  decisions: [
    {
      activity_stream_id: 10,
      operation: 'update',
      timestamp: '2026-06-01T12:00:00Z',
      actor: { id: 1, username: 'admin' },
      object1: 'gatekeeper_resource',
      object2: 'namespace/default',
      source: 'gatekeeper_apply',
      summary: 'Denied by OPA policy guardrail.',
      policy_id: 'awx/gatekeeper_resource/allow',
      opa_allowed: false,
      allowed: false,
      is_denial: true,
      error: 'Denied by OPA policy guardrail.',
    },
    {
      activity_stream_id: 11,
      operation: 'update',
      timestamp: '2026-06-01T12:01:00Z',
      actor: { id: 1, username: 'admin' },
      object1: 'opa_policy_module',
      object2: 'awx/project-sync/opa/job_launch',
      source: 'opa_project_sync',
      summary: 'opa_project_sync',
      policy_id: 'awx/project-sync/opa/job_launch',
      opa_allowed: true,
      is_denial: false,
    },
  ],
  denials: [
    {
      activity_stream_id: 10,
      operation: 'update',
      timestamp: '2026-06-01T12:00:00Z',
      actor: { id: 1, username: 'admin' },
      object1: 'gatekeeper_resource',
      object2: 'namespace/default',
      source: 'gatekeeper_apply',
      summary: 'Denied by OPA policy guardrail.',
      policy_id: 'awx/gatekeeper_resource/allow',
      opa_allowed: false,
      allowed: false,
      is_denial: true,
      error: 'Denied by OPA policy guardrail.',
    },
  ],
};

const projects = {
  count: 1,
  results: [
    {
      id: 42,
      name: 'OPA Policy Repo',
      scm_type: 'git',
      scm_url: 'https://git.example.test/opa.git',
      scm_branch: 'main',
      scm_revision: 'abcdef',
      status: 'successful',
    },
  ],
};

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

function mountOPA(view: OPAPolicyManagerView) {
  cy.intercept('GET', awxAPI`/opa/policies/`, opaStatus).as('opaStatus');
  cy.intercept('GET', awxAPI`/opa/policy-modules/`, opaModules).as('opaModules');
  cy.intercept('GET', '/api/v2/opa/activity/**', opaActivity).as('opaActivity');
  cy.intercept('GET', '/api/v2/projects/**', projects).as('projects');
  cy.mount(
    <SeedNavigation>
      <OPAPolicyManager view={view} canManagePolicy />
    </SeedNavigation>
  );
}

describe('OPAPolicyManager', () => {
  it('summarizes OPA status, live modules, and denials', () => {
    cy.viewport(1920, 1100);
    mountOPA('overview');
    cy.wait(['@opaStatus', '@opaModules', '@opaActivity']);

    cy.get('[data-cy="opa-control-plane"]').should('contain', 'OPA control plane');
    cy.get('[data-cy="opa-overview"]').should('contain', 'Decision paths');
    cy.get('[data-cy="opa-overview"]').should('contain', 'Live modules');
    cy.get('[data-cy="opa-overview"]').should('contain', 'Managed bundle');
    cy.get('[data-cy="opa-status"]').should('contain', 'OPA status');
    cy.get('[data-cy="opa-decision-coverage"]').should('contain', 'Decision coverage');
    cy.get('[data-cy="opa-workflows"]').should('contain', 'Project Sync');
    cy.get('[data-cy="opa-recent-evidence"]').should('contain', 'awx/gatekeeper_resource/allow');
  });

  it('shows OPA violations from denied decisions', () => {
    mountOPA('violations');
    cy.wait('@opaActivity');

    cy.get('[data-cy="opa-violations"]').should('contain', 'OPA violations');
    cy.get('[data-cy="opa-violations"]').should('contain', 'Denied');
    cy.get('[data-cy="opa-violations"]').should('contain', 'awx/gatekeeper_resource/allow');
  });

  it('syncs Rego modules from an AWX Project checkout', () => {
    cy.intercept('POST', awxAPI`/opa/policy-modules/project-sync/`, (req) => {
      expect(req.body).to.deep.equal({
        project: 42,
        path: 'opa/**/*.rego',
        policy_id_prefix: 'awx/project-sync',
        mode: 'dry_run',
      });
      req.reply({
        changed: false,
        persisted: false,
        dry_run: true,
        mode: 'dry_run',
        policy_id_prefix: 'awx/project-sync',
        project: projects.results[0],
        counts: { files: 1, modules: 1, created: 1, updated: 0, unchanged: 0 },
        results: [
          {
            file_path: 'opa/job_launch.rego',
            policy_id: 'awx/project-sync/opa/job_launch',
            mode: 'dry_run',
            operation: 'create',
            changed: false,
            persisted: false,
            before_exists: false,
            after: opaModules.modules[0],
            audit: { activity_stream_id: 22 },
          },
        ],
      });
    }).as('projectSync');
    mountOPA('project-sync');
    cy.wait('@projects');

    cy.getByDataCy('opa-project-sync-project').select('42');
    cy.getByDataCy('opa-project-sync-prefix').clear().type('awx/project-sync');
    cy.getByDataCy('opa-project-sync-mode').select('dry_run');
    cy.getByDataCy('opa-project-sync-button').click();
    cy.wait('@projectSync');

    cy.get('[data-cy="opa-project-sync"]').should('contain', 'opa/job_launch.rego');
    cy.get('[data-cy="opa-project-sync"]').should('contain', 'awx/project-sync/opa/job_launch');
  });
});
