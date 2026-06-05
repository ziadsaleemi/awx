import activeUser from '../../../../cypress/fixtures/activeUser.json';
import { CloudConnections } from './CloudConnections';

const proxmoxCredential = {
  id: 3,
  name: 'Proxmox Lab',
  credential_type: 9,
  credential_type__namespace: 'proxmox_ve',
  credential_type__kind: 'cloud',
  kind: 'cloud',
  cloud: true,
  organization: null,
  summary_fields: {
    credential_type: { id: 9, name: 'Proxmox VE' },
    user_capabilities: { edit: true, delete: true, copy: true, use: true },
  },
};

function interceptCloudConnectionRequests() {
  cy.intercept('GET', '/api/v2/users/20/admin_of_organizations/', {
    count: 0,
    next: null,
    previous: null,
    results: [],
  });
  cy.intercept('GET', '/api/v2/catalog_cloud/connections/', {
    count: 0,
    next: null,
    previous: null,
    results: [],
  }).as('allConnections');
  cy.intercept('GET', '/api/v2/catalog_cloud/connections/?provider_id=proxmox', {
    count: 0,
    next: null,
    previous: null,
    results: [],
  }).as('proxmoxConnections');
  cy.intercept('GET', '/api/v2/credentials/*credential_type__namespace=proxmox_ve*', {
    count: 1,
    next: null,
    previous: null,
    results: [proxmoxCredential],
  }).as('proxmoxCredentials');
}

describe('CloudConnections', () => {
  it('does not preload cloud connections for catalog-only users', () => {
    let connectionRequests = 0;
    cy.intercept('GET', '/api/v2/users/31/admin_of_organizations/', {
      count: 0,
      next: null,
      previous: null,
      results: [],
    });
    cy.intercept('GET', '/api/v2/catalog_cloud/connections*', (req) => {
      connectionRequests++;
      req.reply({ statusCode: 403, body: { detail: 'Forbidden' } });
    });

    cy.mount(
      <CloudConnections />,
      {
        path: '/cloud/connections',
        initialEntries: ['/cloud/connections'],
      },
      'activeUserCatalogUser.json'
    );

    cy.contains('You do not have permission to manage cloud connections.').should('be.visible');
    cy.then(() => {
      expect(connectionRequests).to.equal(0);
    });
  });

  it('shows Add connection and filters Proxmox credentials by provider namespace', () => {
    interceptCloudConnectionRequests();
    cy.intercept('POST', '/api/v2/catalog_cloud/connections/', {
      id: 11,
      provider_id: 'proxmox',
      name: 'Production Proxmox',
      status: 'disconnected',
      credential: 3,
      credential_name: 'Proxmox Lab',
      error: '',
      organization: null,
      updated_at: '2026-06-04T12:00:00Z',
    }).as('createConnection');
    cy.intercept('GET', '/api/v2/credentials/3/', proxmoxCredential).as('getCredential');
    cy.intercept('PATCH', '/api/v2/catalog_cloud/connections/11/', {
      id: 11,
      provider_id: 'proxmox',
      name: 'Production Proxmox',
      status: 'connected',
      credential: 3,
      credential_name: 'Proxmox Lab',
      error: '',
      organization: null,
      updated_at: '2026-06-04T12:00:01Z',
    }).as('connectConnection');

    cy.mount(<CloudConnections />, {
      path: '/cloud/connections',
      initialEntries: ['/cloud/connections'],
    });

    cy.contains('Proxmox VE').click();
    cy.wait('@proxmoxCredentials');
    cy.contains('button', /^Add connection$/)
      .should('be.visible')
      .click();
    cy.get('#proxmox-new-name').type('Production Proxmox');
    cy.get('#proxmox-new-credential').select('Proxmox Lab');
    cy.contains('button', /^Add & connect$/).click();
    cy.wait('@createConnection').its('request.body').should('deep.include', {
      provider_id: 'proxmox',
      name: 'Production Proxmox',
      credential: 3,
      credential_name: 'Proxmox Lab',
      organization: null,
    });
    cy.wait('@getCredential');
    cy.wait('@connectConnection').its('request.body').should('deep.include', {
      status: 'connected',
      credential: 3,
      credential_name: 'Proxmox Lab',
    });
  });

  it('keeps cloud management actions available while user role flags are resolved', () => {
    interceptCloudConnectionRequests();
    cy.intercept('GET', '/api/v2/users/20/', activeUser).as('userDetail');

    cy.mount(
      <CloudConnections />,
      {
        path: '/cloud/connections',
        initialEntries: ['/cloud/connections'],
      },
      'activeUserMissingRoleFlags.json'
    );

    cy.contains('Proxmox VE').click();
    cy.contains('button', /^Add connection$/).should('be.visible');
    cy.wait('@userDetail');
  });

  it('allows platform auditors to add connections for editable provider credentials', () => {
    interceptCloudConnectionRequests();

    cy.mount(
      <CloudConnections />,
      {
        path: '/cloud/connections',
        initialEntries: ['/cloud/connections'],
      },
      'activeUserSysAuditor.json'
    );

    cy.contains('Proxmox VE').click();
    cy.wait('@proxmoxCredentials');
    cy.contains('button', /^Add connection$/)
      .should('be.visible')
      .and('not.be.disabled');
  });
});
