import { PageNavigationItem } from '../../../framework/PageNavigation/PageNavigationItem';
import { buildAwxNavigationCapabilities } from './awxNavigationCapabilities';
import { AwxRoute } from './AwxRoutes';
import { filterCatalogRoutesByPermissions, profileRoutesOnly } from './useAwxNavigation';

function childIds(route: PageNavigationItem) {
  if (!('children' in route)) {
    return [];
  }
  return route.children.map((child) => child.id);
}

describe('AWX navigation capabilities', () => {
  it('maps catalog-user permissions to catalog-only navigation capability', () => {
    const capabilities = buildAwxNavigationCapabilities([
      'awx.view_catalogitem',
      'awx.use_catalogitem',
    ]);

    expect(capabilities.canViewCatalog).to.equal(true);
    expect(capabilities.canManageCatalog).to.equal(false);
    expect(capabilities.canViewTemplates).to.equal(false);
    expect(capabilities.canViewInventory).to.equal(false);
    expect(capabilities.canViewCredentials).to.equal(false);
    expect(capabilities.canViewUsers).to.equal(false);
    expect(capabilities.canViewActivityStream).to.equal(false);
  });

  it('maps object permission codenames to resource navigation capabilities', () => {
    const capabilities = buildAwxNavigationCapabilities([
      'awx.add_jobtemplate',
      'awx.approve_workflowjobtemplate',
      'awx.view_inventory',
      'awx.change_credential',
      'awx.member_team',
    ]);

    expect(capabilities.canViewTemplates).to.equal(true);
    expect(capabilities.canViewSchedules).to.equal(true);
    expect(capabilities.canViewInventory).to.equal(true);
    expect(capabilities.canViewCredentials).to.equal(true);
    expect(capabilities.canViewTeams).to.equal(true);
    expect(capabilities.canApproveWorkflows).to.equal(true);
    expect(capabilities.canViewActivityStream).to.equal(true);
  });

  it('maps organization membership to users navigation without granting it to catalog roles', () => {
    const catalogCapabilities = buildAwxNavigationCapabilities(['awx.view_catalogitem']);
    const organizationCapabilities = buildAwxNavigationCapabilities([
      'awx.member_organization',
      'awx.view_organization',
    ]);

    expect(catalogCapabilities.canViewUsers).to.equal(false);
    expect(organizationCapabilities.canViewUsers).to.equal(true);
  });

  it('removes catalog admin routes when the user cannot manage catalog items', () => {
    const catalogRoutes: PageNavigationItem = {
      id: AwxRoute.Catalog,
      label: 'Catalog',
      path: 'catalog',
      children: [
        { id: AwxRoute.CatalogItems, label: 'Browse', path: 'browse', element: <div /> },
        {
          id: AwxRoute.CatalogDeployments,
          label: 'My Deployments',
          path: 'deployments',
          element: <div />,
        },
        {
          id: AwxRoute.CatalogAdminItems,
          label: 'Catalog Items',
          path: 'admin/items',
          element: <div />,
        },
        {
          id: AwxRoute.CatalogMarketplace,
          label: 'Marketplace',
          path: 'marketplace',
          element: <div />,
        },
        { path: '', element: <div /> },
      ],
    };

    const filteredRoutes = filterCatalogRoutesByPermissions(catalogRoutes, false);

    expect(childIds(filteredRoutes)).to.deep.equal([
      AwxRoute.CatalogItems,
      AwxRoute.CatalogDeployments,
      undefined,
    ]);
  });

  it('keeps profile routes hidden while removing user administration routes', () => {
    const userRoutes: PageNavigationItem = {
      id: AwxRoute.Users,
      label: 'Users',
      path: 'users',
      children: [
        { id: AwxRoute.CreateUser, path: 'create', element: <div /> },
        { id: AwxRoute.EditUser, path: ':id/edit', element: <div /> },
        { id: AwxRoute.UserPage, path: ':id', element: <div /> },
        { id: AwxRoute.AddRolesToUser, path: ':id/roles/add-roles', element: <div /> },
        { id: AwxRoute.CreateUserToken, path: ':id/tokens/create', element: <div /> },
        { path: '', element: <div /> },
      ],
    };

    const filteredRoutes = profileRoutesOnly(userRoutes);

    expect(filteredRoutes.hidden).to.equal(true);
    expect(childIds(filteredRoutes)).to.deep.equal([
      AwxRoute.EditUser,
      AwxRoute.UserPage,
      AwxRoute.CreateUserToken,
    ]);
  });
});
