/* eslint-disable i18next/no-literal-string */
import { CardBody } from '@patternfly/react-core';
import { PageDashboard } from './PageDashboard';
import { PageDashboardCard } from './PageDashboardCard';

describe('PageDashboardCard', () => {
  it('does not clip content when only height is set', () => {
    cy.mount(
      <PageDashboard>
        <PageDashboardCard title="No clipping" height="xs">
          <CardBody>
            <div data-cy="tall-content" style={{ height: 600 }}>
              Tall content
            </div>
          </CardBody>
        </PageDashboardCard>
      </PageDashboard>
    );

    cy.get('.page-dashboard-card').should('have.css', 'max-height', 'none');
    cy.getByDataCy('tall-content').should('be.visible');
  });

  it('uses maxHeight only when explicitly requested', () => {
    cy.mount(
      <PageDashboard>
        <PageDashboardCard title="Scrollable" height="xs" maxHeight="xs">
          <CardBody>
            <div style={{ height: 600 }}>Tall content</div>
          </CardBody>
        </PageDashboardCard>
      </PageDashboard>
    );

    cy.get('.page-dashboard-card')
      .should('have.css', 'max-height', '196px')
      .and('have.css', 'overflow', 'auto');
  });
});
