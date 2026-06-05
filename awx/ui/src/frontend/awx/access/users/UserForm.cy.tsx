import mockAwxUser from '../../../../cypress/fixtures/awxUser.json';
import { AwxUser } from '../../interfaces/User';
import { CreateUser, EditUser } from './UserForm';

describe('AwxUserForm custom user types', () => {
  beforeEach(() => {
    cy.intercept('GET', '/api/v2/user_types/?page_size=200*', {
      fixture: 'awxUserTypes.json',
    }).as('getUserTypes');
    cy.intercept('GET', '/api/v2/organizations/?*', { fixture: 'organizations.json' });
  });

  it('shows custom user types in the profile user type dropdown', () => {
    cy.mount(<CreateUser />);
    cy.wait('@getUserTypes');
    cy.get('button[data-cy="usertype"]').click();
    cy.contains('System administrator').should('be.visible');
    cy.contains('System auditor').should('be.visible');
    cy.contains('Normal user').should('be.visible');
    cy.contains('NOC operator').should('be.visible');
  });

  it('submits a custom user type without setting built-in system flags', () => {
    cy.intercept('POST', '/api/v2/organizations/1/users/', {
      statusCode: 201,
      body: { ...mockAwxUser, id: 34, username: 'noc-user', custom_user_type: 7 },
    }).as('createUser');

    cy.mount(<CreateUser />);
    cy.get('[data-cy="username"]').type('noc-user');
    cy.get('button[data-cy="usertype"]').click();
    cy.contains('button', 'NOC operator').click();
    cy.get('button[data-cy="organization"]').click();
    cy.contains('button', 'Default').click();
    cy.get('[data-cy="password"]').type('r$TyKiOCb#ED');
    cy.get('[data-cy="confirmpassword"]').type('r$TyKiOCb#ED');
    cy.clickButton(/^Create user$/);

    cy.wait('@createUser')
      .its('request.body')
      .then((user: AwxUser & { custom_user_type?: number }) => {
        expect(user.is_superuser).to.equal(false);
        expect(user.is_system_auditor).to.equal(false);
        expect(user.custom_user_type).to.equal(7);
      });
  });

  it('prefills an existing custom user type when editing a user', () => {
    cy.intercept('GET', '/api/v2/users/3/', {
      ...mockAwxUser,
      id: 3,
      custom_user_type: 7,
      summary_fields: {
        ...mockAwxUser.summary_fields,
        custom_user_type: {
          id: 7,
          name: 'NOC operator',
          role_definitions: [{ id: 3, name: 'Inventory Admin' }],
        },
      },
    }).as('getUser');

    cy.mount(<EditUser />, {
      path: '/users/:id/edit',
      initialEntries: ['/users/3/edit'],
    });

    cy.wait('@getUser');
    cy.wait('@getUserTypes');
    cy.get('button[data-cy="usertype"]').should('contain.text', 'NOC operator');
  });
});
