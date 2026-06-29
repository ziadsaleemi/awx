import { ReactNode, useEffect } from 'react';
import { PageNavigationItem } from '../../../../framework';
import { usePageNavigationRoutesContext } from '../../../../framework/PageNavigation/PageNavigationRoutesProvider';
import { awxAPI } from '../../common/api/awx-utils';
import { AwxRoute } from '../../main/AwxRoutes';
import { GalaxyNgOverview } from './GalaxyNgOverview';

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
    namespaces: 2,
    collections: 12,
    repositories: 3,
    tasks: 4,
  },
  pulp_status: {
    database_connection: { connected: true },
  },
  controller_error: '',
};

function SeedNavigation(props: { children: ReactNode }) {
  const [, setNavigation] = usePageNavigationRoutesContext();
  useEffect(() => {
    setNavigation([
      {
        id: AwxRoute.SettingsGalaxyNG,
        path: 'settings/galaxy-ng',
        element: <div />,
      } as PageNavigationItem,
      {
        id: AwxRoute.Projects,
        path: 'projects',
        element: <div />,
      } as PageNavigationItem,
      {
        id: AwxRoute.SettingsJobs,
        path: 'settings/job-settings',
        element: <div />,
      } as PageNavigationItem,
    ]);
  }, [setNavigation]);
  return <>{props.children}</>;
}

describe('GalaxyNgOverview', () => {
  it('renders Galaxy NG status and content workflow links', () => {
    cy.viewport(1920, 1080);
    cy.intercept('GET', awxAPI`/galaxy_ng/status/`, status).as('status');

    cy.mount(
      <SeedNavigation>
        <GalaxyNgOverview />
      </SeedNavigation>
    );
    cy.wait('@status');

    cy.get('#galaxy-ng-control-plane').should('contain', 'Galaxy NG');
    cy.get('#galaxy-ng-control-plane').should('contain', 'Hub connected');
    cy.get('#galaxy-ng-control-plane').should('contain', '12');
    cy.get('#galaxy-ng-connection').should('contain', 'https://hub.example.test');
    cy.get('#galaxy-ng-workflows').should('contain', 'Open Galaxy NG UI');
    cy.get('#galaxy-ng-status').should('contain', 'Pulp API responded.');
  });
});
