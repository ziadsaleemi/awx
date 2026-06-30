import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import {
  ChartBarIcon,
  CogIcon,
  HomeIcon,
  ProcessAutomationIcon,
  ServerIcon,
  UsersIcon,
} from '@patternfly/react-icons';
import { PageNavigationItem } from '../../../framework/PageNavigation/PageNavigationItem';
import { PageSettingsDetails } from '../../../framework/PageSettings/PageSettingsDetails';
import { PageSettingsForm } from '../../../framework/PageSettings/PageSettingsForm';
import { AwxRoleDetails } from '../access/roles/AwxRoleDetails';
import { AwxRolePage } from '../access/roles/AwxRolePage';
import { AwxRoles } from '../access/roles/AwxRoles';
import { CloneRole, CreateRole, EditRole } from '../access/roles/RoleForm';
import { CloneUserType, CreateUserType, EditUserType } from '../access/user-types/UserTypeForm';
import { UserTypes } from '../access/user-types/UserTypes';
import { AwxSettings } from '../administration/settings/AwxSettings';
import { AwxSettingsCategoryDetailsPage } from '../administration/settings/AwxSettingsCategoryDetails';
import {
  AwxSettingsCategoryForm,
  AwxSettingsCategoryFormRoute,
} from '../administration/settings/AwxSettingsCategoryForm';
import {
  isGatekeeperSetting,
  isOpaSetting,
} from '../administration/settings/policySettingsFilters';
import { Topology } from '../administration/topology/Topology';
import { Reports } from '../analytics/Reports/Reports';
import { SubscriptionUsage } from '../analytics/subscription-usage/SubscriptionUsage';
import { useAwxActiveUser } from '../common/useAwxActiveUser';
import { useAwxConfig } from '../common/useAwxConfig';
import { AwxOverview } from '../overview/AwxOverview';
import { HostMetrics } from '../views/jobs/HostMetrics';
import { AwxRoute } from './AwxRoutes';
import { useAwxActivityStreamRoutes } from './routes/useAwxActivityStreamRoutes';
import { useAwxCredentialRoutes } from './routes/useAwxCredentialRoutes';
import { useAwxCredentialTypesRoutes } from './routes/useAwxCredentialTypesRoutes';
import { useAwxExecutionEnvironmentRoutes } from './routes/useAwxExecutionEnironmentRoutes';
import { useAwxHostRoutes } from './routes/useAwxHostRoutes';
import { useAwxInstanceGroupsRoutes } from './routes/useAwxInstanceGroupsRoutes';
import { useAwxInstancesRoutes } from './routes/useAwxInstancesRoutes';
import { useAwxInventoryRoutes } from './routes/useAwxInventoryRoutes';
import { useAwxJobsRoutes } from './routes/useAwxJobsRoutes';
import { useAwxManagementJobsRoutes } from './routes/useAwxManagementJobsRoutes';
import { useAwxNotificationsRoutes } from './routes/useAwxNotificationsRoutes';
import { useAwxOrganizationRoutes } from './routes/useAwxOrganizationsRoutes';
import { useAwxProjectRoutes } from './routes/useAwxProjectRoutes';
import { useAwxPolicyRoutes } from './routes/useAwxPolicyRoutes';
import { useAwxGalaxyRoutes } from './routes/useAwxGalaxyRoutes';
import { useAwxQuayRoutes } from './routes/useAwxQuayRoutes';
import { useAwxSchedulesRoutes } from './routes/useAwxSchedulesRoutes';
import { useAwxTerraformRoutes } from './routes/useAwxTerraformRoutes';
import { useAwxCatalogRoutes } from './routes/useAwxCatalogRoutes';
import { useAwxCloudRoutes } from './routes/useAwxCloudRoutes';
import { useAwxEdaRoutes } from './routes/useAwxEdaRoutes';
import { useAwxTeamsRoutes } from './routes/useAwxTeamsRoutes';
import { useAwxTemplateRoutes } from './routes/useAwxTemplateRoutes';
import { useAwxUsersRoutes } from './routes/useAwxUsersRoutes';
import { useAwxWorkflowApprovalRoutes } from './routes/useAwxWorkflowApprovalRoutes';
import { useAwxNavigationCapabilities } from './awxNavigationCapabilities';

