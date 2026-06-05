import { awxAPI } from '../../common/api/awx-utils';
import { AwxRbacRole } from '../../interfaces/AwxRbacRole';
import mockAwxBuiltInRole from '../../../../cypress/fixtures/awxBuiltInRoleDefinition.json';
import { CloneRole, CreateRole } from './RoleForm';

describe('AwxRoleForm', () => {
  it('sends catalog item permissions when creating a custom role', () => {
    cy.intercept('POST', awxAPI`/role_definitions/`, {
      statusCode: 201,
      body: {
        id: 101,
        name: 'Catalog item launcher',
        content_type: 'awx.catalogitem',
        permissions: ['awx.use_catalogitem', 'awx.view_catalogitem'],
      },
    }).as('createRole');

    cy.mount(<CreateRole />);
    cy.get('[data-cy="name"]').type('Catalog item launcher');
    cy.get('[data-cy="description"]').type('Can deploy catalog items');
    cy.selectDropdownOptionByResourceName('content-type', 'Catalog item');
    cy.get('#permissions').click();
    cy.selectMultiSelectOption('#permissions-select', 'Use catalog item');
    cy.selectMultiSelectOption('#permissions-select', 'View catalog item');
    cy.clickButton(/^Create role$/);

    cy.wait('@createRole')
      .its('request.body')
      .then((role: AwxRbacRole) => {
        expect(role.name).to.equal('Catalog item launcher');
        expect(role.description).to.equal('Can deploy catalog items');
        expect(role.content_type).to.equal('awx.catalogitem');
        expect(role.permissions).to.deep.equal(['awx.use_catalogitem', 'awx.view_catalogitem']);
      });
  });

  it('sends cloud provider connection permissions when creating a custom role', () => {
    cy.intercept('POST', awxAPI`/role_definitions/`, {
      statusCode: 201,
      body: {
        id: 103,
        name: 'Cloud connection operator',
        content_type: 'awx.cloudproviderconnection',
        permissions: ['awx.view_cloudproviderconnection', 'awx.change_cloudproviderconnection'],
      },
    }).as('createCloudRole');

    cy.mount(<CreateRole />);
    cy.get('[data-cy="name"]').type('Cloud connection operator');
    cy.get('[data-cy="description"]').type('Can operate cloud connections');
    cy.selectDropdownOptionByResourceName('content-type', 'Cloud provider connection');
    cy.get('#permissions').click();
    cy.selectMultiSelectOption('#permissions-select', 'View cloud provider connection');
    cy.selectMultiSelectOption('#permissions-select', 'Change cloud provider connection');
    cy.clickButton(/^Create role$/);

    cy.wait('@createCloudRole')
      .its('request.body')
      .then((role: AwxRbacRole) => {
        expect(role.name).to.equal('Cloud connection operator');
        expect(role.content_type).to.equal('awx.cloudproviderconnection');
        expect(role.permissions).to.deep.equal([
          'awx.view_cloudproviderconnection',
          'awx.change_cloudproviderconnection',
        ]);
      });
  });

  it('sends policy as code permissions when creating an organization custom role', () => {
    cy.intercept('POST', awxAPI`/role_definitions/`, {
      statusCode: 201,
      body: {
        id: 104,
        name: 'Policy operator',
        content_type: 'shared.organization',
        permissions: ['shared.view_policyascode'],
      },
    }).as('createPolicyRole');

    cy.mount(<CreateRole />);
    cy.get('[data-cy="name"]').type('Policy operator');
    cy.get('[data-cy="description"]').type('Can test policy as code');
    cy.selectDropdownOptionByResourceName('content-type', 'Organization');
    cy.get('#permissions').click();
    cy.selectMultiSelectOption('#permissions-select', 'View Policy as Code');
    cy.clickButton(/^Create role$/);

    cy.wait('@createPolicyRole')
      .its('request.body')
      .then((role: AwxRbacRole) => {
        expect(role.name).to.equal('Policy operator');
        expect(role.content_type).to.equal('shared.organization');
        expect(role.permissions).to.deep.equal(['shared.view_policyascode']);
      });
  });

  it('sends EDA activation permissions when creating an organization custom role', () => {
    cy.intercept('POST', awxAPI`/role_definitions/`, {
      statusCode: 201,
      body: {
        id: 105,
        name: 'EDA operator',
        content_type: 'shared.organization',
        permissions: ['shared.view_edaactivation', 'shared.execute_edaactivation'],
      },
    }).as('createEdaRole');

    cy.mount(<CreateRole />);
    cy.get('[data-cy="name"]').type('EDA operator');
    cy.get('[data-cy="description"]').type('Can operate EDA activations');
    cy.selectDropdownOptionByResourceName('content-type', 'Organization');
    cy.get('#permissions').click();
    cy.selectMultiSelectOption('#permissions-select', 'View EDA activations');
    cy.selectMultiSelectOption('#permissions-select', 'Operate EDA activations');
    cy.clickButton(/^Create role$/);

    cy.wait('@createEdaRole')
      .its('request.body')
      .then((role: AwxRbacRole) => {
        expect(role.name).to.equal('EDA operator');
        expect(role.content_type).to.equal('shared.organization');
        expect(role.permissions).to.deep.equal([
          'shared.view_edaactivation',
          'shared.execute_edaactivation',
        ]);
      });
  });

  it('sends AI resource action permissions when creating an organization custom role', () => {
    cy.intercept('POST', awxAPI`/role_definitions/`, {
      statusCode: 201,
      body: {
        id: 106,
        name: 'AI approver',
        content_type: 'shared.organization',
        permissions: ['shared.view_airesourceaction', 'shared.approve_airesourceaction'],
      },
    }).as('createAiRole');

    cy.mount(<CreateRole />);
    cy.get('[data-cy="name"]').type('AI approver');
    cy.get('[data-cy="description"]').type('Can approve AI resource changes');
    cy.selectDropdownOptionByResourceName('content-type', 'Organization');
    cy.get('#permissions').click();
    cy.selectMultiSelectOption('#permissions-select', 'View AI resource actions');
    cy.selectMultiSelectOption('#permissions-select', 'Approve AI resource actions');
    cy.clickButton(/^Create role$/);

    cy.wait('@createAiRole')
      .its('request.body')
      .then((role: AwxRbacRole) => {
        expect(role.name).to.equal('AI approver');
        expect(role.content_type).to.equal('shared.organization');
        expect(role.permissions).to.deep.equal([
          'shared.view_airesourceaction',
          'shared.approve_airesourceaction',
        ]);
      });
  });

  it('copies a built-in role into a custom role payload', () => {
    cy.intercept('GET', awxAPI`/role_definitions/1/`, mockAwxBuiltInRole);
    cy.intercept('POST', awxAPI`/role_definitions/`, {
      statusCode: 201,
      body: {
        ...mockAwxBuiltInRole,
        id: 102,
        managed: false,
        name: 'Copy of Credential Admin',
      },
    }).as('copyRole');

    cy.mount(<CloneRole />, { path: '/roles/:id/copy', initialEntries: ['/roles/1/copy'] });
    cy.get('[data-cy="name"]').should('have.value', 'Copy of Credential Admin');
    cy.get('[data-cy="content-type-form-group"]').contains('Credential');
    cy.multiSelectShouldHaveSelectedOption('#permissions', 'Use credential');
    cy.clickButton(/^Create role$/);

    cy.wait('@copyRole')
      .its('request.body')
      .then((role: AwxRbacRole) => {
        expect(role.name).to.equal('Copy of Credential Admin');
        expect(role.content_type).to.equal('awx.credential');
        expect(role.permissions).to.deep.equal(mockAwxBuiltInRole.permissions);
        expect(role).not.to.have.property('managed');
      });
  });
});
