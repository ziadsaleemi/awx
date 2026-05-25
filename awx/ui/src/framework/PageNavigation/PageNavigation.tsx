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
  Tooltip,
} from '@patternfly/react-core';
import { AngleLeftIcon, AngleRightIcon, ExternalLinkAltIcon } from '@patternfly/react-icons';
import { useState, type CSSProperties } from 'react';
import { usePageNavBarClick, usePageNavSideBar } from './PageNavSidebar';
import './PageNavigation.css';
import { PageNavigationItem } from './PageNavigationItem';

/** Renders a sidebar navigation menu from an arroy of navigation items. */
export function PageNavigation(props: { navigation: PageNavigationItem[]; basename?: string }) {
  const { navigation: navigationItems } = props;
  const navBar = usePageNavSideBar();

  return (
    <PageSidebar
      isSidebarOpen={navBar.isOpen}
      className={`bg-lighten${navBar.isCollapsed ? ' nav-collapsed' : ''}`}
      style={navBar.isCollapsed ? { width: 56, minWidth: 56 } : undefined}
    >
      <PageSidebarBody style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <Nav data-cy="page-navigation" className="side-nav" style={{ flex: 1 }}>
          <NavList>
            <PageNavigationItems baseRoute={props.basename ?? ''} items={navigationItems} />
          </NavList>
        </Nav>
        {/* Collapse toggle button */}
        <div
          onClick={() => navBar.setState({ isCollapsed: !navBar.isCollapsed })}
          title={navBar.isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: navBar.isCollapsed ? 'center' : 'flex-end',
            padding: '10px 12px',
            cursor: 'pointer',
            borderTop: '1px solid rgba(255,255,255,0.12)',
            color: 'rgba(255,255,255,0.6)',
            fontSize: 12,
            userSelect: 'none',
            gap: 6,
          }}
        >
          {navBar.isCollapsed ? <AngleRightIcon /> : <><AngleLeftIcon /><span>Collapse</span></>}
        </div>
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
  const navBar = usePageNavSideBar();
  const isCollapsed = navBar.isCollapsed;
  const [isExpanded, setIsExpanded] = useState(
    () =>
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
  let route = props.baseRoute + '/' + item.path;
  route = route.replace('//', '/');
  if (item.path === '/' && 'children' in item) {
    return <PageNavigationItems items={item.children} baseRoute={''} />;
  }

  const hasChildNavItems = 'children' in item && item.children?.find((child) => child.label);
  const subtitleStyle: CSSProperties = { fontSize: 'small', opacity: 0.5, textAlign: 'left' };

  if (!hasChildNavItems && 'label' in item) {
    let path = (process.env.ROUTE_PREFIX ?? '') + route;
    path = path.replace('//', '/');

    const isActive = item.href ? false : location.pathname.startsWith(path);
    const icon = item.icon ?? (
      <span style={{ fontWeight: 700, fontSize: 14, width: 20, textAlign: 'center', display: 'inline-block' }}>
        {item.label?.charAt(0)}
      </span>
    );

    if (isCollapsed) {
      return (
        <Tooltip content={item.label} position="right" key={id}>
          <NavItem
            id={id}
            href={item.href || route}
            isActive={isActive}
            className={isActive ? 'bg-lighten' : undefined}
            onClick={() => (item.href ? window.open(item.href, '_blank') : onClickNavItem(route))}
            target={item.href ? '_blank' : ''}
            data-cy={id}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '10px 0' }}
          >
            {icon}
          </NavItem>
        </Tooltip>
      );
    }

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
          <FlexItem style={{ marginRight: 8 }}>{icon}</FlexItem>
          <FlexItem grow={{ default: 'grow' }}>{item.label}</FlexItem>
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
        {item.subtitle && <div style={subtitleStyle}>{item.subtitle}</div>}
      </NavItem>
    );
  }

  if (!hasChildNavItems || item.label === undefined) {
    return null;
  }

  if (!item.label) {
    return <PageNavigationItems items={item.children} baseRoute={route} />;
  }

  const groupIcon = item.icon ?? (
    <span style={{ fontWeight: 700, fontSize: 14, width: 20, textAlign: 'center', display: 'inline-block' }}>
      {item.label?.charAt(0)}
    </span>
  );

  if (isCollapsed) {
    return (
      <Tooltip content={item.label} position="right" key={id}>
        <NavItem
          id={id}
          isActive={false}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '10px 0' }}
        >
          {groupIcon}
        </NavItem>
      </Tooltip>
    );
  }

  return (
    <NavExpandable
      title={
        (
          <div>
            <div style={{ textAlign: 'left' }}>{item.label}</div>
            {item.subtitle && <div style={subtitleStyle}>{item.subtitle}</div>}
          </div>
        ) as unknown as string
      }
      isExpanded={isExpanded}
      onExpand={(_e, expanded: boolean) => setExpanded(expanded)}
    >
      <PageNavigationItems items={item.children} baseRoute={route} />
    </NavExpandable>
  );
}
