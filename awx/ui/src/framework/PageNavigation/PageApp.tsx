import { Page } from '@patternfly/react-core';
import { ReactNode, useEffect, useMemo } from 'react';
import { Outlet, Route, RouteObject, Routes } from 'react-router-dom';
import { PageNotFound } from '../PageEmptyStates/PageNotFound';
import {
  PageNotificationsContent,
  usePageNotifications,
} from '../PageNotifications/PageNotificationsProvider';
import { PageNavigation } from './PageNavigation';
import { PageNavigationItem } from './PageNavigationItem';
import { usePageNavigationRoutesContext } from './PageNavigationRoutesProvider';

export function PageApp(props: {
  /** Component for the masthead of the page. */
  masthead?: ReactNode;

  /** The navigation items for the page. */
  navigation: PageNavigationItem[];

  /**
   * The basename of the app for situations where you can't deploy to the root of the domain, but a sub directory.
   *
   * SEE: https://reactrouter.com/en/main/routers/create-browser-router#basename
   */
  basename?: string;

  /** The default refresh interval for the page in seconds. */
  defaultRefreshInterval: number;

  banner?: ReactNode;
}) {
  const { navigation, masthead } = props;
  const { notificationsDrawerOpen, setNotificationsDrawerOpen } = usePageNotifications();
  const navigationItems = useMemo(
    () => [
      {
        path: props.basename ?? '/',
        element: (
          <Page
            header={masthead}
            sidebar={<PageNavigation navigation={navigation} basename={props.basename} />}
            notificationDrawer={<PageNotificationsContent />}
            isNotificationDrawerExpanded={notificationsDrawerOpen}
            onNotificationDrawerExpand={() => setNotificationsDrawerOpen(true)}
          >
            <div
              style={{
                maxHeight: '100%',
                overflow: 'hidden',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {props.banner}
              <div style={{ flexGrow: 1, overflow: 'hidden' }}>
                <Outlet />
              </div>
            </div>
          </Page>
        ),
        children: navigation.filter(({ href }) => !href),
      },
      { path: '*', element: <PageNotFound /> },
    ],
    [
      masthead,
      navigation,
      notificationsDrawerOpen,
      props.banner,
      props.basename,
      setNotificationsDrawerOpen,
    ]
  );
  const [_, setNavigation] = usePageNavigationRoutesContext();
  useEffect(() => setNavigation(navigationItems), [navigationItems, setNavigation]);

  return <Routes>{navigationItems.map(NavigationRoute)}</Routes>;
}

function NavigationRoute(route: RouteObject) {
  return (
    <Route key={route.path} path={route.path} element={route.element}>
      {route.children?.map(NavigationRoute)}
    </Route>
  );
}
