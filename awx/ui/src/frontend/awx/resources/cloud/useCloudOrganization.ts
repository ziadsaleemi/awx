import { useGet } from '../../../common/crud/useGet';
import { useAwxActiveUser } from '../../common/useAwxActiveUser';
import { Organization } from '../../interfaces/Organization';

interface OrgListResponse {
  count: number;
  results: Organization[];
}

export function useCloudOrganization() {
  const { activeAwxUser } = useAwxActiveUser();
  const adminOrgsUrl = activeAwxUser?.related?.admin_of_organizations ?? '';
  const { data: adminOrgsData } = useGet<OrgListResponse>(adminOrgsUrl || undefined);
  const adminOrgs = adminOrgsData?.results ?? [];
  const isOrgAdmin = adminOrgs.length > 0;
  const isSystemCloudUser =
    Boolean(activeAwxUser?.is_superuser) || Boolean(activeAwxUser?.is_system_auditor);

  return {
    activeAwxUser,
    adminOrgs,
    isOrgAdmin,
    canReadCloud: isSystemCloudUser || isOrgAdmin,
    canManageCloud: Boolean(activeAwxUser?.is_superuser) || isOrgAdmin,
    organizationId: isSystemCloudUser ? null : adminOrgs[0]?.id ?? null,
  };
}
