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
  settings_url: '/api/v2/settings/galaxy-ng/',
  message: 'Galaxy NG server URL is configured.',
  counts: {
    namespaces: 2,
    collections: 12,
    repositories: 3,
    remotes: 2,
    remote_registries: 1,
    signature_keys: 1,
    collection_approvals: 2,
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
        id: AwxRoute.GalaxyNGNamespaces,
        path: 'galaxy-ng/namespaces',
        element: <div />,
      } as PageNavigationItem,
      {
        id: AwxRoute.GalaxyNGCollections,
        path: 'galaxy-ng/collections',
        element: <div />,
      } as PageNavigationItem,
      {
        id: AwxRoute.GalaxyNGProjectImports,
        path: 'galaxy-ng/project-imports',
        element: <div />,
      } as PageNavigationItem,
      {
        id: AwxRoute.GalaxyNGExecutionEnvironments,
        path: 'galaxy-ng/execution-environments',
        element: <div />,
      } as PageNavigationItem,
      {
        id: AwxRoute.GalaxyNGSignatureKeys,
        path: 'galaxy-ng/signature-keys',
        element: <div />,
      } as PageNavigationItem,
      {
        id: AwxRoute.GalaxyNGRepositories,
        path: 'galaxy-ng/repositories',
        element: <div />,
      } as PageNavigationItem,
      {
        id: AwxRoute.GalaxyNGRemoteRegistries,
        path: 'galaxy-ng/remote-registries',
        element: <div />,
      } as PageNavigationItem,
      {
        id: AwxRoute.GalaxyNGTasks,
        path: 'galaxy-ng/tasks',
        element: <div />,
      } as PageNavigationItem,
      {
        id: AwxRoute.GalaxyNGCollectionApprovals,
        path: 'galaxy-ng/collection-approvals',
        element: <div />,
      } as PageNavigationItem,
      {
        id: AwxRoute.GalaxyNGRemotes,
        path: 'galaxy-ng/remotes',
        element: <div />,
      } as PageNavigationItem,
      {
        id: AwxRoute.GalaxyNGApiToken,
        path: 'galaxy-ng/api-token',
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
    cy.get('#galaxy-ng-workflows').should('contain', 'Remotes');
    cy.get('#galaxy-ng-workflows').should('contain', 'Remote Registries');
    cy.get('#galaxy-ng-workflows').should('contain', 'Project Imports');
    cy.get('#galaxy-ng-workflows').should('contain', 'Signature Keys');
    cy.get('#galaxy-ng-workflows').should('contain', 'Collection Approvals');
    cy.get('#galaxy-ng-workflows').should('contain', 'API Token');
    cy.get('#galaxy-ng-workflows').should('contain', 'Execution Environments');
    cy.get('#galaxy-ng-workflows').should('contain', 'Open Galaxy NG API');
    cy.get('#galaxy-ng-status').should('contain', 'Pulp API responded.');
  });

  it('uses a browser-safe URL for local Docker Desktop Galaxy NG links', () => {
    cy.viewport(1920, 1080);
    cy.intercept('GET', awxAPI`/galaxy_ng/status/`, {
      ...status,
      server_url: 'http://host.docker.internal:5001',
      api_root_url: 'http://host.docker.internal:5001/api/galaxy/',
      content_url: 'http://host.docker.internal:5001/pulp/content/',
      ui_url: 'http://host.docker.internal:5001/ui/',
    }).as('status');

    cy.mount(
      <SeedNavigation>
        <GalaxyNgOverview />
      </SeedNavigation>
    );
    cy.wait('@status');

    cy.contains('#galaxy-ng-workflows a', 'Open Galaxy NG API').should(
      'have.attr',
      'href',
      'http://localhost:5001/api/galaxy/v3/swagger-ui/'
    );
  });
});
