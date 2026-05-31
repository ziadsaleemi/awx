import { useGet } from '../../../common/crud/useGet';
import { AwxItemsResponse } from '../../common/AwxItemsResponse';
import { useAwxActiveUser } from '../../common/useAwxActiveUser';
import { Organization } from '../../interfaces/Organization';

export function useCatalogAdminAccess() {
  const { activeAwxUser } = useAwxActiveUser();
  const adminOrgsUrl = activeAwxUser?.related?.admin_of_organizations;
  const shouldFetchAdminOrgs = Boolean(
    activeAwxUser && !activeAwxUser.is_superuser && adminOrgsUrl
  );
  const { data: adminOrgs, isLoading: isLoadingAdminOrgs } = useGet<AwxItemsResponse<Organization>>(
    shouldFetchAdminOrgs ? adminOrgsUrl : undefined
  );

  return {
    canManageCatalog: Boolean(activeAwxUser?.is_superuser || (adminOrgs?.count ?? 0) > 0),
    isLoading: activeAwxUser === undefined || (shouldFetchAdminOrgs && isLoadingAdminOrgs),
  };
}
