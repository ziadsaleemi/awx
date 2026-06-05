import { useMemo } from 'react';
import { useGet } from '../../../common/crud/useGet';
import { useAwxActiveUser } from '../../common/useAwxActiveUser';
import { AwxUser } from '../../interfaces/User';
import { Organization } from '../../interfaces/Organization';

interface OrgListResponse {
  count: number;
  results: Organization[];
}

interface RoleListItem {
  role_field?: string;
  summary_fields?: {
    resource_id?: number;
    resource_type?: string;
  };
}

interface RoleListResponse {
  count: number;
  results: RoleListItem[];
}

export function useCloudOrganization() {
  const { activeAwxUser } = useAwxActiveUser();

  const shouldFetchUserDetail =
    activeAwxUser !== undefined &&
    activeAwxUser !== null &&
    Boolean(activeAwxUser.url) &&
    (activeAwxUser.is_superuser === undefined || activeAwxUser.is_system_auditor === undefined);
  const { data: activeAwxUserDetail } = useGet<AwxUser>(
    shouldFetchUserDetail ? activeAwxUser.url : undefined
  );
  const cloudUser = activeAwxUserDetail ?? activeAwxUser;
  const isResolvingSystemRole = shouldFetchUserDetail && !activeAwxUserDetail;

  const adminOrgsUrl = cloudUser?.related?.admin_of_organizations ?? '';
  const { data: adminOrgsData } = useGet<OrgListResponse>(adminOrgsUrl || undefined);
  const adminOrgs = adminOrgsData?.results ?? [];
  const rolesUrl = cloudUser?.related?.roles ?? '';
  const shouldFetchRoles = Boolean(cloudUser && !cloudUser.is_superuser && rolesUrl);
  const { data: rolesData } = useGet<RoleListResponse>(shouldFetchRoles ? rolesUrl : undefined);
  const isOrgAdmin = adminOrgs.length > 0;
  const cloudOrgAccess = useMemo(() => {
    const adminOrgIds = new Set<number>();
    const userOrgIds = new Set<number>();
    let hasDirectCloudRead = false;
    let hasDirectCloudManage = false;
    for (const role of rolesData?.results ?? []) {
      if (
        role.summary_fields?.resource_type === 'cloud_provider_connection' ||
        role.summary_fields?.resource_type === 'cloud_provider_state'
      ) {
        hasDirectCloudRead = true;
        hasDirectCloudManage = role.role_field === 'admin_role' || hasDirectCloudManage;
        continue;
      }
      if (role.summary_fields?.resource_type !== 'organization') {
        continue;
      }
      const orgId = role.summary_fields.resource_id;
      if (typeof orgId !== 'number') {
        continue;
      }
      if (role.role_field === 'cloud_admin_role') {
        adminOrgIds.add(orgId);
        userOrgIds.add(orgId);
      }
      if (role.role_field === 'cloud_user_role') {
        userOrgIds.add(orgId);
      }
    }
    return {
      adminOrgIds: Array.from(adminOrgIds),
      userOrgIds: Array.from(userOrgIds),
      hasDirectCloudRead,
      hasDirectCloudManage,
    };
  }, [rolesData?.results]);
  const isSystemCloudUser =
    isResolvingSystemRole ||
    Boolean(cloudUser?.is_superuser) ||
    Boolean(cloudUser?.is_system_auditor);
  const cloudOrgId = cloudOrgAccess.adminOrgIds[0] ?? cloudOrgAccess.userOrgIds[0] ?? null;

  return {
    activeAwxUser: cloudUser,
    adminOrgs,
    isOrgAdmin,
    canReadCloud:
      isSystemCloudUser ||
      isOrgAdmin ||
      cloudOrgAccess.userOrgIds.length > 0 ||
      cloudOrgAccess.hasDirectCloudRead,
    canManageCloud:
      isResolvingSystemRole ||
      Boolean(cloudUser?.is_superuser) ||
      isOrgAdmin ||
      cloudOrgAccess.adminOrgIds.length > 0 ||
      cloudOrgAccess.hasDirectCloudManage,
    organizationId: isSystemCloudUser ? null : adminOrgs[0]?.id ?? cloudOrgId,
  };
}
