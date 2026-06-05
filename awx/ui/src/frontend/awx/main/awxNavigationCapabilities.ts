import { useMemo } from 'react';
import useSWR from 'swr';
import { requestGet } from '../../common/crud/Data';
import { AwxItemsResponse } from '../common/AwxItemsResponse';
import { awxAPI } from '../common/api/awx-utils';
import { Team } from '../interfaces/Team';
import { AwxUser } from '../interfaces/User';

interface RoleDefinition {
  id: number;
  permissions?: string[];
}

interface RoleAssignment {
  role_definition: number;
}

export interface AwxNavigationCapabilities {
  isLoading: boolean;
  permissions: Set<string>;
  canViewCatalog: boolean;
  canManageCatalog: boolean;
  canViewTemplates: boolean;
  canViewSchedules: boolean;
  canViewProjects: boolean;
  canViewInventory: boolean;
  canViewInstanceGroups: boolean;
  canViewExecutionEnvironments: boolean;
  canViewCredentials: boolean;
  canViewOrganizations: boolean;
  canViewTeams: boolean;
  canViewUsers: boolean;
  canViewActivityStream: boolean;
  canApproveWorkflows: boolean;
  canViewCloud: boolean;
  canManageCloud: boolean;
  canViewPolicy: boolean;
  canManagePolicy: boolean;
  canViewEda: boolean;
  canOperateEda: boolean;
  canManageEda: boolean;
}

function hasAnyPermission(permissions: Set<string>, model: string, actions: string[]) {
  return actions.some((action) => permissions.has(`awx.${action}_${model}`));
}

function hasAnyExactPermission(permissions: Set<string>, codenames: string[]) {
  return codenames.some(
    (codename) => permissions.has(`awx.${codename}`) || permissions.has(`shared.${codename}`)
  );
}

export function getCustomUserTypeRoleDefinitionIds(activeAwxUser: AwxUser | null | undefined) {
  return (
    activeAwxUser?.summary_fields?.custom_user_type?.role_definitions
      ?.map((roleDefinition) => roleDefinition.id)
      .filter((id): id is number => typeof id === 'number') ?? []
  );
}

async function fetchAllPages<T>(url: string) {
  const results: T[] = [];
  let nextUrl: string | null | undefined = url;
  while (nextUrl) {
    const response: AwxItemsResponse<T> = await requestGet<AwxItemsResponse<T>>(nextUrl);
    results.push(...response.results);
    nextUrl = response.next;
  }
  return results;
}

async function fetchRoleDefinitionPermissions(activeAwxUser: AwxUser) {
  const customRoleDefinitionIds = getCustomUserTypeRoleDefinitionIds(activeAwxUser);
  const assignments = await fetchAllPages<RoleAssignment>(
    `${awxAPI`/role_user_assignments/`}?user_id=${encodeURIComponent(
      String(activeAwxUser.id)
    )}&page_size=200`
  );
  const teams = await fetchAllPages<Team>(
    activeAwxUser.related?.teams ?? awxAPI`/users/${String(activeAwxUser.id)}/teams/`
  ).catch(() => []);
  const teamAssignments = (
    await Promise.all(
      teams.map((team) =>
        fetchAllPages<RoleAssignment>(
          `${awxAPI`/role_team_assignments/`}?team_id=${encodeURIComponent(
            String(team.id)
          )}&page_size=200`
        ).catch(() => [])
      )
    )
  ).flat();

  const roleDefinitionIds = Array.from(
    new Set([
      ...customRoleDefinitionIds,
      ...assignments
        .map((assignment) => assignment.role_definition)
        .filter((id): id is number => typeof id === 'number'),
      ...teamAssignments
        .map((assignment) => assignment.role_definition)
        .filter((id): id is number => typeof id === 'number'),
    ])
  );

  const roleDefinitions = await Promise.all(
    roleDefinitionIds.map((id) =>
      requestGet<RoleDefinition>(awxAPI`/role_definitions/${String(id)}/`)
    )
  );
  return roleDefinitions.flatMap((roleDefinition) => roleDefinition.permissions ?? []);
}

