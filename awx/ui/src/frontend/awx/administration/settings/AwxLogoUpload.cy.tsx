import { t } from 'i18next';
import { AwxPageForm } from '../../common/AwxPageForm';
import { AwxLogoUpload } from './AwxLogoUpload';

describe('AwxLogoUpload', () => {
  it('loads and submits the persisted header logo size', () => {
    let submitted: Record<string, unknown> | undefined;

    cy.mount(
      <AwxPageForm
        singleColumn
        submitText="Save"
        defaultValue={{ CUSTOM_LOGO: '', CUSTOM_LOGO_SIZE: 64 }}
        onSubmit={(data) => {
          submitted = data;
          return Promise.resolve();
        }}
      >
        <AwxLogoUpload name="CUSTOM_LOGO" sizeName="CUSTOM_LOGO_SIZE" label={t('Custom Logo')} />
      </AwxPageForm>
    );

    cy.getByDataCy('header-logo-size-64')
      .find('button')
      .should('have.attr', 'aria-pressed', 'true');
    cy.getByDataCy('header-logo-size-36').find('button').click();
    cy.contains('button', 'Save').click();

    cy.wrap(null).should(() => {
      expect(submitted?.CUSTOM_LOGO_SIZE).to.equal(36);
    });
  });
});
