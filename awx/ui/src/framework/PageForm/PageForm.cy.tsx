/* eslint-disable i18next/no-literal-string */
import { PageSettingsContext } from '../PageSettings/PageSettingsProvider';
import { PageForm } from './PageForm';

describe('PageForm', () => {
  it('uses the available width for multi-column forms on ultrawide screens', () => {
    cy.viewport(3440, 1440);
    cy.mount(
      <PageSettingsContext.Provider
        value={[
          { formColumns: 'multiple', formLayout: 'vertical' },
          () => undefined,
          () => undefined,
        ]}
      >
        <PageForm submitText="Save" onSubmit={() => Promise.resolve()}>
          <div>First field</div>
          <div>Second field</div>
          <div>Third field</div>
        </PageForm>
      </PageSettingsContext.Provider>
    );

    cy.getByDataCy('page-form-content')
      .should('not.have.class', 'pf-m-limit-width')
      .find('.pf-v5-l-grid')
      .then(($grid) => {
        expect($grid[0].getBoundingClientRect().width).to.be.greaterThan(3200);
      });
  });

  it('keeps single-column forms width limited for readability', () => {
    cy.viewport(3440, 1440);
    cy.mount(
      <PageSettingsContext.Provider
        value={[
          { formColumns: 'single', formLayout: 'vertical' },
          () => undefined,
          () => undefined,
        ]}
      >
        <PageForm submitText="Save" onSubmit={() => Promise.resolve()}>
          <div>Single field</div>
        </PageForm>
      </PageSettingsContext.Provider>
    );

    cy.getByDataCy('page-form-content')
      .should('have.class', 'pf-m-limit-width')
      .then(($content) => {
        expect($content[0].getBoundingClientRect().width).to.be.at.most(880);
      });
  });
});
