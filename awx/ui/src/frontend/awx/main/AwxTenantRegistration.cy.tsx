import { AwxTenantRegistration } from './AwxTenantRegistration';
import { AwxTenantVerification } from './AwxTenantVerification';

describe('AwxTenantRegistration', () => {
  beforeEach(() => {
    cy.window().then((win) => {
      win.turnstile = {
        render: (_container, options) => {
          options.callback('browser-challenge');
          return 'test-widget';
        },
        remove: () => undefined,
      };
    });
  });

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
        terms_accepted: true,
        terms_version: '2026-07-31',
        bot_challenge_token: 'browser-challenge',
      });
      request.reply({
        statusCode: 202,
        body: {
          detail: 'Check your email to verify the organization registration.',
          verification_required: true,
        },
      });
    }).as('registerTenant');

    cy.mount(
      <AwxTenantRegistration
        registrationUrl="/api/v2/tenant-registration/"
        termsVersion="2026-07-31"
        termsUrl="https://capstan.example/terms"
        privacyUrl="https://capstan.example/privacy"
        botProvider="turnstile"
        botSiteKey="site-key"
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
    cy.get('#tenant-registration-terms_accepted').click();
    cy.contains('button', 'Request organization').click();

    cy.wait('@registerTenant');
    cy.get('@onSuccess').should('have.been.calledOnce');
  });

  it('does not submit mismatched passwords', () => {
    cy.intercept('POST', '/api/v2/tenant-registration/').as('registerTenant');
    cy.mount(
      <AwxTenantRegistration
        registrationUrl="/api/v2/tenant-registration/"
        termsVersion="2026-07-31"
        termsUrl="https://capstan.example/terms"
        privacyUrl="https://capstan.example/privacy"
        botProvider="turnstile"
        botSiteKey="site-key"
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
    cy.get('#tenant-registration-terms_accepted').click();
    cy.contains('button', 'Request organization').click();

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
        termsVersion="2026-07-31"
        termsUrl="https://capstan.example/terms"
        privacyUrl="https://capstan.example/privacy"
        botProvider="turnstile"
        botSiteKey="site-key"
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
    cy.get('#tenant-registration-terms_accepted').click();
    cy.contains('button', 'Request organization').click();

    cy.contains('This organization identifier is unavailable.').should('be.visible');
  });
});

describe('AwxTenantVerification', () => {
  it('verifies the pending organization and links to login', () => {
    cy.intercept('POST', '/api/v2/tenant-registration/verify/', (request) => {
      expect(request.body).to.deep.equal({ token: 'signed-token' });
      request.reply({
        statusCode: 201,
        body: { user: { username: 'northstar-admin' } },
      });
    }).as('verifyTenant');

    cy.mount(
      <AwxTenantVerification
        verificationUrl="/api/v2/tenant-registration/verify/"
        token="signed-token"
        brandImgAlt="Capstan"
      />,
      { path: '/register/verify', initialEntries: ['/register/verify'] }
    );

    cy.wait('@verifyTenant');
    cy.contains('Organization verified').should('be.visible');
    cy.contains('Sign in with northstar-admin.').should('be.visible');
    cy.contains('a', 'Continue to login')
      .should('have.attr', 'href')
      .and('contain', 'registration=verified');
  });

  it('offers a new registration for an invalid or consumed link', () => {
    cy.intercept('POST', '/api/v2/tenant-registration/verify/', {
      statusCode: 400,
      body: { token: 'This verification link has already been used.' },
    }).as('verifyTenant');

    cy.mount(
      <AwxTenantVerification
        verificationUrl="/api/v2/tenant-registration/verify/"
        token="consumed-token"
        brandImgAlt="Capstan"
      />,
      { path: '/register/verify', initialEntries: ['/register/verify'] }
    );

    cy.wait('@verifyTenant');
    cy.contains('Unable to verify organization').should('be.visible');
    cy.contains('a', 'Start a new registration').should('have.attr', 'href', '/register');
  });
});
