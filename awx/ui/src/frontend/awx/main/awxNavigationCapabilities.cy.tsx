import { PageNavigationItem } from '../../../framework/PageNavigation/PageNavigationItem';
import { buildAwxNavigationCapabilities } from './awxNavigationCapabilities';
import { AwxRoute } from './AwxRoutes';
import {
  filterCatalogRoutesByPermissions,
  filterGalaxyRoutesByPermissions,
  filterPolicyRoutesByModules,
  filterPolicyRoutesByPermissions,
  filterQuayRoutesByPermissions,
  profileRoutesOnly,
} from './useAwxNavigation';

function childIds(route: PageNavigationItem) {
  if (!('children' in route)) {
    return [];
  }
  return route.children.map((child) => child.id);
}

function nestedChildIds(route: PageNavigationItem, id: AwxRoute) {
  if (!('children' in route)) {
    return [];
  }
  const child = route.children.find((item) => item.id === id);
  if (!child || !('children' in child)) {
    return [];
  }
  return child.children.map((item) => item.id);
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
    expect(capabilities.canViewCloud).to.equal(false);
  });

  it('maps cloud permissions to cloud navigation capability', () => {
    const cloudUserCapabilities = buildAwxNavigationCapabilities([
      'awx.view_cloudproviderconnection',
      'awx.view_cloudproviderstate',
    ]);
    const cloudAdminCapabilities = buildAwxNavigationCapabilities([
      'awx.change_cloudproviderconnection',
      'awx.change_cloudproviderstate',
    ]);

    expect(cloudUserCapabilities.canViewCloud).to.equal(true);
    expect(cloudUserCapabilities.canManageCloud).to.equal(false);
    expect(cloudAdminCapabilities.canViewCloud).to.equal(true);
    expect(cloudAdminCapabilities.canManageCloud).to.equal(true);
  });

  it('maps policy permissions to policy navigation capability', () => {
    const operatorCapabilities = buildAwxNavigationCapabilities(['shared.view_policyascode']);
    const authorCapabilities = buildAwxNavigationCapabilities(['shared.change_policyascode']);

    expect(operatorCapabilities.canViewPolicy).to.equal(true);
    expect(operatorCapabilities.canManagePolicy).to.equal(false);
    expect(authorCapabilities.canViewPolicy).to.equal(true);
    expect(authorCapabilities.canManagePolicy).to.equal(true);
  });

  it('maps EDA activation permissions to EDA navigation capability', () => {
    const viewerCapabilities = buildAwxNavigationCapabilities(['shared.view_edaactivation']);
    const operatorCapabilities = buildAwxNavigationCapabilities(['shared.execute_edaactivation']);
    const adminCapabilities = buildAwxNavigationCapabilities(['shared.change_edaactivation']);

    expect(viewerCapabilities.canViewEda).to.equal(true);
    expect(viewerCapabilities.canOperateEda).to.equal(false);
    expect(viewerCapabilities.canManageEda).to.equal(false);
    expect(operatorCapabilities.canViewEda).to.equal(true);
    expect(operatorCapabilities.canOperateEda).to.equal(true);
    expect(operatorCapabilities.canManageEda).to.equal(false);
    expect(adminCapabilities.canViewEda).to.equal(true);
    expect(adminCapabilities.canOperateEda).to.equal(true);
    expect(adminCapabilities.canManageEda).to.equal(true);
  });

  it('maps AI resource action permissions to AI capabilities', () => {
    const authorCapabilities = buildAwxNavigationCapabilities(['shared.change_airesourceaction']);
    const approverCapabilities = buildAwxNavigationCapabilities([
      'shared.approve_airesourceaction',
    ]);

    expect(authorCapabilities.canAuthorAi).to.equal(true);
    expect(authorCapabilities.canApproveAi).to.equal(false);
    expect(approverCapabilities.canAuthorAi).to.equal(false);
    expect(approverCapabilities.canApproveAi).to.equal(true);
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

  it('maps Automation Hub and Quay permissions to separate module capabilities', () => {
    const projectCapabilities = buildAwxNavigationCapabilities(['awx.view_project']);
    const eeCapabilities = buildAwxNavigationCapabilities(['awx.view_executionenvironment']);
    const eeAdminCapabilities = buildAwxNavigationCapabilities(['awx.change_executionenvironment']);

    expect(projectCapabilities.canViewGalaxy).to.equal(true);
    expect(projectCapabilities.canViewQuay).to.equal(true);
    expect(projectCapabilities.canManageGalaxy).to.equal(false);
    expect(projectCapabilities.canManageQuay).to.equal(false);
    expect(eeCapabilities.canViewGalaxy).to.equal(true);
    expect(eeCapabilities.canViewQuay).to.equal(true);
    expect(eeAdminCapabilities.canManageGalaxy).to.equal(true);
    expect(eeAdminCapabilities.canManageQuay).to.equal(true);
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

  it('removes policy module routes when the user cannot manage policy as code', () => {
    const policyRoutes: PageNavigationItem = {
      id: AwxRoute.PolicyAsCode,
      label: 'Policy as Code',
      path: 'policy-as-code',
      children: [
        {
          id: AwxRoute.PolicyAsCodeOverview,
          label: 'Overview',
          path: 'overview',
          element: <div />,
        },
        {
          id: AwxRoute.PolicyAsCodeGatekeeper,
          label: 'Gatekeeper',
          path: 'gatekeeper',
          element: <div />,
        },
        {
          id: AwxRoute.PolicyAsCodeOpa,
          label: 'OPA',
          path: 'opa',
          children: [
            { id: AwxRoute.PolicyAsCodeOpaOverview, path: 'overview', element: <div /> },
            { id: AwxRoute.PolicyAsCodeOpaModules, path: 'modules', element: <div /> },
            { id: AwxRoute.PolicyAsCodeOpaDecisions, path: 'decisions', element: <div /> },
            { id: AwxRoute.PolicyAsCodeOpaViolations, path: 'violations', element: <div /> },
            { id: AwxRoute.PolicyAsCodeOpaProjectSync, path: 'project-sync', element: <div /> },
            { id: AwxRoute.PolicyAsCodeOpaTester, path: 'tester', element: <div /> },
            { path: '', element: <div /> },
          ],
        },
        { path: 'smoke', element: <div />, hidden: true },
        { path: '', element: <div /> },
      ],
    };

    const filteredRoutes = filterPolicyRoutesByPermissions(policyRoutes, false);

    expect(childIds(filteredRoutes)).to.deep.equal([
      AwxRoute.PolicyAsCodeOverview,
      AwxRoute.PolicyAsCodeGatekeeper,
      AwxRoute.PolicyAsCodeOpa,
      undefined,
      undefined,
    ]);
    expect(nestedChildIds(filteredRoutes, AwxRoute.PolicyAsCodeOpa)).to.deep.equal([
      AwxRoute.PolicyAsCodeOpaOverview,
      AwxRoute.PolicyAsCodeOpaDecisions,
      AwxRoute.PolicyAsCodeOpaViolations,
      AwxRoute.PolicyAsCodeOpaTester,
      undefined,
    ]);
  });

  it('removes Galaxy NG admin routes when the user cannot manage hub content', () => {
    const galaxyRoutes: PageNavigationItem = {
      id: AwxRoute.GalaxyNG,
      label: 'Galaxy NG',
      path: 'galaxy-ng',
      children: [
        { id: AwxRoute.GalaxyNGOverview, path: 'overview', element: <div /> },
        { id: AwxRoute.GalaxyNGNamespaces, path: 'namespaces', element: <div /> },
        { id: AwxRoute.GalaxyNGCollections, path: 'collections', element: <div /> },
        { id: AwxRoute.GalaxyNGProjectImports, path: 'project-imports', element: <div /> },
        { id: AwxRoute.GalaxyNGRepositories, path: 'repositories', element: <div /> },
        { id: AwxRoute.GalaxyNGRemotes, path: 'remotes', element: <div /> },
        { id: AwxRoute.GalaxyNGRemoteRegistries, path: 'remote-registries', element: <div /> },
        { id: AwxRoute.GalaxyNGSignatureKeys, path: 'signature-keys', element: <div /> },
        {
          id: AwxRoute.GalaxyNGCollectionApprovals,
          path: 'collection-approvals',
          element: <div />,
        },
        { id: AwxRoute.GalaxyNGTasks, path: 'tasks', element: <div /> },
        { id: AwxRoute.GalaxyNGApiToken, path: 'api-token', element: <div /> },
        { path: '', element: <div /> },
      ],
    };

    expect(childIds(filterGalaxyRoutesByPermissions(galaxyRoutes, false))).to.deep.equal([
      AwxRoute.GalaxyNGOverview,
      AwxRoute.GalaxyNGNamespaces,
      AwxRoute.GalaxyNGCollections,
      AwxRoute.GalaxyNGRepositories,
      AwxRoute.GalaxyNGRemotes,
      AwxRoute.GalaxyNGRemoteRegistries,
      AwxRoute.GalaxyNGSignatureKeys,
      undefined,
    ]);
    expect(childIds(filterGalaxyRoutesByPermissions(galaxyRoutes, true))).to.deep.equal([
      AwxRoute.GalaxyNGOverview,
      AwxRoute.GalaxyNGNamespaces,
      AwxRoute.GalaxyNGCollections,
      AwxRoute.GalaxyNGProjectImports,
      AwxRoute.GalaxyNGRepositories,
      AwxRoute.GalaxyNGRemotes,
      AwxRoute.GalaxyNGRemoteRegistries,
      AwxRoute.GalaxyNGSignatureKeys,
      AwxRoute.GalaxyNGCollectionApprovals,
      AwxRoute.GalaxyNGTasks,
      AwxRoute.GalaxyNGApiToken,
      undefined,
    ]);
  });

  it('removes Project Quay build routes when the user cannot manage execution environment images', () => {
    const quayRoutes: PageNavigationItem = {
      id: AwxRoute.Quay,
      label: 'Project Quay',
      path: 'quay',
      children: [
        { id: AwxRoute.QuayOverview, path: 'overview', element: <div /> },
        { id: AwxRoute.QuayRepositories, path: 'repositories', element: <div /> },
        {
          id: AwxRoute.QuayExecutionEnvironmentImages,
          path: 'execution-environment-images',
          element: <div />,
        },
        { path: '', element: <div /> },
      ],
    };

    expect(childIds(filterQuayRoutesByPermissions(quayRoutes, false))).to.deep.equal([
      AwxRoute.QuayOverview,
      AwxRoute.QuayRepositories,
      undefined,
    ]);
    expect(childIds(filterQuayRoutesByPermissions(quayRoutes, true))).to.deep.equal([
      AwxRoute.QuayOverview,
      AwxRoute.QuayRepositories,
      AwxRoute.QuayExecutionEnvironmentImages,
      undefined,
    ]);
  });

  it('keeps OPA and Gatekeeper routes separate when modules are toggled independently', () => {
    const policyRoutes: PageNavigationItem = {
      id: AwxRoute.PolicyAsCode,
      label: 'Policy as Code',
      path: 'policy-as-code',
      children: [
        {
          id: AwxRoute.PolicyAsCodeOverview,
          label: 'Overview',
          path: 'overview',
          element: <div />,
        },
        {
          id: AwxRoute.PolicyAsCodeGatekeeper,
          label: 'Gatekeeper',
          path: 'gatekeeper',
          element: <div />,
        },
        {
          id: AwxRoute.PolicyAsCodeOpa,
          label: 'OPA',
          path: 'opa',
          element: <div />,
        },
        { path: 'smoke', element: <div />, hidden: true },
        { path: '', element: <div /> },
      ],
    };

    expect(childIds(filterPolicyRoutesByModules(policyRoutes, true, false))).to.deep.equal([
      AwxRoute.PolicyAsCodeOverview,
      AwxRoute.PolicyAsCodeOpa,
      undefined,
      undefined,
    ]);
    expect(childIds(filterPolicyRoutesByModules(policyRoutes, false, true))).to.deep.equal([
      AwxRoute.PolicyAsCodeGatekeeper,
      undefined,
      undefined,
    ]);
    expect(childIds(filterPolicyRoutesByModules(policyRoutes, true, true))).to.deep.equal([
      AwxRoute.PolicyAsCodeOverview,
      AwxRoute.PolicyAsCodeGatekeeper,
      AwxRoute.PolicyAsCodeOpa,
      undefined,
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
