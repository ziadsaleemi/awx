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

  it('renders Quay image build output with line numbers', () => {
    const quayJob = {
      id: 308,
      type: 'quay_image_build_job',
      name: 'AWX EE Demo',
      status: 'failed',
      failed: true,
      started: '2026-07-07T03:55:47.688453Z',
      finished: '2026-07-07T04:17:12.970855Z',
      elapsed: 1285.282,
      command_summary: [
        {
          label: 'Build execution environment',
          command: 'ansible-builder build --container-runtime podman',
        },
      ],
      result_stdout:
        'Starting Project Quay image build host.docker.internal:30881/admin/awx-ee-demo:latest\n' +
        'Project: AWX EE Demo\n' +
        'Running command:\n' +
        '  podman build -f ee/Containerfile -t host.docker.internal:30881/admin/awx-ee-demo:latest ee\n' +
        'Error: creating build container: unable to copy from source docker://quay.io/ansible/awx-ee:latest: copying system image from manifest list: writing blob: adding layer with blob "sha256:88d62d30b41a4f29ea7f28739f09e0b7bdea7fa39b593da5347019ac00e92824"/""/"sha256:cdcdb1f603d8c61abe8c7d0de970323dbaa25414b4abe9b7198125836d0d8650": unpacking failed (error: exit status 1; output: potentially insufficient UIDs or GIDs available in user namespace)\n',
    };

    cy.mount(<JobOutput job={quayJob as unknown as Job} reloadJob={() => null} />);
    cy.contains('h1', 'AWX EE Demo');
    cy.get('[aria-label="Build output"]').within(() => {
      cy.getByDataCy('quay-output-line-number').then((lines) => {
        expect([...lines].map((line) => line.textContent?.trim())).to.deep.equal([
          '1',
          '2',
          '3',
          '4',
          '5',
        ]);
      });
      cy.contains('Starting Project Quay image build');
      cy.contains('Project: AWX EE Demo');
      cy.contains('podman build -f ee/Containerfile');
      cy.contains('potentially insufficient UIDs or GIDs available');
      cy.get('[data-cy="quay-output-line"]').each(($line) => {
        expect($line[0].scrollWidth).to.be.at.most($line[0].clientWidth + 1);
      });
    });
  });
});
