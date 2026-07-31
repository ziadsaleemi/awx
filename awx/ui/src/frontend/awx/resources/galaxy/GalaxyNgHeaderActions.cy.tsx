import { GalaxyNgHeaderActions } from './GalaxyNgHeaderActions';

describe('GalaxyNgHeaderActions', () => {
  it('keeps Galaxy NG pages inside Capstan', () => {
    cy.intercept('GET', '/api/v2/ai/settings/', {
      enabled: true,
      configured: true,
    });
    cy.mount(<GalaxyNgHeaderActions page="Signature Keys" prompt="Review signature keys" />);

    cy.contains('Open Galaxy UI').should('not.exist');
    cy.contains('Open API').should('not.exist');
    cy.get('[aria-label="Ask assistant about this module"]').should('exist');
  });
});
