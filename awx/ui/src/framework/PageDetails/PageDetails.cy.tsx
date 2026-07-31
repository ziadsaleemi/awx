/* eslint-disable i18next/no-literal-string */
import { PageDetail } from './PageDetail';
import { PageDetails } from './PageDetails';

describe('PageDetails', () => {
  it('uses the available width on ultrawide screens', () => {
    cy.viewport(3440, 1440);
    cy.mount(
      <PageDetails disableScroll>
        <PageDetail label="Name">Responsive details</PageDetail>
        <PageDetail label="Status">Ready</PageDetail>
        <PageDetail label="Execution node">node-01</PageDetail>
      </PageDetails>
    );

    cy.getByDataCy('page-details').then(($details) => {
      const details = $details[0].getBoundingClientRect();
      expect(details.width).to.be.greaterThan(3200);
      expect(details.right).to.be.lessThan(3441);
    });
  });

  it('keeps full-width details spanning the responsive grid', () => {
    cy.viewport(3440, 1440);
    cy.mount(
      <PageDetails disableScroll>
        <PageDetail label="Name">Responsive details</PageDetail>
        <PageDetail label="Status">Ready</PageDetail>
        <PageDetail id="variables" label="Variables" fullWidth>
          key: value
        </PageDetail>
      </PageDetails>
    );

    cy.getByDataCy('page-details').then(($details) => {
      const details = $details[0].getBoundingClientRect();
      cy.getByDataCy('variables')
        .parent()
        .then(($group) => {
          const group = $group[0].getBoundingClientRect();
          expect(group.width).to.be.greaterThan(details.width * 0.95);
        });
    });
  });
});
