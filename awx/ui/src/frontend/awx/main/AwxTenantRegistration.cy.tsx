import { AwxTenantRegistration } from './AwxTenantRegistration';

describe('AwxTenantRegistration', () => {
  it('creates a tenant with a generated organization identifier', () => {
    const onSuccess = cy.stub().as('onSuccess');
    cy.intercept('POST', '/api/v2/tenant-registration/', (request) => {
      expect(request.body).to.deep.equal({
        organization_name: 'Northstar Automation',
        organization_slug: 'northstar-automation',
        username: 'northstar-admin',
        email: 'admin@northstar.example',
        first_name: 'Northstar',
        last_name: 'Admin',
        password: 'CloudHarbor-2026!',
      });
      request.reply({
        statusCode: 201,
        body: {
          organization: {
            id: 1,
            name: 'Northstar Automation',
            tenant_slug: 'northstar-automation',
            tenant_status: 'active',
          },
          user: {
            id: 2,
            username: 'northstar-admin',
            email: 'admin@northstar.example',
          },
          login_url: '/api/login/',
        },
      });
    }).as('registerTenant');

    cy.mount(
      <AwxTenantRegistration
        registrationUrl="/api/v2/tenant-registration/"
        brandImgAlt="Capstan"
        onSuccess={onSuccess}
      />,
      { path: '/', initialEntries: ['/'] }
    );

    cy.get('#tenant-registration-organization_name').type('Northstar Automation');
    cy.get('#tenant-registration-organization_slug').should('have.value', 'northstar-automation');
    cy.get('#tenant-registration-first_name').type('Northstar');
    cy.get('#tenant-registration-last_name').type('Admin');
    cy.get('#tenant-registration-username').type('northstar-admin');
    cy.get('#tenant-registration-email').type('admin@northstar.example');
    cy.get('#tenant-registration-password').type('CloudHarbor-2026!');
    cy.get('#tenant-registration-confirm_password').type('CloudHarbor-2026!');
    cy.contains('button', 'Create organization').click();

    cy.wait('@registerTenant');
    cy.get('@onSuccess').should('have.been.calledOnce');
  });

  it('does not submit mismatched passwords', () => {
    cy.intercept('POST', '/api/v2/tenant-registration/').as('registerTenant');
    cy.mount(
      <AwxTenantRegistration
        registrationUrl="/api/v2/tenant-registration/"
        brandImgAlt="Capstan"
        onSuccess={() => {}}
      />,
      { path: '/', initialEntries: ['/'] }
    );

    cy.get('#tenant-registration-organization_name').type('Northstar Automation');
    cy.get('#tenant-registration-username').type('northstar-admin');
    cy.get('#tenant-registration-email').type('admin@northstar.example');
    cy.get('#tenant-registration-password').type('CloudHarbor-2026!');
    cy.get('#tenant-registration-confirm_password').type('Different-2026!');
    cy.contains('button', 'Create organization').click();

    cy.contains('Passwords do not match.').should('be.visible');
    cy.get('@registerTenant.all').should('have.length', 0);
  });

  it('shows server validation next to the rejected field', () => {
    cy.intercept('POST', '/api/v2/tenant-registration/', {
      statusCode: 400,
      headers: { 'content-type': 'application/json' },
      body: { organization_slug: ['This organization identifier is unavailable.'] },
    });
    cy.mount(
      <AwxTenantRegistration
        registrationUrl="/api/v2/tenant-registration/"
        brandImgAlt="Capstan"
        onSuccess={() => {}}
      />,
      { path: '/', initialEntries: ['/'] }
    );

    cy.get('#tenant-registration-organization_name').type('Northstar Automation');
    cy.get('#tenant-registration-username').type('northstar-admin');
    cy.get('#tenant-registration-email').type('admin@northstar.example');
    cy.get('#tenant-registration-password').type('CloudHarbor-2026!');
    cy.get('#tenant-registration-confirm_password').type('CloudHarbor-2026!');
    cy.contains('button', 'Create organization').click();

    cy.contains('This organization identifier is unavailable.').should('be.visible');
  });
});
