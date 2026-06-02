import { WorkflowOutput } from './WorkflowOutput';
import job from '../../../../../cypress/fixtures/workflow_job.json';
import workflowNodes from '../../../../../cypress/fixtures/workflow_nodes.json';
import { Job } from '../../../interfaces/Job';
describe('Workflow Output', () => {
  before(() => {
    cy.intercept(
      {
        method: 'GET',
        url: `/api/v2/workflow_jobs/126/*`,
        hostname: 'localhost',
      },
      {
        fixture: 'workflow_job.json',
      }
    );
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
  it('should mount with correct number of nodes', () => {
    cy.mount(
      <WorkflowOutput
        job={job as unknown as Job}
        reloadJob={() => null}
        refreshNodeStatus={() => null}
      />
    );
    cy.get('g[data-kind="node"]').should('have.length', workflowNodes.results.length + 1); // The +1 accounts for the start node
  });
  it('should show status icon, and elapsed time label', () => {
    cy.mount(
      <WorkflowOutput
        job={job as unknown as Job}
        reloadJob={() => null}
        refreshNodeStatus={() => null}
      />
    );
    cy.get('g[data-type="failed-node"]').each((outterNode) => {
      cy.wrap(outterNode).within((node) => {
        cy.get('text').should('have.text', `${node.text()}`);
        cy.wrap(node).get('svg[data-cy="failed-icon"]').should('be.exist');
        return;
      });
    });
    cy.get('g[data-type="successful-node"]').each((node) => {
      cy.wrap(node).within((node) => {
        cy.get('svg[data-cy="successful-icon"]').should('be.exist');
        cy.get('text').should('have.text', `${node.text()}`);
      });
    });
  });

  it('should show and apply waiting AI workflow plans', () => {
    const aiNode = {
      ...workflowNodes.results[0],
      id: 9002,
      node_type: 'ai_task',
      unified_job_template: null,
      ai_task_prompt: 'Create approved inventory',
      ai_task_model: 'gpt-5.2',
      ai_task_approval_required: true,
      ai_task_status: 'awaiting_approval',
      ai_task_result: {
        status: 'awaiting_approval',
        resource_action: {
          mode: 'preview',
          can_apply: true,
        },
      },
      related: {
        ...workflowNodes.results[0].related,
        apply_ai_plan: '/api/v2/workflow_job_nodes/9002/apply_ai_plan/',
      },
      summary_fields: {
        ...workflowNodes.results[0].summary_fields,
        unified_job_template: undefined,
        job: undefined,
        ai_task: {
          prompt: 'Create approved inventory',
          model: 'gpt-5.2',
          approval_required: true,
          status: 'awaiting_approval',
        },
      },
      success_nodes: [],
      failure_nodes: [],
      always_nodes: [],
    };
    cy.intercept(
      {
        method: 'GET',
        url: `/api/v2/workflow_jobs/*/workflow_nodes/*`,
        hostname: 'localhost',
      },
      {
        body: {
          count: 1,
          next: null,
          previous: null,
          results: [aiNode],
        },
      }
    ).as('getAiWorkflowNodes');
    cy.intercept('POST', '/api/v2/workflow_job_nodes/9002/apply_ai_plan/', {
      body: {
        ...aiNode,
        ai_task_status: 'applied',
        related: {
          ...aiNode.related,
          apply_ai_plan: undefined,
        },
        ai_resource_action: {
          mode: 'apply',
          can_apply: true,
        },
      },
    }).as('applyAiPlan');

    cy.mount(
      <WorkflowOutput
        job={job as unknown as Job}
        reloadJob={() => null}
        refreshNodeStatus={() => null}
      />
    );
    cy.wait('@getAiWorkflowNodes');
    cy.get('[data-cy="workflow-ai-plan-approval"]').should(
      'contain.text',
      'Create approved inventory'
    );
    cy.get('[data-cy="workflow-ai-plan-apply"]').click();
    cy.wait('@applyAiPlan');
  });
});