function hasChildren(
  item: PageNavigationItem
): item is PageNavigationItem & { children: PageNavigationItem[] } {
  return 'children' in item;
}

function filterRouteChildrenById(
  route: PageNavigationItem,
  allowedIds: Set<string>,
  options: { keepChildrenWithoutId?: boolean } = {}
) {
  if (!hasChildren(route)) {
    return route;
  }
  const keepChildrenWithoutId = options.keepChildrenWithoutId ?? true;
  return {
    ...route,
    children: route.children.filter((child) =>
      child.id ? allowedIds.has(child.id) : keepChildrenWithoutId
    ),
  };
}

export function filterCatalogRoutesByPermissions(
  catalogRoutes: PageNavigationItem,
  canManageCatalog: boolean
) {
  if (canManageCatalog) {
    return catalogRoutes;
  }
  return filterRouteChildrenById(
    catalogRoutes,
    new Set([AwxRoute.CatalogItems, AwxRoute.CatalogDeploy, AwxRoute.CatalogDeployments])
  );
}

export function filterPolicyRoutesByPermissions(
  policyRoutes: PageNavigationItem,
  canManagePolicy: boolean
) {
  if (canManagePolicy) {
    return policyRoutes;
  }
  const filteredRoutes = filterRouteChildrenById(
    policyRoutes,
    new Set([
      AwxRoute.PolicyAsCodeOverview,
      AwxRoute.PolicyAsCodeOpa,
      AwxRoute.PolicyAsCodeGatekeeper,
    ])
  );
  if (!hasChildren(filteredRoutes)) {
    return filteredRoutes;
  }
  return {
    ...filteredRoutes,
    children: filteredRoutes.children.map((child) =>
      child.id === AwxRoute.PolicyAsCodeOpa
        ? filterRouteChildrenById(
            child,
            new Set([
              AwxRoute.PolicyAsCodeOpaOverview,
              AwxRoute.PolicyAsCodeOpaDecisions,
              AwxRoute.PolicyAsCodeOpaViolations,
              AwxRoute.PolicyAsCodeOpaTester,
            ])
          )
        : child
    ),
  };
}

export function filterGalaxyRoutesByPermissions(
  galaxyRoutes: PageNavigationItem,
  canManageGalaxy: boolean
) {
  if (canManageGalaxy) {
    return galaxyRoutes;
  }
  return filterRouteChildrenById(
    galaxyRoutes,
    new Set([
      AwxRoute.GalaxyNGOverview,
      AwxRoute.GalaxyNGNamespaces,
      AwxRoute.GalaxyNGCollections,
      AwxRoute.GalaxyNGRepositories,
      AwxRoute.GalaxyNGRemotes,
      AwxRoute.GalaxyNGRemoteRegistries,
      AwxRoute.GalaxyNGSignatureKeys,
    ])
  );
}

export function filterQuayRoutesByPermissions(
  quayRoutes: PageNavigationItem,
  canManageQuay: boolean
) {
  if (canManageQuay) {
    return quayRoutes;
  }
  return filterRouteChildrenById(
    quayRoutes,
    new Set([AwxRoute.QuayOverview, AwxRoute.QuayRepositories])
  );
}

export function filterPolicyRoutesByModules(
  policyRoutes: PageNavigationItem,
  opaEnabled: boolean,
  gatekeeperEnabled: boolean
) {
  if (opaEnabled && gatekeeperEnabled) {
    return policyRoutes;
  }

  const allowedIds = new Set<string>([AwxRoute.PolicyAsCodeOverview]);
  if (gatekeeperEnabled) {
    allowedIds.add(AwxRoute.PolicyAsCodeGatekeeper);
  }
  if (opaEnabled) {
    allowedIds.add(AwxRoute.PolicyAsCodeOpa);
  } else {
    allowedIds.delete(AwxRoute.PolicyAsCodeOverview);
  }

  return filterRouteChildrenById(policyRoutes, allowedIds);
}