export function buildAwxNavigationCapabilities(
  permissions: Iterable<string>,
  isLoading = false
): AwxNavigationCapabilities {
  const permissionSet = new Set(permissions);
  const canViewJobTemplates =
    hasAnyPermission(permissionSet, 'jobtemplate', [
      'view',
      'execute',
      'add',
      'change',
      'delete',
    ]) ||
    hasAnyPermission(permissionSet, 'workflowjobtemplate', [
      'view',
      'execute',
      'approve',
      'add',
      'change',
      'delete',
    ]);
  const canViewTerraformTemplates = hasAnyPermission(permissionSet, 'terraformjobtemplate', [
    'view',
    'execute',
    'add',
    'change',
    'delete',
  ]);
  const canViewProjects = hasAnyPermission(permissionSet, 'project', [
    'view',
    'use',
    'update',
    'add',
    'change',
    'delete',
  ]);
  const canViewInventory = hasAnyPermission(permissionSet, 'inventory', [
    'view',
    'use',
    'adhoc',
    'update',
    'add',
    'change',
    'delete',
  ]);
  const canViewOrganizations = hasAnyPermission(permissionSet, 'organization', [
    'view',
    'member',
    'audit',
    'add',
    'change',
    'delete',
  ]);
  const canViewTeams = hasAnyPermission(permissionSet, 'team', [
    'view',
    'member',
    'add',
    'change',
    'delete',
  ]);
  const canViewInstanceGroups = hasAnyPermission(permissionSet, 'instancegroup', [
    'view',
    'use',
    'add',
    'change',
    'delete',
  ]);
  const canViewExecutionEnvironments = hasAnyPermission(permissionSet, 'executionenvironment', [
    'view',
    'add',
    'change',
    'delete',
  ]);
  const canViewCredentials = hasAnyPermission(permissionSet, 'credential', [
    'view',
    'use',
    'add',
    'change',
    'delete',
  ]);
  const canApproveWorkflows = hasAnyPermission(permissionSet, 'workflowjobtemplate', ['approve']);
  const canViewCloud =
    hasAnyPermission(permissionSet, 'cloudproviderconnection', [
      'view',
      'add',
      'change',
      'delete',
    ]) ||
    hasAnyPermission(permissionSet, 'cloudproviderstate', ['view', 'add', 'change', 'delete']);
  const canManageCloud =
    hasAnyPermission(permissionSet, 'cloudproviderconnection', ['add', 'change', 'delete']) ||
    hasAnyPermission(permissionSet, 'cloudproviderstate', ['add', 'change', 'delete']);
  const canViewPolicy =
    permissionSet.has('awx.view_policyascode') ||
    permissionSet.has('shared.view_policyascode') ||
    permissionSet.has('awx.change_policyascode') ||
    permissionSet.has('shared.change_policyascode');
  const canManagePolicy =
    permissionSet.has('awx.change_policyascode') || permissionSet.has('shared.change_policyascode');
  const canViewEda = hasAnyExactPermission(permissionSet, [
    'view_edaactivation',
    'execute_edaactivation',
    'change_edaactivation',
  ]);
  const canOperateEda = hasAnyExactPermission(permissionSet, [
    'execute_edaactivation',
    'change_edaactivation',
  ]);
  const canManageEda = hasAnyExactPermission(permissionSet, ['change_edaactivation']);
  const canViewActivityStream =
    canViewJobTemplates ||
    canViewTerraformTemplates ||
    canViewProjects ||
    canViewInventory ||
    canViewInstanceGroups ||
    canViewExecutionEnvironments ||
    canViewCredentials ||
    canViewOrganizations ||
    canViewTeams ||
    canApproveWorkflows;

  return {
    isLoading,
    permissions: permissionSet,
    canViewCatalog: hasAnyPermission(permissionSet, 'catalogitem', [
      'view',
      'use',
      'add',
      'change',
      'delete',
    ]),
    canManageCatalog: hasAnyPermission(permissionSet, 'catalogitem', ['add', 'change', 'delete']),
    canViewTemplates: canViewJobTemplates || canViewTerraformTemplates,
    canViewSchedules:
      canViewJobTemplates || canViewTerraformTemplates || canViewProjects || canViewInventory,
    canViewProjects,
    canViewInventory,
    canViewInstanceGroups,
    canViewExecutionEnvironments,
    canViewCredentials,
    canViewOrganizations,
    canViewTeams,
    canViewUsers: hasAnyPermission(permissionSet, 'organization', [
      'member',
      'audit',
      'add',
      'change',
      'delete',
    ]),
    canViewActivityStream,
    canApproveWorkflows,
    canViewCloud,
    canManageCloud,
    canViewPolicy,
    canManagePolicy,
    canViewEda,
    canOperateEda,
    canManageEda,
  };
}

export function useAwxNavigationCapabilities(activeAwxUser: AwxUser | null | undefined) {
  const shouldFetch = Boolean(
    activeAwxUser && !activeAwxUser.is_superuser && !activeAwxUser.is_system_auditor
  );
  const customRoleDefinitionIds = getCustomUserTypeRoleDefinitionIds(activeAwxUser);
  const { data, isLoading } = useSWR(
    shouldFetch
      ? ['awx-navigation-capabilities', activeAwxUser?.id, customRoleDefinitionIds.join(',')]
      : undefined,
    () => fetchRoleDefinitionPermissions(activeAwxUser as AwxUser),
    { shouldRetryOnError: false }
  );

  return useMemo(
    () => buildAwxNavigationCapabilities(data ?? [], shouldFetch && isLoading),
    [data, isLoading, shouldFetch]
  );
}
