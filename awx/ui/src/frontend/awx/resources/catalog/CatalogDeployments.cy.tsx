import { CatalogDeployment } from '../../interfaces/CatalogDeployment';
import { CatalogDeployments } from './CatalogDeployments';

const deployments = [
  {
    id: 2,
    name: 'Newest deployment',
    created: '2026-07-29T16:00:00Z',
    status: 'successful',
    summary_fields: {},
  },
  {
    id: 1,
    name: 'Older deployment',
    created: '2026-07-28T16:00:00Z',
    status: 'successful',
    summary_fields: {},
  },
] as unknown as CatalogDeployment[];

describe('CatalogDeployments', () => {
  it('loads My Deployments newest first by default', () => {
    cy.intercept('GET', '/api/v2/catalog_deployments/?*', (request) => {
      expect(request.query.order_by).to.equal('-created');
      request.reply({
        count: deployments.length,
        next: null,
        previous: null,
        results: deployments,
      });
    }).as('catalogDeployments');

    cy.mount(<CatalogDeployments />, {
      path: '/catalog/deployments',
      initialEntries: ['/catalog/deployments'],
    });

    cy.wait('@catalogDeployments');
    cy.get('tbody tr').eq(0).should('contain.text', 'Newest deployment');
    cy.get('tbody tr').eq(1).should('contain.text', 'Older deployment');
  });
});
