import mockCustomRole from '../../../../cypress/fixtures/awxCustomRoleDefinition.json';
import { AwxRbacRole } from '../../interfaces/AwxRbacRole';
import { CloneRole } from './RoleForm';

describe('AwxRoleForm', () => {
  describe('Clone role', () => {
    beforeEach(() => {
      cy.intercept({ method: 'GET', url: '/api/v2/role_definitions/33/' }, mockCustomRole);
      cy.intercept('POST', '/api/v2/role_definitions/', {
        statusCode: 201,
        body: { ...mockCustomRole, id: 44, name: 'Copy of Inventory Read Compat' },
      }).as('cloneRole');
    });

    it('prefills from the source role and posts a new editable role definition', () => {
      cy.mount(<CloneRole />, {
        path: '/roles/:id/clone',
        initialEntries: ['/roles/33/clone'],
      });

      cy.verifyPageTitle('Clone Inventory Read Compat');
      cy.get('[data-cy="name"]').should('have.value', 'Copy of Inventory Read Compat');
      cy.get('[data-cy="description"]').should(
        'have.value',
        'Has Read permission to Inventory for backwards API compatibility'
      );
      cy.get('[data-cy="content-type-form-group"]').contains('Inventory');
      cy.multiSelectShouldHaveSelectedOption('#permissions', 'View inventory');

      cy.get('[data-cy="name"]').clear().type('NOC inventory reader');
      cy.clickButton(/^Create user type$/);
      cy.wait('@cloneRole')
        .its('request.body')
        .then((clonedRole: AwxRbacRole) => {
          expect(clonedRole).to.deep.equal({
            name: 'NOC inventory reader',
            description: 'Has Read permission to Inventory for backwards API compatibility',
            content_type: 'awx.inventory',
            permissions: ['awx.view_inventory'],
          });
        });
    });
  });
});
