import { ReactNode, useEffect } from 'react';
import { PageNavigationItem } from '../../../framework';
import { usePageNavigationRoutesContext } from '../../../framework/PageNavigation/PageNavigationRoutesProvider';
import { AwxRoute } from '../main/AwxRoutes';
import { AIAssistantButton, AIAssistantPanel } from './AIAssistant';

function SeedNavigation(props: { children: ReactNode }) {
  const [, setNavigation] = usePageNavigationRoutesContext();
  useEffect(() => {
    setNavigation([
      {
        id: AwxRoute.ActivityStream,
        path: 'activity-stream',
        element: <div />,
      } as PageNavigationItem,
      {
        id: AwxRoute.InventoryDetails,
        path: 'inventories/:inventory_type/:id/details',
        element: <div />,
      } as PageNavigationItem,
      {
        id: AwxRoute.ProjectDetails,
        path: 'projects/:id/details',
        element: <div />,
      } as PageNavigationItem,
      {
        id: AwxRoute.JobTemplateDetails,
        path: 'templates/job-template/:id/details',
        element: <div />,
      } as PageNavigationItem,
      {
        id: AwxRoute.TemplateLaunchWizard,
        path: 'templates/job-template/:id/launch',
        element: <div />,
      } as PageNavigationItem,
      {
        id: AwxRoute.WorkflowJobTemplateDetails,
        path: 'templates/workflow-job-template/:id/details',
        element: <div />,
      } as PageNavigationItem,
      {
        id: AwxRoute.WorkflowJobTemplateLaunchWizard,
        path: 'templates/workflow-job-template/:id/launch',
        element: <div />,
      } as PageNavigationItem,
    ]);
  }, [setNavigation]);
  return <>{props.children}</>;
}

function mountAssistant() {
  cy.mount(
    <SeedNavigation>
      <AIAssistantPanel isOpen onClose={() => undefined} />
    </SeedNavigation>
  );
}

