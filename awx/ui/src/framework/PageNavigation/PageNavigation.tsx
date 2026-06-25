import {
  Flex,
  FlexItem,
  Label,
  Nav,
  NavExpandable,
  NavItem,
  NavList,
  PageSidebar,
  PageSidebarBody,
} from '@patternfly/react-core';
import { ExternalLinkAltIcon } from '@patternfly/react-icons';
import { useState } from 'react';
import { usePageNavBarClick, usePageNavSideBar } from './PageNavSidebar';
import './PageNavigation.css';
import { PageNavigationItem } from './PageNavigationItem';

function isHidden(item: PageNavigationItem): boolean {
  return 'hidden' in item && item.hidden === true;
}

function joinRoute(baseRoute: string, itemPath: string): string {
  const base = baseRoute === '/' ? '' : baseRoute.replace(/\/$/, '');
  const path = itemPath.replace(/^\//, '');
  if (!path) {
    return base || '/';
  }
  return `${base}/${path}`.replace(/\/+/g, '/');
}

function routeWithPrefix(route: string): string {
  return `${process.env.ROUTE_PREFIX ?? ''}${route}`.replace(/\/+/g, '/');
}

function isRouteActive(currentPath: string, path: string): boolean {
  return path !== '/' && (currentPath === path || currentPath.startsWith(`${path}/`));
}

function hasVisibleChildNavItems(item: PageNavigationItem): boolean {
  return 'children' in item && item.children.some((child) => !isHidden(child) && !!child.label);
}

function isNavigationItemActive(
  item: PageNavigationItem,
  baseRoute: string,
  currentPath: string
): boolean {
  const route = joinRoute(baseRoute, item.path);
  const path = routeWithPrefix(route);
  if (!item.href && isRouteActive(currentPath, path)) {
    return true;
  }
  if ('children' in item) {
    return item.children.some(
      (child) => !isHidden(child) && isNavigationItemActive(child, route, currentPath)
    );
  }
  return false;
}

/** Renders a sidebar navigation menu from an arroy of navigation items. */
export function PageNavigation(props: { navigation: PageNavigationItem[]; basename?: string }) {
  const { navigation: navigationItems } = props;
  const navBar = usePageNavSideBar();

  return (
    <PageSidebar isSidebarOpen={navBar.isOpen} className="bg-lighten">
      <PageSidebarBody>
        <Nav data-cy="page-navigation" className="side-nav">
          <NavList>
            <PageNavigationItems baseRoute={props.basename ?? ''} items={navigationItems} />
          </NavList>
        </Nav>
      </PageSidebarBody>
    </PageSidebar>
  );
}

function PageNavigationItems(props: { items: PageNavigationItem[]; baseRoute: string }) {
  return (
    <>
      {props.items
        .filter((item) => {
          if ('hidden' in item) {
            return item.hidden !== true;
          }
          return true;
        })
        .map((item, index) => (
          <PageNavigationItemComponent
            key={item.id ?? item.label ?? index}
            item={item}
            baseRoute={props.baseRoute}
          />
        ))}
    </>
  );
}

function PageNavigationItemComponent(props: { item: PageNavigationItem; baseRoute: string }) {
  const { item } = props;
  const route = joinRoute(props.baseRoute, item.path);
  const path = routeWithPrefix(route);
  const isCurrentRoute = isNavigationItemActive(item, props.baseRoute, location.pathname);
  const [isExpanded, setIsExpanded] = useState(
    () =>
      isCurrentRoute ||
      localStorage.getItem('default-nav-expanded') === 'true' ||
      localStorage.getItem((item.id ?? item.label) + '-expanded') === 'true'
  );
  const setExpanded = (expanded: boolean) => {
    setIsExpanded(expanded);
    localStorage.setItem((item.id ?? item.label) + '-expanded', expanded ? 'true' : 'false');
  };

  let id: string | undefined;
  if ('id' in props.item) {
    id = props.item.id;
  } else if ('children' in props.item) {
    const rootChild = props.item.children.find((child) => child.path === '');
    if (rootChild && 'id' in rootChild) {
      id = rootChild.id;
    }
  }

  const onClickNavItem = usePageNavBarClick();
  if (item.path === '/' && 'children' in item) {
    return <PageNavigationItems items={item.children} baseRoute={''} />;
  }

  const hasChildNavItems = hasVisibleChildNavItems(item);

  if (!hasChildNavItems && 'label' in item) {
    const isActive = item.href ? false : isRouteActive(location.pathname, path);

    return (
      <NavItem
        id={id}
        href={item.href || route}
        isActive={isActive}
        className={isActive ? 'bg-lighten' : undefined}
        onClick={() => (item.href ? window.open(item.href, '_blank') : onClickNavItem(route))}
        target={item.href ? '_blank' : ''}
        data-cy={id}
        style={{ display: 'flex', alignItems: 'stretch', flexDirection: 'column' }}
      >
        <Flex alignItems={{ default: 'alignItemsCenter' }}>
          {item.icon && <FlexItem style={{ marginRight: 8 }}>{item.icon}</FlexItem>}
          <FlexItem grow={{ default: 'grow' }} className="page-navigation__label">
            {item.label}
          </FlexItem>
          {'badge' in item && item.badge && (
            <FlexItem>
              <Label isCompact variant="outline" color={item.badgeColor}>
                {item.badge}
              </Label>
            </FlexItem>
          )}
          {'href' in item && item.href && (
            <span className="pf-v5-c-nav__toggle">
              <span className="pf-v5-c-nav__toggle-icon">
                <ExternalLinkAltIcon />
              </span>
            </span>
          )}
        </Flex>
        {item.subtitle && <div className="page-navigation__subtitle">{item.subtitle}</div>}
      </NavItem>
    );
  }

  if (!hasChildNavItems || item.label === undefined || !('children' in item)) {
    return null;
  }

  if (!item.label) {
    return <PageNavigationItems items={item.children} baseRoute={route} />;
  }

  return (
    <NavExpandable
      title={
        (
          <div className="page-navigation__expandable-title">
            <div className="page-navigation__label">{item.label}</div>
            {item.subtitle && <div className="page-navigation__subtitle">{item.subtitle}</div>}
          </div>
        ) as unknown as string
      }
      data-cy={id}
      isExpanded={isExpanded || isCurrentRoute}
      onExpand={(_e, expanded: boolean) => setExpanded(expanded)}
    >
      <PageNavigationItems items={item.children} baseRoute={route} />
    </NavExpandable>
  );
}
