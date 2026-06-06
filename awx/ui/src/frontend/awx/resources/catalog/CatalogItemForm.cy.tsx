/* eslint-disable i18next/no-literal-string */
import { CatalogItem } from '../../interfaces/CatalogItem';
import { EditCatalogItem } from './CatalogItemForm';

function gridTrackCount($el: JQuery<HTMLElement>) {
  return window.getComputedStyle($el[0]).gridTemplateColumns.split(' ').filter(Boolean).length;
}

const catalogItem = {
  id: 1,
  name: 'Apache VM',
  description:
    'Long catalog description used to prove the edit form wraps without forcing fixed columns.',
  organization: 1,
  summary_fields: {
    organization: { id: 1, name: 'Default' },
  },
  related: {},
  available_providers: ['proxmox'],
  cloud_backends: {},
  provider_workflows: { proxmox: 7 },
  provider_deprovision_workflows: {},
  provider_field_configs: {
    proxmox: {
      disabled_fields: [],
      hidden_fields: [],
      field_templates: {},
      dynamic_field_sources: {},
      target_inventory: '{user_org_name}_inventory',
      target_group: '{env}_servers',
      vm_size_settings: {
        enabled: true,
        allow_manual: true,
        cpu_variable: 'num_cpus',
        ram_variable: 'ram_gb',
        cpu_limit: 8,
        ram_limit: 32,
        require_approval: true,
      },
    },
  },
  browse_enabled: true,
  default_lease_minutes: null,
  require_lease: false,
} as unknown as CatalogItem;

describe('CatalogItemForm', () => {
  beforeEach(() => {
    cy.intercept('GET', '/api/v2/catalog_items/1/', catalogItem).as('catalogItem');
    cy.intercept('GET', '/api/v2/organizations/**', {
      count: 1,
      next: null,
      previous: null,
      results: [{ id: 1, name: 'Default', summary_fields: {} }],
    });
    cy.intercept('GET', '/api/v2/catalog_cloud/connections/**', {
      count: 1,
      next: null,
      previous: null,
      results: [{ id: 10, provider_id: 'proxmox', name: 'Lab Proxmox', status: 'connected' }],
    });
    cy.intercept('GET', '/api/v2/workflow_job_templates/7/', {
      id: 7,
      name: 'Provision Proxmox VM',
    });
    cy.intercept('GET', '/api/v2/workflow_job_templates/7/survey_spec/', {
      name: 'Provision Proxmox VM',
      description: '',
      spec: [
        { type: 'text', variable: 'env', question_name: 'Environment', required: false },
        { type: 'integer', variable: 'num_cpus', question_name: 'CPU', required: false },
        { type: 'integer', variable: 'ram_gb', question_name: 'RAM', required: false },
      ],
    });
  });

  it('uses responsive grids on catalog item edit fields', () => {
    cy.viewport(1280, 900);
    cy.mount(<EditCatalogItem />, {
      path: '/catalog/items/:id/edit',
      initialEntries: ['/catalog/items/1/edit'],
    });

    cy.wait('@catalogItem');
    cy.getByDataCy('catalog-item-details-grid').should(($grid) => {
      expect(gridTrackCount($grid)).to.eq(2);
    });

    cy.viewport(390, 800);
    cy.getByDataCy('catalog-item-details-grid').should(($grid) => {
      expect(gridTrackCount($grid)).to.eq(1);
    });

    cy.viewport(1280, 900);
    cy.contains('button', 'Proxmox VE Fields').click();
    cy.getByDataCy('catalog-provider-target-grid').should(($grid) => {
      expect(gridTrackCount($grid)).to.eq(2);
    });

    cy.viewport(390, 800);
    cy.getByDataCy('catalog-provider-target-grid').should(($grid) => {
      expect(gridTrackCount($grid)).to.eq(1);
    });
    cy.get('[data-cy="catalog-provider-vm-size-grid"]')
      .scrollIntoView()
      .should('be.visible')
      .should(($grid) => {
        expect(gridTrackCount($grid)).to.eq(1);
      });
  });
});
