/* eslint-disable i18next/no-literal-string */
import { CatalogItem } from '../../interfaces/CatalogItem';
import { CatalogBrowse } from './CatalogBrowse';

const catalogItem = {
  id: 1,
  name: 'Apache on Proxmox VM',
  description:
    'Provision a web server with a deliberately long description that should wrap inside the card.',
  organization: 1,
  related: {
    deployments: '/api/v2/catalog_items/1/deployments/',
  },
  summary_fields: {
    organization: { id: 1, name: 'Default' },
  },
  available_providers: ['proxmox', 'digitalocean'],
  cloud_backends: {},
  provider_workflows: { proxmox: 7, digitalocean: 8 },
  provider_field_configs: {},
  browse_enabled: true,
  default_lease_minutes: null,
  require_lease: false,
} as unknown as CatalogItem;

describe('CatalogBrowse', () => {
  it('uses a full-width responsive gallery for catalog cards', () => {
    cy.intercept('GET', '/api/v2/catalog_items/', {
      count: 1,
      next: null,
      previous: null,
      results: [catalogItem],
    }).as('catalogItems');

    cy.mount(<CatalogBrowse />, {
      path: '/catalog/browse',
      initialEntries: ['/catalog/browse'],
    });

    cy.wait('@catalogItems');
    cy.getByDataCy('catalog-browse-section')
      .should('be.visible')
      .and('not.have.class', 'pf-m-limit-width');
    cy.getByDataCy('catalog-browse-gallery').should('be.visible');
    cy.getByDataCy('catalog-browse-card').should('be.visible');
    cy.contains('Apache on Proxmox VM').should('be.visible');
    cy.get('[aria-label="Deploy via Proxmox VE"]').should('be.visible');
    cy.get('[aria-label="Deploy via DigitalOcean"]').should('be.visible');
  });
});
