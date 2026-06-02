/* eslint-disable i18next/no-literal-string */
import { PageSection, Toolbar, ToolbarContent, ToolbarItem } from '@patternfly/react-core';
import { useEffect } from 'react';
import { PageLayout } from '../PageLayout';
import { PageNotificationsIcon } from '../PageMasthead/PageNotificationsIcon';
import {
  IPageNotification,
  PageNotificationsDrawer,
  usePageNotifications,
} from './PageNotificationsProvider';

describe('PageNotificationsProvider component tests', () => {
  function Component(props: { notifications?: IPageNotification[]; count?: number }) {
    const { setNotificationGroups } = usePageNotifications();

    useEffect(() => {
      if (props.notifications) {
        setNotificationGroups((notificationGroups) => ({
          ...notificationGroups,
          test: { title: 'test', notifications: props.notifications!, count: props.count },
        }));
      }
    }, [props.count, props.notifications, setNotificationGroups]);

    return (
      <>
        <Toolbar>
          <ToolbarContent>
            <ToolbarItem>
              <PageNotificationsIcon />
            </ToolbarItem>
          </ToolbarContent>
        </Toolbar>
        <PageNotificationsDrawer>
          <PageLayout>
            <PageSection isFilled>Notifications Test</PageSection>
          </PageLayout>
        </PageNotificationsDrawer>
      </>
    );
  }

  it('should render PageNotificationsProvider component', () => {
    cy.mount(<Component notifications={[{ title: 'test', description: 'test', to: '/test' }]} />);
    cy.get('[data-cy=notifications-drawer]').should('not.exist');
    cy.get('[data-cy=notification-badge]').should('be.visible');
    cy.get('[data-cy=notification-badge]').should('contain', '1');
    cy.get('[data-cy=notification-badge]').click();
    cy.get('[data-cy=notifications-drawer]').should('be.visible');
    cy.get('[data-cy=notifications-drawer]').should('contain', 'test');
  });

  it('renders notification actions and uses group count override', () => {
    const approve = cy.spy().as('approve');
    cy.mount(
      <Component
        count={3}
        notifications={[
          {
            title: 'approval needed',
            description: 'workflow job',
            to: '/test',
            actions: [{ label: 'Approve', onClick: approve }],
          },
        ]}
      />
    );

    cy.get('[data-cy=notification-badge]').should('contain', '3');
    cy.get('[data-cy=notification-badge]').click();
    cy.contains('button', 'Approve').click();
    cy.get('@approve').should('have.been.calledOnce');
    cy.get('[data-cy=notifications-drawer]').should('be.visible');
  });
});
