import { useGet } from '../../../common/crud/useGet';
import { AwxItemsResponse } from '../../common/AwxItemsResponse';
import { useAwxActiveUser } from '../../common/useAwxActiveUser';
import { Organization } from '../../interfaces/Organization';

interface RoleListItem {
  id: number;
  name: string;
}

export function useCatalogAdminAccess() {
  const { activeAwxUser } = useAwxActiveUser();
  const adminOrgsUrl = activeAwxUser?.related?.admin_of_organizations;
  const shouldFetchAdminOrgs = Boolean(
    activeAwxUser && !activeAwxUser.is_superuser && adminOrgsUrl
  );
  const { data: adminOrgs, isLoading: isLoadingAdminOrgs } = useGet<AwxItemsResponse<Organization>>(
    shouldFetchAdminOrgs ? adminOrgsUrl : undefined
  );
  const rolesUrl = activeAwxUser?.related?.roles;
  const shouldFetchRoles = Boolean(activeAwxUser && !activeAwxUser.is_superuser && rolesUrl);
  const { data: roles, isLoading: isLoadingRoles } = useGet<AwxItemsResponse<RoleListItem>>(
    shouldFetchRoles ? rolesUrl : undefined
  );

  const customUserTypeRoleNames =
    activeAwxUser?.summary_fields?.custom_user_type?.role_definitions?.map((role) => role.name) ??
    [];
  const activeRoleNames = roles?.results.map((role) => role.name) ?? [];
  const hasCatalogAdminRole = [...customUserTypeRoleNames, ...activeRoleNames].some((roleName) =>
    ['Catalog Admin', 'Organization Catalog Admin', 'Organization CatalogItem Admin'].includes(
      roleName
    )
  );

  return {
    canManageCatalog: Boolean(
      activeAwxUser?.is_superuser || (adminOrgs?.count ?? 0) > 0 || hasCatalogAdminRole
    ),
    isLoading:
      activeAwxUser === undefined ||
      (shouldFetchAdminOrgs && isLoadingAdminOrgs) ||
      (shouldFetchRoles && isLoadingRoles),
  };
}
