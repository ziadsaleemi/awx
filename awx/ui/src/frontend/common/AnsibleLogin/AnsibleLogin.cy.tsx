import { AnsibleLogin } from './AnsibleLogin';

describe('AnsibleLogin', () => {
  it('should render error message when auth_field url param present', () => {
    cy.mount(<AnsibleLogin loginApiUrl="/login" brandImgAlt="" onSuccess={() => {}} />, {
      path: '/',
      initialEntries: ['?auth_failed'],
    });

    cy.get('.pf-m-error').then((el) => {
      expect(el).to.contain('Unable to complete social auth login');
    });
  });

  it('should render Microsoft Entra ID as a redirect authentication method', () => {
    cy.mount(
      <AnsibleLogin
        loginApiUrl="/login"
        brandImgAlt=""
        onSuccess={() => {}}
        authOptions={[
          {
            login_url: '/sso/login/azuread-tenant-oauth2/',
            name: 'Microsoft Entra ID',
            type: 'azuread-tenant-oauth2',
          },
        ]}
      />
    );

    cy.get('[data-cy="social-auth-azuread-tenant-oauth2"]')
      .should('contain.text', 'Microsoft Entra ID')
      .and('have.attr', 'href', '/sso/login/azuread-tenant-oauth2/');
  });

  it('should explain that the password form accepts LDAP credentials', () => {
    cy.mount(
      <AnsibleLogin
        loginApiUrl="/login"
        brandImgAlt=""
        loginSubtitle="Use your local or LDAP directory credentials."
        onSuccess={() => {}}
      />
    );

    cy.contains('Use your local or LDAP directory credentials.').should('be.visible');
  });
});
