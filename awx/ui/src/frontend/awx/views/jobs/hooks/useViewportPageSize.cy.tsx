import { useView } from '../../../../../framework/useView';
import { useViewportPageSize } from '../../../../../framework/useViewportPageSize';

function ViewportPageSizeHarness() {
  const defaultPerPage = useViewportPageSize();
  const view = useView({ defaultPerPage, disableQueryString: true });

  return (
    <>
      <span data-cy="per-page">{view.perPage}</span>
      <button data-cy="show-twenty" type="button" onClick={() => view.setPerPage(20)}>
        20
      </button>
    </>
  );
}

function FixedPageSizeHarness() {
  const view = useView({});
  return <span data-cy="fixed-per-page">{view.perPage}</span>;
}

describe('useViewportPageSize', () => {
  beforeEach(() => {
    cy.window().then((window) => {
      window.history.replaceState(null, '', '/');
      window.localStorage.clear();
      window.localStorage.setItem('perPage', '10');
    });
  });

  it('fills the viewport instead of restoring the legacy fixed page size', () => {
    cy.viewport(2048, 1152);
    cy.mount(<ViewportPageSizeHarness />);

    cy.get('[data-cy="per-page"]').should('have.text', '20');
  });

  it('tracks viewport height until the user selects a page size', () => {
    cy.viewport(1440, 900);
    cy.mount(<ViewportPageSizeHarness />);

    cy.get('[data-cy="per-page"]').should('have.text', '14');

    cy.viewport(1440, 1152);
    cy.get('[data-cy="per-page"]').should('have.text', '20');

    cy.get('[data-cy="show-twenty"]').click();
    cy.get('[data-cy="per-page"]').should('have.text', '20');

    cy.viewport(1440, 900);
    cy.get('[data-cy="per-page"]').should('have.text', '20');
  });

  it('keeps explicit URL pagination for non-adaptive views', () => {
    cy.window().then((window) => {
      window.history.replaceState(null, '', '/?perPage=25');
    });

    cy.mount(<FixedPageSizeHarness />);

    cy.get('[data-cy="fixed-per-page"]').should('have.text', '25');
  });
});
