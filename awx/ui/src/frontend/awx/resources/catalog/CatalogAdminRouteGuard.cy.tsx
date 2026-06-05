/* eslint-disable i18next/no-literal-string */
import { CatalogAdminRouteGuard } from './CatalogAdminRouteGuard';

function interceptPersonaAccess(userId: number, roles: string[]) {
  cy.intercept('GET', `/api/v2/users/${userId.toString()}/admin_of_organizations/`, {
    count: 0,
    next: null,
    previous: null,
    results: [],
  });
  cy.intercept('GET', `/api/v2/users/${userId.toString()}/roles/`, {
    count: roles.length,
    next: null,
    previous: null,
    results: roles.map((name, index) => ({
      id: index + 1,
      type: 'role',
      url: `/api/v2/roles/${(index + 1).toString()}/`,
      related: {},
      summary_fields: {},
      name,
      description: '',
    })),
  });
}

describe('CatalogAdminRouteGuard', () => {
  it('allows catalog administrator user types without org-admin membership', () => {
    interceptPersonaAccess(32, []);

    cy.mount(
      <CatalogAdminRouteGuard>
        <div>Catalog admin content</div>
      </CatalogAdminRouteGuard>,
      {
        path: '/catalog/admin/items',
        initialEntries: ['/catalog/admin/items'],
      },
      'activeUserCatalogAdmin.json'
    );

    cy.contains('Catalog admin content').should('be.visible');
    cy.contains('You do not have permission to manage catalog resources.').should('not.exist');
  });

  it('blocks catalog user personas from catalog administration', () => {
    interceptPersonaAccess(31, ['Catalog User']);

    cy.mount(
      <CatalogAdminRouteGuard>
        <div>Catalog admin content</div>
      </CatalogAdminRouteGuard>,
      {
        path: '/catalog/admin/items',
        initialEntries: ['/catalog/admin/items'],
      },
      'activeUserCatalogUser.json'
    );

    cy.contains('You do not have permission to manage catalog resources.').should('be.visible');
    cy.contains('Catalog admin content').should('not.exist');
  });
});