describe('AIAssistantPanel', () => {
  it('uses an icon-only masthead assistant button', () => {
    cy.mount(<AIAssistantButton isActive={false} onClick={() => undefined} />);

    cy.getByDataCy('masthead-ai-assistant')
      .should('have.attr', 'aria-label', 'AI Assistant')
      .and('not.contain.text', 'AI');
  });

  it('uses a wider desktop panel without exceeding the viewport', () => {
    cy.viewport(1440, 900);
    mountAssistant();

    cy.window().then((win) => {
      cy.getByDataCy('ai-assistant-panel').then(($panel) => {
        const rect = $panel[0].getBoundingClientRect();
        expect(rect.width).to.be.closeTo(720, 1);
        expect(rect.right).to.be.closeTo(win.innerWidth, 1);
        expect(rect.bottom).to.be.closeTo(win.innerHeight, 1);
      });
    });
  });

  it('keeps the assistant panel inside a mobile viewport', () => {
    cy.viewport(390, 760);
    mountAssistant();

    cy.window().then((win) => {
      cy.getByDataCy('ai-assistant-panel').then(($panel) => {
        const rect = $panel[0].getBoundingClientRect();
        expect(rect.left).to.be.gte(8);
        expect(rect.right).to.be.lte(win.innerWidth - 8);
        expect(rect.top).to.be.closeTo(64, 1);
        expect(rect.bottom).to.be.lte(win.innerHeight - 8);
      });
    });
  });

  it('spaces assistant action buttons', () => {
    mountAssistant();

    cy.contains('button', 'Send').then(($send) => {
      cy.contains('button', 'Plan changes').then(($plan) => {
        const sendRect = $send[0].getBoundingClientRect();
        const planRect = $plan[0].getBoundingClientRect();
        expect(planRect.left - sendRect.right).to.be.gte(8);
      });
    });
  });

  it('renders assistant markdown answers as formatted content', () => {
    cy.intercept('POST', '/api/v2/ai/chat/', {
      message: {
        role: 'assistant',
        content: '**AWX host summary**\n\n- web01\n- db01\n\nUse `Resources > Hosts` for details.',
      },
      model: 'awx',
      provider: 'awx',
    }).as('chat');

    mountAssistant();

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

  it('sends opened page context with chat messages', () => {
    cy.intercept('POST', '/api/v2/ai/chat/', (req) => {
      const body = req.body as {
        messages?: { role: string; content: string }[];
        context?: { source?: string; job_id?: number; path?: string };
      };
      expect(body.messages?.[0]).to.deep.include({
        role: 'user',
        content: 'Explain this job output',
      });
      expect(body.context).to.include({
        source: 'job_output',
        job_id: 26,
      });
      expect(body.context?.path).to.be.a('string');
      req.reply({
        message: { role: 'assistant', content: 'Use the failed task output.' },
        model: 'awx',
        provider: 'awx',
      });
    }).as('chatWithContext');

    mountAssistant();

    cy.window().then((win) => {
      win.dispatchEvent(
        new CustomEvent('awx-ai-assistant-context', {
          detail: {
            source: 'job_output',
            job_id: 26,
            prompt: 'Explain this job output',
          },
        })
      );
    });

    cy.contains('button', 'Send').click();
    cy.wait('@chatWithContext');
  });

  it('uses pasted JSON plans directly for preview', () => {
    const plan = {
      name: 'Pasted AI plan',
      operations: [
        {
          id: 'create-inventory',
          operation: 'create',
          resource_type: 'inventory',
          data: { name: 'AI Pasted Inventory', organization: 1 },
        },
      ],
    };

    cy.intercept('POST', '/api/v2/ai/resource_actions/', (req) => {
      const body = req.body as { mode?: string; prompt?: unknown; plan?: typeof plan };
      expect(body.mode).to.equal('preview');
      expect(body.prompt).to.equal(undefined);
      expect(body.plan).to.deep.equal(plan);
      req.alias = 'previewPastedPlan';
      req.reply({
        mode: 'preview',
        generated: false,
        plan,
        operations: [
          {
            id: 'create-inventory',
            operation: 'create',
            resource_type: 'inventory',
            valid: true,
            errors: {},
            data: { name: 'AI Pasted Inventory', organization: 1 },
            validated_data: { name: 'AI Pasted Inventory', organization: 1 },
            preview: { type: 'inventory', name: 'AI Pasted Inventory' },
          },
        ],
        can_apply: true,
      });
    });

    mountAssistant();

    cy.get('textarea[aria-label="Message"]').type(JSON.stringify(plan), {
      parseSpecialCharSequences: false,
    });
    cy.getByDataCy('ai-resource-plan-button').click();
    cy.wait('@previewPastedPlan');

    cy.getByDataCy('ai-resource-plan')
      .should('contain.text', 'Pasted AI plan')
      .and('contain.text', 'create inventory');
  });

  it('links applied resource plans to their Activity Stream audit event', () => {
    let calls = 0;

    cy.intercept('POST', '/api/v2/ai/resource_actions/', (req) => {
      calls += 1;
      const body = req.body as {
        mode?: string;
        context?: { rollback_for_activity_stream_id?: number; source?: string };
        plan?: {
          operations?: { operation?: string; resource_type?: string; object_id?: number }[];
        };
      };

      if (calls === 1) {
        expect(body.mode).to.equal('preview');
        req.alias = 'previewResourceAction';
        req.reply({
          mode: 'preview',
          generated: true,
          plan: {
            name: 'Create AI inventory',
            description: 'Create inventory from assistant prompt.',
            operations: [
              {
                id: 'create-inventory',
                operation: 'create',
                resource_type: 'inventory',
                data: { name: 'AI Managed Inventory', organization: 1 },
              },
            ],
          },
          operations: [
            {
              id: 'create-inventory',
              operation: 'create',
              resource_type: 'inventory',
              valid: true,
              errors: {},
              data: { name: 'AI Managed Inventory', organization: 1 },
              validated_data: { name: 'AI Managed Inventory', organization: 1 },
              preview: { type: 'inventory', name: 'AI Managed Inventory' },
            },
          ],
          can_apply: true,
        });
        return;
      }

      if (calls === 2) {
        expect(body.mode).to.equal('apply');
        req.alias = 'applyResourceAction';
        req.reply({
          mode: 'apply',
          generated: false,
          plan: {
            name: 'Create AI inventory',
            description: 'Create inventory from assistant prompt.',
            operations: [
              {
                id: 'create-inventory',
                operation: 'create',
                resource_type: 'inventory',
                data: { name: 'AI Managed Inventory', organization: 1 },
              },
            ],
          },
          operations: [
            {
              id: 'create-inventory',
              operation: 'create',
              resource_type: 'inventory',
              valid: true,
              errors: {},
              object_id: 42,
              object: { id: 42, name: 'AI Managed Inventory', kind: '' },
            },
            {
              id: 'create-smart-inventory',
              operation: 'create',
              resource_type: 'smart_inventory',
              valid: true,
              errors: {},
              object_id: 43,
              object: { id: 43, name: 'AI Smart Web Inventory', kind: 'smart' },
              preview: {
                type: 'smart_inventory',
                matched_hosts_count: 1,
                matched_hosts: [{ id: 10, name: 'web01' }],
                matched_groups_count: 1,
                matched_groups: [{ id: 20, name: 'webservers' }],
              },
            },
            {
              id: 'create-constructed-inventory',
              operation: 'create',
              resource_type: 'constructed_inventory',
              valid: true,
              errors: {},
              object_id: 44,
              object: { id: 44, name: 'AI Constructed Inventory', kind: 'constructed' },
              preview: {
                type: 'constructed_inventory',
                input_inventories_count: 1,
                input_inventories: [{ id: 42, name: 'AI Managed Inventory' }],
                source_hosts_count: 2,
                source_hosts: [
                  { id: 10, name: 'web01' },
                  { id: 11, name: 'db01' },
                ],
                source_groups_count: 1,
                source_groups: [{ id: 20, name: 'webservers' }],
                source_vars_keys: ['compose', 'groups'],
              },
            },
            {
              id: 'create-project',
              operation: 'create',
              resource_type: 'project',
              valid: true,
              errors: {},
              object_id: 51,
              object: { id: 51, name: 'AI Content Project' },
            },
            {
              id: 'write-playbook',
              operation: 'create',
              resource_type: 'project_file',
              valid: true,
              errors: {},
              object_id: 51,
              project_id: 51,
              path: 'playbooks/site.yml',
              content_bytes: 86,
              object: {
                project: 51,
                project_name: 'AI Content Project',
                path: 'playbooks/site.yml',
                content_bytes: 86,
              },
              validated_data: {
                project: 51,
                path: 'playbooks/site.yml',
                content_bytes: 86,
                overwrite: false,
              },
              preview: {
                type: 'project_file',
                project: 51,
                path: 'playbooks/site.yml',
                content_bytes: 86,
                will_create: true,
                will_overwrite: false,
                will_delete: false,
              },
            },
            {
              id: 'create-job-template',
              operation: 'create',
              resource_type: 'job_template',
              valid: true,
              errors: {},
              object_id: 61,
              object: { id: 61, name: 'AI Generated Template' },
            },
            {
              id: 'create-workflow-template',
              operation: 'create',
              resource_type: 'workflow_job_template',
              valid: true,
              errors: {},
              object_id: 71,
              object: { id: 71, name: 'AI Generated Workflow' },
            },
          ],
          rollback_plan: {
            name: 'Rollback Create AI inventory',
            operations: [
              {
                id: 'delete-inventory',
                operation: 'delete',
                resource_type: 'inventory',
                object_id: 42,
              },
            ],
          },
          can_apply: false,
          audit: { activity_stream_id: 701 },
        });
        return;
      }

      expect(body.mode).to.equal('apply');
      expect(body.context?.source).to.equal('ai_assistant_rollback');
      expect(body.context?.rollback_for_activity_stream_id).to.equal(701);
      expect(body.plan?.operations?.[0]).to.include({
        operation: 'delete',
        resource_type: 'inventory',
        object_id: 42,
      });
      req.alias = 'applyResourceAction';
      req.reply({
        mode: 'apply',
        generated: false,
        plan: {
          name: 'Rollback Create AI inventory',
          operations: [
            {
              id: 'delete-inventory',
              operation: 'delete',
              resource_type: 'inventory',
              object_id: 42,
            },
          ],
        },
        operations: [
          {
            id: 'delete-playbook',
            operation: 'delete',
            resource_type: 'project_file',
            valid: true,
            errors: {},
            object_id: 51,
            project_id: 51,
            path: 'playbooks/site.yml',
            object: {
              project: 51,
              project_name: 'AI Content Project',
              path: 'playbooks/site.yml',
              deleted: true,
            },
          },
          {
            id: 'delete-inventory',
            operation: 'delete',
            resource_type: 'inventory',
            valid: true,
            errors: {},
            object_id: 42,
            object: { id: 42, name: 'AI Managed Inventory', deleted: true },
          },
        ],
        can_apply: true,
        audit: { activity_stream_id: 702 },
      });
    });

    mountAssistant();

    cy.get('textarea[aria-label="Message"]').type('create an inventory named AI Managed Inventory');
    cy.getByDataCy('ai-resource-plan-button').click();
    cy.wait('@previewResourceAction');
    cy.getByDataCy('ai-resource-plan-apply').click();
    cy.wait('@applyResourceAction');

    cy.get('[data-cy="ai-resource-audit-link"]')
      .should('contain.text', 'View Activity Stream #701')
      .and('have.attr', 'href', '/activity-stream?id=701');
    cy.get('[data-cy="ai-resource-object-link-create-inventory"]')
      .should('contain.text', 'View AI Managed Inventory')
      .and('have.attr', 'href', '/inventories/inventory/42/details');
    cy.get('[data-cy="ai-resource-object-link-create-smart-inventory"]')
      .should('contain.text', 'View AI Smart Web Inventory')
      .and('have.attr', 'href', '/inventories/smart_inventory/43/details');
    cy.get('[data-cy="ai-resource-preview-summary-create-smart-inventory"]')
      .should('contain.text', 'Matched hosts: 1 (web01)')
      .and('contain.text', 'Matched groups: 1 (webservers)');
    cy.get('[data-cy="ai-resource-object-link-create-constructed-inventory"]')
      .should('contain.text', 'View AI Constructed Inventory')
      .and('have.attr', 'href', '/inventories/constructed_inventory/44/details');
    cy.get('[data-cy="ai-resource-preview-summary-create-constructed-inventory"]')
      .should('contain.text', 'Input inventories: 1 (AI Managed Inventory)')
      .and('contain.text', 'Source hosts: 2 (web01, db01)')
      .and('contain.text', 'Source groups: 1 (webservers)')
      .and('contain.text', 'Source vars keys: compose, groups');
    cy.get('[data-cy="ai-resource-object-link-create-project"]')
      .should('contain.text', 'View AI Content Project')
      .and('have.attr', 'href', '/projects/51/details');
    cy.get('[data-cy="ai-resource-project-file-link-write-playbook"]')
      .should('contain.text', 'View project file: playbooks/site.yml')
      .and('have.attr', 'href', '/projects/51/details');
    cy.get('[data-cy="ai-resource-project-file-summary-write-playbook"]')
      .should('contain.text', 'Project file: playbooks/site.yml')
      .and('contain.text', 'Content bytes: 86');
    cy.get('[data-cy="ai-resource-preview-summary-write-playbook"]')
      .should('contain.text', 'Project file: playbooks/site.yml')
      .and('contain.text', 'Content bytes: 86')
      .and('contain.text', 'Change: create');
    cy.get('[data-cy="ai-resource-object-link-create-job-template"]')
      .should('contain.text', 'View AI Generated Template')
      .and('have.attr', 'href', '/templates/job-template/61/details');
    cy.get('[data-cy="ai-resource-launch-link-create-job-template"]')
      .should('contain.text', 'Launch job template')
      .and('have.attr', 'href', '/templates/job-template/61/launch');
    cy.get('[data-cy="ai-resource-object-link-create-workflow-template"]')
      .should('contain.text', 'View AI Generated Workflow')
      .and('have.attr', 'href', '/templates/workflow-job-template/71/details');
    cy.get('[data-cy="ai-resource-launch-link-create-workflow-template"]')
      .should('contain.text', 'Launch workflow template')
      .and('have.attr', 'href', '/templates/workflow-job-template/71/launch');
    cy.get('[data-cy="ai-resource-rollback-plan"]').should('contain.text', 'delete-inventory');
    cy.contains('button', 'Apply rollback').click();
    cy.wait('@applyResourceAction');
    cy.get('[data-cy="ai-resource-audit-link"]')
      .should('contain.text', 'View Activity Stream #702')
      .and('have.attr', 'href', '/activity-stream?id=702');
    cy.get('[data-cy="ai-resource-plan"]:visible').should(
      'contain.text',
      'delete project file #51'
    );
    cy.get('[data-cy="ai-resource-project-file-link-delete-playbook"]').should('not.exist');
    cy.get('[data-cy="ai-resource-plan"]:visible').should('contain.text', 'delete inventory #42');
    cy.contains('button', 'Apply rollback').should('not.exist');
  });
});
