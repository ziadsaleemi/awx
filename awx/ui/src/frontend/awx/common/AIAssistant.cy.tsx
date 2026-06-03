import { AIAssistantPanel } from './AIAssistant';

describe('AIAssistantPanel', () => {
  it('renders assistant markdown answers as formatted content', () => {
    cy.intercept('POST', '/api/v2/ai/chat/', {
      message: {
        role: 'assistant',
        content: '**AWX host summary**\n\n- web01\n- db01\n\nUse `Resources > Hosts` for details.',
      },
      model: 'awx',
      provider: 'awx',
    }).as('chat');

    cy.mount(<AIAssistantPanel isOpen onClose={() => undefined} />);

    cy.get('textarea[aria-label="Message"]').type('Can you list all the hosts?');
    cy.contains('button', 'Send').click();
    cy.wait('@chat');

    cy.getByDataCy('ai-assistant-message-assistant').within(() => {
      cy.get('strong').should('contain.text', 'AWX host summary');
      cy.get('li').should('have.length', 2);
      cy.get('li').eq(0).should('contain.text', 'web01');
      cy.get('li').eq(1).should('contain.text', 'db01');
      cy.get('code').should('contain.text', 'Resources > Hosts');
      cy.contains('**AWX host summary**').should('not.exist');
      cy.contains('- web01').should('not.exist');
    });
  });
});
