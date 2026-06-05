import { ReactNode, useEffect } from 'react';
import { PageNavigationItem } from '../../../../framework';
import { usePageNavigationRoutesContext } from '../../../../framework/PageNavigation/PageNavigationRoutesProvider';
import { AwxRoute } from '../../main/AwxRoutes';
import { AwxSettings } from './AwxSettings';

function SeedNavigation(props: { children: ReactNode }) {
  const [, setNavigation] = usePageNavigationRoutesContext();
  useEffect(() => {
    setNavigation([
      {
        id: AwxRoute.ActivityStream,
        path: 'activity-stream',
        element: <div />,
      } as PageNavigationItem,
      {
        id: AwxRoute.SettingsUi,
        path: 'settings/user-interface',
        element: <div />,
      } as PageNavigationItem,
      {
        id: AwxRoute.SettingsAiAssistant,
        path: 'settings/ai-assistant',
        element: <div />,
      } as PageNavigationItem,
      {
        id: AwxRoute.SettingsEda,
        path: 'settings/eda',
        element: <div />,
      } as PageNavigationItem,
    ]);
  }, [setNavigation]);
  return <>{props.children}</>;
}

function interceptSettingsOptions() {
  cy.intercept('OPTIONS', '/api/v2/settings/all/', {
    actions: {
      GET: {
        CUSTOM_LOGO: {
          type: 'string',
          label: 'Custom logo',
          category: 'User Interface',
          category_slug: 'ui',
        },
        AI_ENABLED: {
          type: 'boolean',
          label: 'Enable AI assistant',
          category: 'AI Assistant',
          category_slug: 'ai-assistant',
        },
        EDA_SERVER_URL: {
          type: 'string',
          label: 'EDA server URL',
          category: 'Event-Driven Ansible',
          category_slug: 'eda',
        },
      },
      PUT: {
        CUSTOM_LOGO: {
          type: 'string',
          label: 'Custom logo',
          category: 'User Interface',
          category_slug: 'ui',
        },
        AI_ENABLED: {
          type: 'boolean',
          label: 'Enable AI assistant',
          category: 'AI Assistant',
          category_slug: 'ai-assistant',
        },
        EDA_SERVER_URL: {
          type: 'string',
          label: 'EDA server URL',
          category: 'Event-Driven Ansible',
          category_slug: 'eda',
        },
      },
    },
  }).as('settingsOptions');
}

function mountSettings() {
  interceptSettingsOptions();
  cy.mount(
    <SeedNavigation>
      <AwxSettings />
    </SeedNavigation>,
    {
      path: '/settings',
      initialEntries: ['/settings'],
    }
  );
  cy.wait('@settingsOptions');
}

describe('AwxSettings', () => {
  it('uses a full-width responsive card gallery on desktop', () => {
    cy.viewport(1440, 900);
    mountSettings();

    cy.getByDataCy('settings-cards-section')
      .should('be.visible')
      .and('not.have.class', 'pf-m-limit-width');
    cy.getByDataCy('settings-cards-gallery').should('be.visible');
    cy.getByDataCy('settings-card-ui').should('be.visible');
    cy.getByDataCy('settings-card-ai-assistant').should('be.visible');
    cy.getByDataCy('settings-card-eda').should('be.visible');
    cy.contains('a', 'User Interface Settings')
      .should('be.visible')
      .and('have.attr', 'href', '/settings/user-interface');
  });

  it('keeps setting cards inside a mobile viewport', () => {
    cy.viewport(390, 760);
    mountSettings();

    cy.getByDataCy('settings-cards-gallery').then(($gallery) => {
      const gallery = $gallery[0];
      expect(gallery.scrollWidth).to.be.lte(gallery.clientWidth + 1);
    });
    cy.getByDataCy('settings-card-ai-assistant').then(($card) => {
      const card = $card[0];
      expect(card.scrollWidth).to.be.lte(card.clientWidth + 1);
    });
  });
});
