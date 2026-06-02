import { ReactNode, useEffect } from 'react';
import { PageNavigationItem } from '../../../../framework';
import { usePageNavigationRoutesContext } from '../../../../framework/PageNavigation/PageNavigationRoutesProvider';
import { awxAPI } from '../../common/api/awx-utils';
import { AwxRoute } from '../../main/AwxRoutes';
import { OPAPolicyManagementPanel } from './OPAPolicyManagementPanel';

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

const moduleSummary = {
  id: 'awx/managed',
  package: 'awx.job_launch',
  rules: ['allow'],
  decision_paths: ['awx/job_launch/allow'],
  size: 42,
  line_count: 4,
  sha256: 'abc123',
  awx_managed: true,
};

const moduleDetail = {
  ...moduleSummary,
  raw: 'package awx.job_launch\n\nallow := true\n',
};

describe('OPAPolicyManagementPanel', () => {
  it('links OPA policy module actions and versions to Activity Stream', () => {
    cy.intercept('GET', awxAPI`/opa/policies/`, {
      enabled: true,
      server_url: 'http://opa:8181',
      policies: [],
      policy_bundle: { configured: true, size: 42, line_count: 4 },
    });
    cy.intercept('GET', awxAPI`/opa/policy-modules/`, {
      enabled: true,
      server_url: 'http://opa:8181',
      count: 1,
      modules: [moduleSummary],
    }).as('modules');
    cy.intercept('GET', awxAPI`/opa/policy-modules/${'awx/managed'}/`, moduleDetail).as(
      'moduleDetail'
    );
    cy.intercept('GET', awxAPI`/opa/policy-modules/${'awx/managed'}/versions/`, {
      policy_id: 'awx/managed',
      count: 1,
      versions: [
        {
          activity_stream_id: 77,
          operation: 'update',
          timestamp: '2026-06-02T00:00:00Z',
          actor: { id: 1, username: 'admin' },
          before: { ...moduleSummary, sha256: 'before123' },
          after: { ...moduleSummary, sha256: 'after123' },
          can_restore_before: true,
          can_restore_after: true,
        },
      ],
    }).as('versions');
    cy.intercept('POST', awxAPI`/opa/policy-modules/`, {
      changed: true,
      created: false,
      module: moduleDetail,
      previous_sha256: 'before123',
      opa_response: {},
      audit: {
        activity_stream_id: 88,
        activity_stream_url: '/api/v2/activity_stream/88/',
      },
    }).as('saveModule');

    cy.mount(
      <SeedNavigation>
        <OPAPolicyManagementPanel sections={['modules']} />
      </SeedNavigation>
    );

    cy.wait(['@modules', '@moduleDetail', '@versions']);
    cy.getByDataCy('opa-module-selected-version-audit-link')
      .should('be.visible')
      .and('have.attr', 'href', '/activity-stream?id=77');

    cy.contains('button', 'Save to OPA').click();
    cy.wait('@saveModule');
    cy.getByDataCy('opa-module-action-audit-link')
      .should('be.visible')
      .and('have.attr', 'href', '/activity-stream?id=88');
  });
});
