/* eslint-disable i18next/no-literal-string */
import { useState } from 'react';
import { PageActionSelection, PageActionType } from './PageAction';
import { PageActionButton } from './PageActionButton';

function TooltipNavigationHarness() {
  const [showAction, setShowAction] = useState(true);

  return (
    <>
      <button data-cy="back" onClick={() => setShowAction(false)}>
        Back
      </button>
      {showAction ? (
        <PageActionButton
          action={{
            type: PageActionType.Button,
            selection: PageActionSelection.None,
            label: 'Edit credential type',
            isDisabled: 'The credential type cannot be edited because it is read-only.',
            onClick: () => undefined,
          }}
        />
      ) : null}
    </>
  );
}

describe('PageActionButton', () => {
  it('does not create a tooltip when the action has no tooltip content', () => {
    cy.mount(
      <PageActionButton
        action={{
          type: PageActionType.Button,
          selection: PageActionSelection.None,
          label: 'Refresh',
          onClick: () => undefined,
        }}
      />
    );

    cy.getByDataCy('refresh').trigger('mouseenter');
    cy.get('[role="tooltip"]').should('not.exist');
  });

  it('unmounts a visible disabled-action tooltip during navigation', () => {
    cy.mount(<TooltipNavigationHarness />);

    cy.get('[data-cy="edit-credential-type"]').trigger('mouseenter');
    cy.contains('The credential type cannot be edited because it is read-only.').should(
      'be.visible'
    );
    cy.getByDataCy('back').click();
    cy.contains('The credential type cannot be edited because it is read-only.').should(
      'not.exist'
    );
  });
});
