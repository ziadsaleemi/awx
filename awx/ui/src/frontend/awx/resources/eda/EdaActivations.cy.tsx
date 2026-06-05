import { EdaActivationPage } from './EdaActivationPage';
import { EdaActivations } from './EdaActivations';

const activation = {
  id: 42,
  name: 'Restart web on alert',
  status: 'running',
  started: '2026-06-01T12:00:00Z',
  finished: null,
  rulebook: 'restart-web.yml',
  event_source: 'Webhook',
  source: 'eda_controller',
  related: {
    controller_activation: 'https://eda.example.test/api/eda/v1/activations/42/',
  },
};

describe('EdaActivations', () => {
  beforeEach(() => {
    cy.intercept('GET', '/api/v2/eda/status/', {
      configured: true,
      status: 'configured',
      controller_url: 'https://eda.example.test',
      auth_configured: true,
      activations_url: '/api/v2/eda/activations/',
      settings_url: '/api/v2/settings/eda/',
      message: 'EDA Controller URL is configured.',
    });
  });

  function interceptEdaRoleDefinitions(userId: number, roleId: number, permissions: string[]) {
    cy.intercept('GET', `/api/v2/role_user_assignments/?user_id=${userId}&page_size=200`, {
      count: 0,
      next: null,
      previous: null,
      results: [],
    });
    cy.intercept('GET', `/api/v2/users/${userId}/teams/`, {
      count: 0,
      next: null,
      previous: null,
      results: [],
    });
    cy.intercept('GET', `/api/v2/role_definitions/${roleId}/`, {
      id: roleId,
      permissions,
    });
  }

  it('renders activations and starts a new activation', () => {
    cy.intercept('GET', '/api/v2/eda/activations/?order_by=name&page=1&page_size=10', {
      count: 1,
      next: null,
      previous: null,
      results: [activation],
    }).as('activations');
    cy.intercept('POST', '/api/v2/eda/activations/start/', {
      source: 'eda_controller',
      activation,
      actions: ['created', 'started'],
      events: [],
    }).as('startActivation');

    cy.mount(<EdaActivations />, {
      path: '/eda/activations',
      initialEntries: ['/eda/activations'],
    });

    cy.verifyPageTitle('EDA Activations');
    cy.contains('Restart web on alert').should('be.visible');
    cy.contains('restart-web.yml').should('be.visible');
    cy.contains('button', 'Create/start activation').click();
    cy.get('#eda-rulebook-name').type('restart-web.yml');
    cy.contains('button', /^Start$/).click();
    cy.wait('@startActivation');
  });

  it('renders activation detail events and restart action', () => {
    cy.intercept('GET', '/api/v2/eda/activations/42/', activation).as('activation');
    cy.intercept('GET', '/api/v2/eda/activations/42/events/?page_size=50', {
      count: 1,
      next: null,
      previous: null,
      results: [
        {
          id: 9,
          event_type: 'rule',
          status: 'ok',
          rule: 'restart',
          message: 'activation started',
          created: '2026-06-01T12:00:01Z',
        },
      ],
    }).as('events');
    cy.intercept('POST', '/api/v2/eda/activations/42/restart/', {
      source: 'eda_controller',
      activation,
      actions: ['restart'],
    }).as('restartActivation');

    cy.mount(<EdaActivationPage />, {
      path: '/eda/activations/:id',
      initialEntries: ['/eda/activations/42'],
    });

    cy.verifyPageTitle('Restart web on alert');
    cy.contains('Activation events').should('be.visible');
    cy.contains('activation started').should('be.visible');
    cy.contains('button', /^Restart$/).click();
    cy.wait('@restartActivation');
  });

  it('lets EDA operators operate existing activations without delete or create-by-rulebook access', () => {
    interceptEdaRoleDefinitions(33, 54, [
      'shared.view_edaactivation',
      'shared.execute_edaactivation',
    ]);
    cy.intercept('GET', '/api/v2/eda/activations/?order_by=name&page=1&page_size=10', {
      count: 1,
      next: null,
      previous: null,
      results: [activation],
    }).as('activations');
    cy.intercept('POST', '/api/v2/eda/activations/start/', {
      source: 'eda_controller',
      activation,
      actions: ['started'],
      events: [],
    }).as('startActivation');

    cy.mount(
      <EdaActivations />,
      {
        path: '/eda/activations',
        initialEntries: ['/eda/activations'],
      },
      'activeUserEdaOperator.json'
    );

    cy.verifyPageTitle('EDA Activations');
    cy.contains('button', 'Create/start activation').click();
    cy.get('#eda-rulebook-name').should('be.disabled');
    cy.contains('button', /^Start$/).should('be.disabled');
    cy.get('#eda-activation-id').type('42');
    cy.contains('button', /^Start$/).click();
    cy.wait('@startActivation')
      .its('request.body')
      .then((body: { activation_id: string; rulebook_name: string }) => {
        expect(body.activation_id).to.equal('42');
        expect(body.rulebook_name).to.equal('');
      });
  });

  it('lets EDA administrators create activations by rulebook', () => {
    interceptEdaRoleDefinitions(34, 55, [
      'shared.view_edaactivation',
      'shared.execute_edaactivation',
      'shared.change_edaactivation',
    ]);
    cy.intercept('GET', '/api/v2/eda/activations/?order_by=name&page=1&page_size=10', {
      count: 0,
      next: null,
      previous: null,
      results: [],
    });
    cy.intercept('POST', '/api/v2/eda/activations/start/', {
      source: 'eda_controller',
      activation,
      actions: ['created', 'started'],
      events: [],
    }).as('startActivation');

    cy.mount(
      <EdaActivations />,
      {
        path: '/eda/activations',
        initialEntries: ['/eda/activations'],
      },
      'activeUserEdaAdmin.json'
    );

    cy.contains('button', 'Create/start activation').click();
    cy.get('#eda-rulebook-name').should('not.be.disabled').type('restart-web.yml');
    cy.contains('button', /^Start$/).click();
    cy.wait('@startActivation')
      .its('request.body')
      .then((body: { rulebook_name: string }) => {
        expect(body.rulebook_name).to.equal('restart-web.yml');
      });
  });
});
