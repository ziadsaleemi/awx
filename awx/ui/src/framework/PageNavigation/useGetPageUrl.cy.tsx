import { Button } from '@patternfly/react-core';
import { ReactNode, useEffect } from 'react';
import { PageNavigationItem } from './PageNavigationItem';
import {
  PageNavigationRoutesProvider,
  usePageNavigationRoutesContext,
} from './PageNavigationRoutesProvider';
import { useGetPageUrl } from './useGetPageUrl';

function LookupButton(props: { id: string; onResult?: (url: string) => void }) {
  const getPageUrl = useGetPageUrl();
  return (
    <Button
      data-cy={props.id}
      onClick={() => {
        const url = getPageUrl(props.id);
        props.onResult?.(url);
      }}
    >
      {props.id}
    </Button>
  );
}

function SeedNavigation(props: { children: ReactNode }) {
  const [, setNavigation] = usePageNavigationRoutesContext();
  useEffect(() => {
    setNavigation([{ id: 'known-page', path: 'known' } as PageNavigationItem]);
  }, [setNavigation]);
  return <>{props.children}</>;
}

describe('useGetPageUrl', () => {
  it('does not log missing page ids before navigation routes are initialized', () => {
    cy.spy(console, 'error').as('consoleError');

    cy.mount(
      <PageNavigationRoutesProvider>
        <LookupButton id="known-page" />
      </PageNavigationRoutesProvider>
    );

    cy.getByDataCy('known-page').click();
    cy.get('@consoleError').should('not.have.been.called');
  });

  it('logs missing page ids after navigation routes are initialized', () => {
    cy.spy(console, 'error').as('consoleError');
    const onResult = cy.stub().as('onResult');

    cy.mount(
      <PageNavigationRoutesProvider>
        <SeedNavigation>
          <LookupButton id="known-page" onResult={onResult} />
          <LookupButton id="missing-page" />
        </SeedNavigation>
      </PageNavigationRoutesProvider>
    );

    cy.getByDataCy('known-page').click();
    cy.get('@onResult').should('have.been.calledWith', '/known');
    cy.getByDataCy('missing-page').click();
    cy.get('@consoleError').should('have.been.calledWith', 'Page id missing-page not found');
  });
});
