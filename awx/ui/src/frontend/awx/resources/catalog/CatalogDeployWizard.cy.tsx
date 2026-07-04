/* eslint-disable i18next/no-literal-string */
import { CatalogItem } from '../../interfaces/CatalogItem';
import { CatalogDeployContent } from './CatalogDeployWizard';

describe('CatalogDeployContent', () => {
  it('loads provider surveys through the catalog deploy survey endpoint', () => {
    const item = {
      id: 1,
      name: 'Linux VM',
      description: 'Provision a Linux VM.',
      organization: 1,
      related: {
        deployments: '/api/v2/catalog_items/1/deployments/',
      },
      summary_fields: {
        organization: { id: 1, name: 'Default' },
      },
      available_providers: ['digitalocean'],
      provider_workflows: { digitalocean: 7 },
      provider_field_configs: {},
      browse_enabled: true,
      default_lease_minutes: null,
      require_lease: false,
    } as unknown as CatalogItem;

    cy.intercept('GET', '/api/v2/catalog_items/1/deploy_survey/', {
      schema: { type: 'object', properties: {}, required: [] },
    }).as('baseSurvey');
    cy.intercept('GET', '/api/v2/catalog_items/1/deploy_survey/?provider=digitalocean', {
      schema: {
        type: 'object',
        properties: {
          droplet_name: {
            type: 'string',
            title: 'Droplet name',
            description: 'Desired droplet name',
            default: 'catalog-droplet',
          },
        },
        required: ['droplet_name'],
      },
    }).as('providerSurvey');
    cy.intercept('GET', '/api/v2/catalog_items/1/deployments/', {
      count: 0,
      next: null,
      previous: null,
      results: [],
    });
    cy.intercept('GET', '/api/v2/catalog_cloud/provider_state/digitalocean/?organization=1', {
      provider_data: null,
      admin_settings: null,
      provider_settings: null,
    });
    cy.intercept('GET', '/api/v2/catalog_cloud/provider_state/global/?organization=1', {
      provider_data: null,
      admin_settings: null,
      provider_settings: { vm_sizes: [] },
    });

    cy.mount(
      <CatalogDeployContent
        item={item}
        initialProvider="digitalocean"
        onDone={() => undefined}
        onCancel={() => undefined}
      />
    );

    cy.wait('@baseSurvey');
    cy.wait('@providerSurvey')
      .its('request.url')
      .should('include', '/api/v2/catalog_items/1/deploy_survey/?provider=digitalocean');
    cy.contains('Failed to load provider survey').should('not.exist');
    cy.contains('Droplet name').should('be.visible');
    cy.get('#deploy-field-droplet_name').should('have.value', 'catalog-droplet');
  });

  it('keeps configured VMware template defaults when provider state omits classic templates', () => {
    const item = {
      id: 1,
      name: 'Apache',
      description: 'Provision Apache on vSphere.',
      organization: 1,
      related: {
        deployments: '/api/v2/catalog_items/1/deployments/',
      },
      summary_fields: {
        organization: { id: 1, name: 'Default' },
      },
      available_providers: ['vmware'],
      provider_workflows: { vmware: 87 },
      provider_field_configs: {
        vmware: {
          dynamic_field_sources: {
            template_name: 'vms.name',
          },
        },
      },
      browse_enabled: true,
      default_lease_minutes: null,
      require_lease: false,
    } as unknown as CatalogItem;

    cy.intercept('GET', '/api/v2/catalog_items/1/deploy_survey/', {
      schema: { type: 'object', properties: {}, required: [] },
    });
    cy.intercept('GET', '/api/v2/catalog_items/1/deploy_survey/?provider=vmware', {
      schema: {
        type: 'object',
        properties: {
          template_name: {
            type: 'string',
            title: 'Template name',
            description: 'Existing vSphere VM template to clone.',
            default: 'Oracle-Linux-9-Template',
          },
        },
        required: ['template_name'],
      },
    });
    cy.intercept('GET', '/api/v2/catalog_items/1/deployments/', {
      count: 0,
      next: null,
      previous: null,
      results: [],
    });
    cy.intercept('GET', '/api/v2/catalog_cloud/provider_state/vmware/?organization=1', {
      provider_data: {
        '4': {
          vms: [{ name: 'web-01' }],
        },
      },
      admin_settings: null,
      provider_settings: null,
    });
    cy.intercept('GET', '/api/v2/catalog_cloud/provider_state/global/?organization=1', {
      provider_data: null,
      admin_settings: null,
      provider_settings: { vm_sizes: [] },
    });

    cy.mount(
      <CatalogDeployContent
        item={item}
        initialProvider="vmware"
        onDone={() => undefined}
        onCancel={() => undefined}
      />
    );

    cy.contains('Template name').should('be.visible');
    cy.get('#deploy-field-template_name').should('have.value', 'Oracle-Linux-9-Template');
    cy.get('#deploy-field-template_name option')
      .contains('Oracle-Linux-9-Template')
      .should('exist');
  });
});
