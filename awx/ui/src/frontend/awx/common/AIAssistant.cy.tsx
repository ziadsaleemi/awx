import { ReactNode, useEffect } from 'react';
import { PageNavigationItem } from '../../../framework';
import { usePageNavigationRoutesContext } from '../../../framework/PageNavigation/PageNavigationRoutesProvider';
import { AwxRoute } from '../main/AwxRoutes';
import { AIAssistantPanel } from './AIAssistant';

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

    cy.getByDataCy('ai-resource-audit-link')
      .should('contain.text', 'View Activity Stream #701')
      .and('have.attr', 'href', '/activity-stream?id=701');
    cy.getByDataCy('ai-resource-object-link-create-inventory')
      .should('contain.text', 'View AI Managed Inventory')
      .and('have.attr', 'href', '/inventories/inventory/42/details');
    cy.getByDataCy('ai-resource-object-link-create-smart-inventory')
      .should('contain.text', 'View AI Smart Web Inventory')
      .and('have.attr', 'href', '/inventories/smart_inventory/43/details');
    cy.getByDataCy('ai-resource-preview-summary-create-smart-inventory')
      .should('contain.text', 'Matched hosts: 1 (web01)')
      .and('contain.text', 'Matched groups: 1 (webservers)');
    cy.getByDataCy('ai-resource-object-link-create-constructed-inventory')
      .should('contain.text', 'View AI Constructed Inventory')
      .and('have.attr', 'href', '/inventories/constructed_inventory/44/details');
    cy.getByDataCy('ai-resource-preview-summary-create-constructed-inventory')
      .should('contain.text', 'Input inventories: 1 (AI Managed Inventory)')
      .and('contain.text', 'Source hosts: 2 (web01, db01)')
      .and('contain.text', 'Source groups: 1 (webservers)')
      .and('contain.text', 'Source vars keys: compose, groups');
    cy.getByDataCy('ai-resource-object-link-create-project')
      .should('contain.text', 'View AI Content Project')
      .and('have.attr', 'href', '/projects/51/details');
    cy.getByDataCy('ai-resource-object-link-create-job-template')
      .should('contain.text', 'View AI Generated Template')
      .and('have.attr', 'href', '/templates/job-template/61/details');
    cy.getByDataCy('ai-resource-launch-link-create-job-template')
      .should('contain.text', 'Launch job template')
      .and('have.attr', 'href', '/templates/job-template/61/launch');
    cy.getByDataCy('ai-resource-object-link-create-workflow-template')
      .should('contain.text', 'View AI Generated Workflow')
      .and('have.attr', 'href', '/templates/workflow-job-template/71/details');
    cy.getByDataCy('ai-resource-launch-link-create-workflow-template')
      .should('contain.text', 'Launch workflow template')
      .and('have.attr', 'href', '/templates/workflow-job-template/71/launch');
    cy.getByDataCy('ai-resource-rollback-plan').should('contain.text', 'delete-inventory');
    cy.contains('button', 'Apply rollback').click();
    cy.wait('@applyResourceAction');
    cy.getByDataCy('ai-resource-audit-link')
      .should('contain.text', 'View Activity Stream #702')
      .and('have.attr', 'href', '/activity-stream?id=702');
    cy.getByDataCy('ai-resource-plan').should('contain.text', 'delete inventory #42');
    cy.contains('button', 'Apply rollback').should('not.exist');
  });
});
