import { UserTypes } from './UserTypes';

describe('UserTypes', () => {
  beforeEach(() => {
    cy.intercept('GET', '/api/v2/user_types/*', { fixture: 'awxUserTypes.json' }).as(
      'getUserTypes'
    );
  });

  it('renders custom user types separately from roles', () => {
    cy.mount(<UserTypes />);
    cy.verifyPageTitle('User types');
    cy.contains('NOC operator').should('be.visible');
    cy.contains('Inventory Admin').should('be.visible');
    cy.contains('a', /^Create user type$/).should('be.visible');
  });
});
