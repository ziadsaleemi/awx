import { ReactNode, useEffect } from 'react';
import { PageNavigationItem } from '../../../../framework';
import { usePageNavigationRoutesContext } from '../../../../framework/PageNavigation/PageNavigationRoutesProvider';
import { awxAPI } from '../../common/api/awx-utils';
import { AwxRoute } from '../../main/AwxRoutes';
import { QuayOverview } from './QuayOverview';

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
  verify_ssl: true,
  request_timeout: 10,
  settings_url: '/api/v2/settings/quay/',
  message: 'Project Quay registry URL is configured.',
  counts: {
    repositories: 2,
    tags: 0,
  },
  controller_error: '',
};

function SeedNavigation(props: { children: ReactNode }) {
  const [, setNavigation] = usePageNavigationRoutesContext();
  useEffect(() => {
    setNavigation([
      {
        id: AwxRoute.SettingsQuay,
        path: 'settings/quay',
        element: <div />,
      } as PageNavigationItem,
      {
        id: AwxRoute.QuayRepositories,
        path: 'quay/repositories',
        element: <div />,
      } as PageNavigationItem,
      {
        id: AwxRoute.QuayExecutionEnvironmentImages,
        path: 'quay/execution-environment-images',
        element: <div />,
      } as PageNavigationItem,
    ]);
  }, [setNavigation]);
  return <>{props.children}</>;
}

describe('QuayOverview', () => {
  it('renders Project Quay status and workflow links', () => {
    cy.viewport(1920, 1080);
    cy.intercept('GET', awxAPI`/quay/status/`, status).as('status');

    cy.mount(
      <SeedNavigation>
        <QuayOverview />
      </SeedNavigation>
    );
    cy.wait('@status');

    cy.get('#quay-control-plane').should('contain', 'Project Quay');
    cy.get('#quay-control-plane').should('contain', 'Quay connected');
    cy.get('#quay-control-plane').should('contain', 'quay.example.test');
    cy.get('#quay-control-plane').should('contain', '2');
    cy.get('#quay-connection').should('contain', 'https://quay.example.test');
    cy.get('#quay-workflows').should('contain', 'Repositories');
    cy.get('#quay-workflows').should('contain', 'Execution environment images');
    cy.get('#quay-status').should('contain', 'Project Quay is ready');
  });
});