export function profileRoutesOnly(userRoutes: PageNavigationItem) {
  return {
    ...filterRouteChildrenById(
      userRoutes,
      new Set([
        AwxRoute.EditUser,
        AwxRoute.UserPage,
        AwxRoute.CreateUserToken,
        AwxRoute.UserTokenPage,
      ]),
      { keepChildrenWithoutId: false }
    ),
    hidden: true,
  };
}

export const AwxNavigationGroup = {
  AutomationExecution: 'awx-navigation-automation-execution',
  AutomationDecisions: 'awx-navigation-automation-decisions',
  AutomationContent: 'awx-navigation-automation-content',
} as const;

function hasVisibleSidebarItem(item: PageNavigationItem): boolean {
  if ('hidden' in item && item.hidden === true) {
    return false;
  }
  if ('children' in item) {
    return item.children.some(hasVisibleSidebarItem);
  }
  if (item.label) {
    return true;
  }
  return false;
}

function pathlessNavigationGroup(
  id: string,
  label: string,
  subtitle: string,
  children: PageNavigationItem[]
): PageNavigationItem {
  return {
    id,
    label,
    subtitle,
    path: '',
    children,
  };
}

function withNavigationDetails(
  item: PageNavigationItem,
  label: string,
  subtitle: string
): PageNavigationItem {
  return {
    ...item,
    label,
    subtitle,
  };
}

function policyModuleSubtitle(
  t: (value: string) => string,
  opaEnabled: boolean,
  gatekeeperEnabled: boolean
) {
  if (opaEnabled && gatekeeperEnabled) {
    return t('OPA and Kubernetes Gatekeeper');
  }
  if (gatekeeperEnabled) {
    return t('Kubernetes Gatekeeper');
  }
  return t('OPA policy engine');
}

