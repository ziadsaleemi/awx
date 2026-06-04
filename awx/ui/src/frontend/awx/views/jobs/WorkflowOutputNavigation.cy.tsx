import { WorkflowOutputNavigation } from './WorkflowOutputNavigation';
import jobWorkflowNodesData from '../../../../cypress/fixtures/workflow_nodes.json';
import { WorkflowJobNode } from '../../interfaces/WorkflowNode';

describe('WorkflowOutputNavigation', () => {
  beforeEach(() => {
    cy.intercept(
      {
        method: 'GET',
        url: `/api/v2/workflow_jobs/*/workflow_nodes/*`,
        hostname: 'localhost',
      },
      {
        fixture: 'workflow_nodes.json',
      }
    );
  });
  it('WorkflowOutputNavigation should filter wf nodes', () => {
    cy.mount(
      <WorkflowOutputNavigation
        workflowNodes={jobWorkflowNodesData.results as unknown as WorkflowJobNode[]}
      />
    );
    cy.contains('Workflow Job 1/6').click();

    cy.contains('Workflow statuses');
    cy.contains('Failed');
    cy.contains('Successful');

    cy.contains('Workflow nodes');

    cy.getByDataCy('workflow-nodes').contains('Fail');
    cy.getByDataCy('workflow-nodes').contains('Chatty Payload');
    cy.getByDataCy('workflow-nodes').contains('Debug Loop');

    cy.clickButton('Failed');
    cy.getByDataCy('workflow-nodes').contains('Fail');
    cy.getByDataCy('workflow-nodes').contains('Chatty Payload').should('not.exist');
    cy.getByDataCy('workflow-nodes').contains('Debug Loop').should('not.exist');

    cy.clickButton('Successful');
    cy.getByDataCy('workflow-nodes').contains('Fail').should('not.exist');
    cy.getByDataCy('workflow-nodes').contains('Chatty Payload');
    cy.getByDataCy('workflow-nodes').contains('Debug Loop');

    cy.clickButton('Successful');
    cy.getByDataCy('workflow-nodes').contains('Fail');
  });

  it('WorkflowOutputNavigation should show virtual EDA nodes without job links', () => {
    const workflowNodes = [
      ...jobWorkflowNodesData.results,
      {
        ...jobWorkflowNodesData.results[0],
        id: 9001,
        job: null,
        unified_job_template: null,
        identifier: 'Restart web on alert',
        node_type: 'eda_rulebook',
        summary_fields: {
          ...jobWorkflowNodesData.results[0].summary_fields,
          job: undefined,
          unified_job_template: undefined,
          eda_rulebook: {
            name: 'Restart web on alert',
            event_source_status: 'running',
            status: 'successful',
          },
        },
      },
    ];

    cy.mount(
      <WorkflowOutputNavigation workflowNodes={workflowNodes as unknown as WorkflowJobNode[]} />
    );
    cy.contains('Workflow Job 1/7').click();
    cy.getByDataCy('workflow-nodes').contains('Restart web on alert');
    cy.getByDataCy('workflow-nodes')
      .contains('Restart web on alert')
      .should('not.have.attr', 'href');

    cy.clickButton('Successful');
    cy.getByDataCy('workflow-nodes').contains('Restart web on alert');
  });
});
