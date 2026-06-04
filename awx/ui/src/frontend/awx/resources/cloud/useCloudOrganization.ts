import { useGet } from '../../../common/crud/useGet';
import { useAwxActiveUser } from '../../common/useAwxActiveUser';
import { AwxUser } from '../../interfaces/User';
import { Organization } from '../../interfaces/Organization';

interface OrgListResponse {
  count: number;
  results: Organization[];
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
  const isOrgAdmin = adminOrgs.length > 0;
  const isSystemCloudUser =
    isResolvingSystemRole ||
    Boolean(cloudUser?.is_superuser) ||
    Boolean(cloudUser?.is_system_auditor);

  return {
    activeAwxUser: cloudUser,
    adminOrgs,
    isOrgAdmin,
    canReadCloud: isSystemCloudUser || isOrgAdmin,
    canManageCloud: isResolvingSystemRole || Boolean(cloudUser?.is_superuser) || isOrgAdmin,
    organizationId: isSystemCloudUser ? null : adminOrgs[0]?.id ?? null,
  };
}
