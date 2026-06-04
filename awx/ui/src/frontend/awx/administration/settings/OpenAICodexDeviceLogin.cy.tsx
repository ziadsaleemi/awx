import { awxAPI } from '../../common/api/awx-utils';
import { OpenAICodexDeviceLogin } from './OpenAICodexDeviceLogin';

describe('OpenAICodexDeviceLogin', () => {
  beforeEach(() => {
    cy.intercept('GET', awxAPI`/ai/settings/`, {
      provider: 'openai_codex',
      openai_codex_connected: true,
      openai_codex_account_id:
        'acct_very_long_chatgpt_codex_account_identifier_used_for_responsive_testing',
      openai_codex_plan_type: 'team',
      openai_codex_expires_at: '2026-07-01T00:00:00Z',
      openai_codex_available_models: ['gpt-5.5', 'gpt-5.4'],
      openai_codex_default_model: 'gpt-5.5',
    });
    cy.intercept('GET', awxAPI`/ai/openai_codex/models/`, {
      configured: true,
      models: ['gpt-5.5', 'gpt-5.4', 'codex-long-model-name-for-responsive-layout-proof'],
      default_model: 'gpt-5.5',
      source: 'live',
      model_fetch_error: '',
    });
  });

  it('keeps device login controls inside a mobile viewport', () => {
    cy.viewport(390, 760);
    cy.intercept('POST', awxAPI`/ai/openai_codex/device_code/start/`, {
      device_code: 'device-responsive-proof',
      user_code: 'ABCD-EFGH',
      verification_uri:
        'https://auth.openai.com/activate/very/long/path/for/responsive/layout/proof',
      verification_uri_complete:
        'https://auth.openai.com/activate/very/long/path/for/responsive/layout/proof?user_code=ABCD-EFGH',
      expires_in: 900,
      interval: 5,
    }).as('startDeviceLogin');

    cy.mount(<OpenAICodexDeviceLogin />);

    cy.contains('Connected').should('be.visible');
    cy.getByDataCy('openai-codex-device-login').should('be.visible');
    cy.contains('button', 'Start OpenAI Codex device login').click();
    cy.wait('@startDeviceLogin');

    cy.get('[data-cy="openai-codex-verification-link"]').should(
      'contain.text',
      'https://auth.openai.com/activate'
    );

    cy.window().then((win) => {
      cy.getByDataCy('openai-codex-device-login').then(($panel) => {
        const rect = $panel[0].getBoundingClientRect();
        expect(rect.left).to.be.gte(0);
        expect(rect.right).to.be.lte(win.innerWidth);
      });
      cy.get('[data-cy="openai-codex-device-actions"]').then(($actions) => {
        const rect = $actions[0].getBoundingClientRect();
        expect(rect.right).to.be.lte(win.innerWidth);
      });
      cy.document().then((doc) => {
        expect(doc.documentElement.scrollWidth).to.be.lte(win.innerWidth);
      });
    });
  });
});
