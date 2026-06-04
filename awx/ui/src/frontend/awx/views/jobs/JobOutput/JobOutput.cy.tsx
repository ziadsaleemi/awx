import job from '../../../../../cypress/fixtures/job.json';
import type { AIAssistantContextPayload } from '../../../common/AIAssistant';
import type { Job } from '../../../interfaces/Job';
import { JobOutputInner as JobOutput } from './JobOutput';

describe('JobOutput.cy.tsx', () => {
  beforeEach(() => {
    cy.intercept('GET', '/api/v2/ai/settings/', {
      enabled: true,
      provider: 'openai',
      model: 'gpt-4o',
      configured: true,
    });
    cy.intercept(
      {
        method: 'GET',
        url: '/api/v2/jobs/26/job_events/?order_by=counter&page=1&page_size=50',
        hostname: 'localhost',
      },
      {
        fixture: 'jobEvents.json',
      }
    );
    cy.intercept(
      {
        method: 'GET',
        url: '/api/v2/jobs/26/job_events/children_summary/',
        hostname: 'localhost',
      },
      {
        fixture: 'jobChildrenSummary.json',
      }
    ).as('childrenSummary');
  });

  it('renders job output', () => {
    cy.mount(<JobOutput job={job as unknown as Job} reloadJob={() => null} />);
    cy.get('h1').should('have.text', 'Demo Job Template');
    cy.get('.output-grid').find('.output-grid-row').should('have.length', 13);
  });

  it('collapses play output', () => {
    cy.mount(<JobOutput job={job as unknown as Job} reloadJob={() => null} />);
    cy.get('.output-grid').find('.output-grid-row').should('have.length', 13);
    cy.wait('@childrenSummary');
    cy.get('.output-grid').find('button > svg').first().click();
    cy.get('.output-grid').find('.output-grid-row').should('have.length', 5);
  });

  it('opens AI assistant with job output context', () => {
    const contextEvents: CustomEvent<AIAssistantContextPayload>[] = [];
    cy.window().then((win) => {
      win.addEventListener('awx-ai-assistant-context', (event) => {
        contextEvents.push(event as CustomEvent<AIAssistantContextPayload>);
      });
    });

    cy.mount(<JobOutput job={job as unknown as Job} reloadJob={() => null} />);
    cy.getByDataCy('job-output-ai-assistant')
      .should('have.attr', 'aria-label', 'Ask assistant about this output')
      .and('not.contain.text', 'AI')
      .click();

    cy.wrap(contextEvents).should('have.length', 1);
    cy.wrap(contextEvents).then(([event]) => {
      expect(event.detail).to.include({
        source: 'job_output',
        job_id: 26,
        job_type: 'job',
        job_status: 'successful',
        job_name: 'Demo Job Template',
      });
      expect(event.detail.prompt).to.contain('Use this job output');
    });
  });
});