export function useAwxNavigation() {
  const { t } = useTranslation();
  const awxInventoryRoutes = useAwxInventoryRoutes();
  const awxHostRoutes = useAwxHostRoutes();
  const awxProjectRoutes = useAwxProjectRoutes();
  const awxTerraformRoutes = useAwxTerraformRoutes();
  const awxCatalogRoutes = useAwxCatalogRoutes();
  const awxCloudRoutes = useAwxCloudRoutes();
  const awxPolicyRoutes = useAwxPolicyRoutes();
  const awxGalaxyRoutes = useAwxGalaxyRoutes();
  const awxQuayRoutes = useAwxQuayRoutes();
  const awxEdaRoutes = useAwxEdaRoutes();
  const awxCredentialRoutes = useAwxCredentialRoutes();
  const awxTemplateRoutes = useAwxTemplateRoutes();
  const awxWorkflowApprovalRoutes = useAwxWorkflowApprovalRoutes();
  const awxSchedulesRoutes = useAwxSchedulesRoutes();
  const awxJobsRoutes = useAwxJobsRoutes();
  const awxActivityStreamRoutes = useAwxActivityStreamRoutes();
  const awxOrganizationRoutes = useAwxOrganizationRoutes();
  const awxTeamsRoutes = useAwxTeamsRoutes();
  const awxUsersRoutes = useAwxUsersRoutes();
  const awxNotificationsRoutes = useAwxNotificationsRoutes();
  const awxManagementJobsRoutes = useAwxManagementJobsRoutes();
  const awxInstanceGroupsRoutes = useAwxInstanceGroupsRoutes();
  const awxInstancesRoutes = useAwxInstancesRoutes();
  const awxExecutionEnvironmentsRoutes = useAwxExecutionEnvironmentRoutes();
  const awxCredentialTypesRoutes = useAwxCredentialTypesRoutes();
  const { activeAwxUser } = useAwxActiveUser();
  const awxConfig = useAwxConfig();
  const capabilities = useAwxNavigationCapabilities(activeAwxUser);
  const moduleEdaEnabled = awxConfig?.modules?.eda?.enabled !== false;
  const moduleOpaEnabled = awxConfig?.modules?.opa?.enabled !== false;
  const moduleGatekeeperEnabled = awxConfig?.modules?.gatekeeper?.enabled !== false;
  const moduleGalaxyNgEnabled = awxConfig?.modules?.galaxy_ng?.enabled !== false;
  const moduleQuayEnabled = awxConfig?.modules?.quay?.enabled !== false;
  const modulePolicyEnabled = moduleOpaEnabled || moduleGatekeeperEnabled;
  const awxPolicyRoutesForModules = filterPolicyRoutesByModules(
    awxPolicyRoutes,
    moduleOpaEnabled,
    moduleGatekeeperEnabled
  );
  const policySubtitle = policyModuleSubtitle(t, moduleOpaEnabled, moduleGatekeeperEnabled);

  const overview: PageNavigationItem[] = [
    {
      id: AwxRoute.Overview,
      label: t('Overview'),
      path: 'overview',
      element: <AwxOverview />,
      icon: <HomeIcon />,
    },
  ];
  const infrastructureItems: PageNavigationItem[] = [
    {
      id: AwxRoute.Infrastructure,
      label: t('Infrastructure'),
      subtitle: t('Inventories and execution nodes'),
      path: 'infrastructure',
      icon: <ServerIcon />,
      children: activeAwxUser?.is_superuser
        ? [
            {
              id: AwxRoute.TopologyView,
              label: t('Topology View'),
              path: 'topology',
              element: <Topology />,
            },
            awxInventoryRoutes,
            awxHostRoutes,
            awxInstanceGroupsRoutes,
            awxInstancesRoutes,
            awxExecutionEnvironmentsRoutes,
          ]
        : [
            awxInventoryRoutes,
            awxHostRoutes,
            awxInstanceGroupsRoutes,
            awxInstancesRoutes,
            awxExecutionEnvironmentsRoutes,
          ],
    },
  ];
  const analyticsItems: PageNavigationItem[] = [
    {
      id: AwxRoute.Analytics,
      label: t('Analytics'),
      subtitle: t('Insights and usage'),
      path: 'analytics',
      icon: <ChartBarIcon />,
      children: [
        {
          id: AwxRoute.AutomationCalculator,
          label: t('Automation Calculator'),
          path: 'automation-calculator',
          element: <Reports />,
        },
        {
          id: AwxRoute.HostMetrics,
          label: t('Host Metrics'),
          path: 'host-metrics',
          element: <HostMetrics />,
        },
        {
          id: AwxRoute.SubscriptionUsage,
          label: t('Subscription Usage'),
          path: 'subscription-usage',
          element: <SubscriptionUsage />,
        },
      ],
    },
  ];
  const administrationItems: PageNavigationItem[] = [
    {
      id: AwxRoute.Administration,
      label: t('Administration'),
      subtitle: t('Activity, approvals, and jobs'),
      path: 'administration',
      icon: <CogIcon />,
      children: activeAwxUser?.is_superuser
        ? [
            awxActivityStreamRoutes,
            awxWorkflowApprovalRoutes,
            awxNotificationsRoutes,
            awxManagementJobsRoutes,
          ]
        : [awxActivityStreamRoutes, awxWorkflowApprovalRoutes],
    },
  ];
  const accessItems: PageNavigationItem[] = [
    {
      id: AwxRoute.Access,
      label: t('Access Management'),
      subtitle: t('Identity and RBAC'),
      path: 'access',
      icon: <UsersIcon />,
      children: [
        {
          id: AwxRoute.SettingsAuthentication,
          label: t('Authentication Methods'),
          path: 'authentication',
          children: [
            {
              id: AwxRoute.SettingsCategory,
              path: ':category/edit',
              element: <AwxSettingsCategoryFormRoute />,
            },
            {
              path: '',
              element: (
                <AwxSettings
                  filterGroups={(g) => g.id === 'authentication'}
                  title={t('Authentication Methods')}
                />
              ),
            },
          ],
        },
        awxOrganizationRoutes,
        awxTeamsRoutes,
        awxUsersRoutes,
        {
          id: AwxRoute.UserTypes,
          label: t('User types'),
          path: 'user-types',
          children: [
            {
              id: AwxRoute.CreateUserType,
              path: 'create',
              element: <CreateUserType />,
            },
            {
              id: AwxRoute.EditUserType,
              path: ':id/edit',
              element: <EditUserType />,
            },
            {
              id: AwxRoute.CloneUserType,
              path: ':id/clone',
              element: <CloneUserType />,
            },
            {
              path: '',
              element: <UserTypes />,
            },
          ],
        },
        {
          id: AwxRoute.Roles,
          label: t('Roles'),
          path: 'roles',
          children: [
            {
              id: AwxRoute.CreateRole,
              path: 'create',
              element: <CreateRole />,
            },
            {
              id: AwxRoute.EditRole,
              path: ':id/edit',
              element: <EditRole />,
            },
            {
              id: AwxRoute.CloneRole,
              path: ':id/copy',
              element: <CloneRole />,
            },
            {
              id: AwxRoute.RolePage,
              path: ':id',
              element: <AwxRolePage />,
              children: [
                {
                  id: AwxRoute.RoleDetails,
                  path: 'details',
                  element: <AwxRoleDetails />,
                },
                {
                  path: '',
                  element: <Navigate to="details" replace />,
                },
              ],
            },
            {
              path: '',
              element: <AwxRoles />,
            },
          ],
        },
        awxCredentialRoutes,
        awxCredentialTypesRoutes,
      ],
    },
  ];
  const settingsItems: PageNavigationItem[] = [
    {
      id: AwxRoute.Settings,
      label: t('Settings'),
      subtitle: t('System configuration'),
      path: 'settings',
      icon: <CogIcon />,
      children: [
        {
          id: AwxRoute.SettingsPreferences,
          label: t('User Preferences'),
          path: 'preferences',
          children: [
            {
              path: 'edit',
              element: <PageSettingsForm />,
            },
            {
              path: '',
              element: <PageSettingsDetails />,
            },
          ],
        },
        {
          id: AwxRoute.SettingsUi,
          label: t('User Interface'),
          path: 'user-interface',
          children: [
            {
              path: 'edit',
              element: <AwxSettingsCategoryForm categoryId="ui" key="ui" />,
            },
            {
              path: '',
              element: <Navigate to="edit" replace />,
            },
          ],
        },
        {
          id: AwxRoute.SettingsSystem,
          label: t('System'),
          path: 'system',
          children: [
            {
              path: 'edit',
              element: <AwxSettingsCategoryForm categoryId="system" key="system" />,
            },
            {
              path: '',
              element: <AwxSettingsCategoryDetailsPage categoryId="system" key="system" />,
            },
          ],
        },
        {
          id: AwxRoute.SettingsJobs,
          label: t('Job'),
          path: 'job-settings',
          children: [
            {
              path: 'edit',
              element: <AwxSettingsCategoryForm categoryId="jobs" key="jobs" />,
            },
            {
              path: '',
              element: <AwxSettingsCategoryDetailsPage categoryId="jobs" key="jobs" />,
            },
          ],
        },
        {
          id: AwxRoute.SettingsLogging,
          label: t('Logging'),
          path: 'logging',
          children: [
            {
              path: 'edit',
              element: <AwxSettingsCategoryForm categoryId="logging" key="logging" />,
            },
            {
              path: '',
              element: <AwxSettingsCategoryDetailsPage categoryId="logging" key="logging" />,
            },
          ],
        },
        {
          id: AwxRoute.SettingsTroubleshooting,
          label: t('Troubleshooting'),
          path: 'troubleshooting',
          children: [
            {
              path: 'edit',
              element: <AwxSettingsCategoryForm categoryId="debug" key="debug" />,
            },
            {
              path: '',
              element: (
                <AwxSettingsCategoryDetailsPage
                  categoryId="debug"
                  smokePanel="policy"
                  key="debug"
                />
              ),
            },
          ],
        },
        {
          id: AwxRoute.SettingsModules,
          label: t('Modules'),
          path: 'modules',
          children: [
            {
              path: 'edit',
              element: <AwxSettingsCategoryForm categoryId="modules" key="modules" />,
            },
            {
              path: '',
              element: <AwxSettingsCategoryDetailsPage categoryId="modules" key="modules" />,
            },
          ],
        },
        {
          id: AwxRoute.SettingsPolicyAsCode,
          label: t('Policy Connections'),
          path: 'policy-as-code',
          children: [
            {
              path: '',
              element: <Navigate to="../opa" replace />,
            },
            {
              path: 'edit',
              element: <Navigate to="../opa/edit" replace />,
            },
          ],
          hidden: true,
        },
        {
          id: AwxRoute.SettingsOpa,
          label: t('OPA'),
          path: 'opa',
          children: [
            {
              path: 'edit',
              element: (
                <AwxSettingsCategoryForm
                  categoryId="opa"
                  title={t('OPA')}
                  optionFilter={isOpaSetting}
                  key="opa"
                />
              ),
            },
            {
              path: '',
              element: (
                <AwxSettingsCategoryDetailsPage
                  categoryId="opa"
                  title={t('OPA')}
                  optionFilter={isOpaSetting}
                  smokePanel="opa"
                  key="opa"
                />
              ),
            },
          ],
        },
        {
          id: AwxRoute.SettingsGatekeeper,
          label: t('Gatekeeper'),
          path: 'gatekeeper',
          children: [
            {
              path: 'edit',
              element: (
                <AwxSettingsCategoryForm
                  categoryId="gatekeeper"
                  title={t('Gatekeeper Kubernetes')}
                  optionFilter={isGatekeeperSetting}
                  key="gatekeeper"
                />
              ),
            },
            {
              path: '',
              element: (
                <AwxSettingsCategoryDetailsPage
                  categoryId="gatekeeper"
                  title={t('Gatekeeper Kubernetes')}
                  optionFilter={isGatekeeperSetting}
                  smokePanel="gatekeeper"
                  key="gatekeeper"
                />
              ),
            },
          ],
        },
        {
          id: AwxRoute.SettingsAiAssistant,
          label: t('AI Assistant'),
          path: 'ai-assistant',
          children: [
            {
              path: 'edit',
              element: <AwxSettingsCategoryForm categoryId="ai-assistant" key="ai-assistant" />,
            },
            {
              path: '',
              element: (
                <AwxSettingsCategoryDetailsPage categoryId="ai-assistant" key="ai-assistant" />
              ),
            },
          ],
        },
        {
          id: AwxRoute.SettingsEda,
          label: t('Event-Driven Ansible'),
          path: 'eda',
          children: [
            {
              path: 'edit',
              element: <AwxSettingsCategoryForm categoryId="eda" key="eda" />,
            },
            {
              path: '',
              element: <AwxSettingsCategoryDetailsPage categoryId="eda" key="eda" />,
            },
          ],
        },
        {
          id: AwxRoute.SettingsGalaxyNG,
          label: t('Galaxy NG'),
          path: 'galaxy-ng',
          children: [
            {
              path: 'edit',
              element: <AwxSettingsCategoryForm categoryId="galaxy-ng" key="galaxy-ng" />,
            },
            {
              path: '',
              element: <AwxSettingsCategoryDetailsPage categoryId="galaxy-ng" key="galaxy-ng" />,
            },
          ],
        },
        {
          id: AwxRoute.SettingsQuay,
          label: t('Project Quay'),
          path: 'quay',
          children: [
            {
              path: 'edit',
              element: <AwxSettingsCategoryForm categoryId="quay" key="quay" />,
            },
            {
              path: '',
              element: <AwxSettingsCategoryDetailsPage categoryId="quay" key="quay" />,
            },
          ],
        },
        {
          id: AwxRoute.SettingsOther,
          label: t('Other'),
          path: 'other',
          children: [
            {
              path: '',
              element: <AwxSettings filterGroups={(g) => g.id === 'other'} title={t('Other')} />,
            },
          ],
        },
        {
          path: '',
          element: <AwxSettings />,
        },
      ],
    },
  ];

  const profileItems = [profileRoutesOnly(awxUsersRoutes)];
  const isSystemUser = Boolean(activeAwxUser?.is_superuser || activeAwxUser?.is_system_auditor);

  if (activeAwxUser && !isSystemUser) {
    const permissionInfrastructureChildren = [
      ...(capabilities.canViewInventory ? [awxInventoryRoutes, awxHostRoutes] : []),
      ...(capabilities.canViewInstanceGroups ? [awxInstanceGroupsRoutes] : []),
      ...(capabilities.canViewExecutionEnvironments ? [awxExecutionEnvironmentsRoutes] : []),
    ];
    const permissionInfrastructureItems: PageNavigationItem[] =
      permissionInfrastructureChildren.length > 0
        ? [
            {
              id: AwxRoute.Infrastructure,
              label: t('Infrastructure'),
              subtitle: t('Inventories and execution nodes'),
              path: 'infrastructure',
              icon: <ServerIcon />,
              children: permissionInfrastructureChildren,
            },
          ]
        : [];

    const permissionAdministrationChildren = [
      ...(capabilities.canViewActivityStream ? [awxActivityStreamRoutes] : []),
      ...(capabilities.canApproveWorkflows ? [awxWorkflowApprovalRoutes] : []),
    ];
    const permissionAdministrationItems: PageNavigationItem[] =
      permissionAdministrationChildren.length > 0
        ? [
            {
              id: AwxRoute.Administration,
              label: t('Administration'),
              subtitle: t('Activity and approvals'),
              path: 'administration',
              icon: <CogIcon />,
              children: permissionAdministrationChildren,
            },
          ]
        : [];

    const permissionAccessChildren = [
      ...(capabilities.canViewOrganizations ? [awxOrganizationRoutes] : []),
      ...(capabilities.canViewTeams ? [awxTeamsRoutes] : []),
      ...(capabilities.canViewUsers ? [awxUsersRoutes] : []),
      ...(capabilities.canViewCredentials ? [awxCredentialRoutes] : []),
    ];
    const permissionAccessItems: PageNavigationItem[] =
      permissionAccessChildren.length > 0
        ? [
            {
              id: AwxRoute.Access,
              label: t('Access Management'),
              subtitle: t('Identity and RBAC'),
              path: 'access',
              icon: <UsersIcon />,
              children: permissionAccessChildren,
            },
          ]
        : [];

    const automationExecutionChildren = [
      awxJobsRoutes,
      ...(capabilities.canViewTemplates ? [awxTemplateRoutes, awxTerraformRoutes] : []),
      ...(capabilities.canViewSchedules ? [awxSchedulesRoutes] : []),
      ...(capabilities.canViewProjects ? [awxProjectRoutes] : []),
      ...permissionInfrastructureItems,
      ...permissionAdministrationItems,
    ];
    const automationContentItems = [
      ...(capabilities.canViewCatalog
        ? [
            withNavigationDetails(
              filterCatalogRoutesByPermissions(awxCatalogRoutes, capabilities.canManageCatalog),
              t('Automation Content'),
              t('Service Catalog')
            ),
          ]
        : []),
      ...(moduleGalaxyNgEnabled && capabilities.canViewGalaxy
        ? [
            withNavigationDetails(
              filterGalaxyRoutesByPermissions(awxGalaxyRoutes, capabilities.canManageGalaxy),
              t('Galaxy NG'),
              t('Private automation hub')
            ),
          ]
        : []),
      ...(moduleQuayEnabled && capabilities.canViewQuay
        ? [
            withNavigationDetails(
              filterQuayRoutesByPermissions(awxQuayRoutes, capabilities.canManageQuay),
              t('Project Quay'),
              t('Execution environment registry')
            ),
          ]
        : []),
      ...(capabilities.canViewCloud
        ? [withNavigationDetails(awxCloudRoutes, t('Cloud'), t('Provider connections'))]
        : []),
    ];

    const automationExecutionGroup = pathlessNavigationGroup(
      AwxNavigationGroup.AutomationExecution,
      t('Automation Execution'),
      t('Automation Controller'),
      automationExecutionChildren
    );

    return [
      ...overview,
      ...(hasVisibleSidebarItem(automationExecutionGroup) ? [automationExecutionGroup] : []),
      ...automationContentItems,
      ...(modulePolicyEnabled && capabilities.canViewPolicy
        ? [
            withNavigationDetails(
              filterPolicyRoutesByPermissions(
                awxPolicyRoutesForModules,
                capabilities.canManagePolicy
              ),
              t('Policy as Code'),
              policySubtitle
            ),
          ]
        : []),
      ...(moduleEdaEnabled && capabilities.canViewEda
        ? [
            {
              ...withNavigationDetails(
                awxEdaRoutes,
                t('Automation Decisions'),
                t('Event-Driven Ansible')
              ),
              icon: <ProcessAutomationIcon />,
            },
          ]
        : []),
      ...permissionAccessItems,
      ...(capabilities.canViewUsers ? [] : profileItems),
      {
        path: '',
        element: <Navigate to="./overview" replace />,
      },
    ];
  }

  const automationExecutionGroup = pathlessNavigationGroup(
    AwxNavigationGroup.AutomationExecution,
    t('Automation Execution'),
    t('Automation Controller'),
    [
      awxJobsRoutes,
      awxTemplateRoutes,
      awxSchedulesRoutes,
      awxProjectRoutes,
      awxTerraformRoutes,
      ...infrastructureItems,
      ...administrationItems,
    ]
  );
  const navigationItems = [
    ...overview,
    ...(hasVisibleSidebarItem(automationExecutionGroup) ? [automationExecutionGroup] : []),
    withNavigationDetails(awxCatalogRoutes, t('Automation Content'), t('Service Catalog')),
    ...(moduleGalaxyNgEnabled
      ? [withNavigationDetails(awxGalaxyRoutes, t('Galaxy NG'), t('Private automation hub'))]
      : []),
    ...(moduleQuayEnabled
      ? [
          withNavigationDetails(
            awxQuayRoutes,
            t('Project Quay'),
            t('Execution environment registry')
          ),
        ]
      : []),
    ...(activeAwxUser?.is_superuser || activeAwxUser?.is_system_auditor
      ? [withNavigationDetails(awxCloudRoutes, t('Cloud'), t('Provider connections'))]
      : []),
    ...(modulePolicyEnabled && (activeAwxUser?.is_superuser || activeAwxUser?.is_system_auditor)
      ? [withNavigationDetails(awxPolicyRoutesForModules, t('Policy as Code'), policySubtitle)]
      : []),
    ...(moduleEdaEnabled && (activeAwxUser?.is_superuser || activeAwxUser?.is_system_auditor)
      ? [
          {
            ...withNavigationDetails(
              awxEdaRoutes,
              t('Automation Decisions'),
              t('Event-Driven Ansible')
            ),
            icon: <ProcessAutomationIcon />,
          },
        ]
      : []),
    ...(activeAwxUser?.is_superuser || activeAwxUser?.is_system_auditor ? analyticsItems : []),
    ...accessItems,
    ...settingsItems,
    {
      path: '',
      element: (
        <Navigate
          to={
            activeAwxUser && !activeAwxUser.is_superuser && !activeAwxUser.is_system_auditor
              ? './catalog/browse'
              : './overview'
          }
          replace
        />
      ),
    },
  ];

  return navigationItems;
}
