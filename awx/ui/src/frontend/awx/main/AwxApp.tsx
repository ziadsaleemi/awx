import { useEffect } from 'react';
import { PageApp } from '../../../framework/PageNavigation/PageApp';
import { useAwxActiveUser } from '../common/useAwxActiveUser';
import { AwxMasthead } from './AwxMasthead';
import { AwxSessionTimeoutWarning } from './AwxSessionTimeoutWarning';
import { prefetchAwxUrls } from './awxPrefetch';
import { useAwxNavigation } from './useAwxNavigation';

/**
 * Prefetches key API data on app load so frequently visited pages and resource
 * count lookups can reuse the SWR cache instead of starting cold.
 */
function useAwxPrefetch(includeAdminResources: boolean) {
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      prefetchAwxUrls({ includeAdminResources });
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [includeAdminResources]);
}

export function AwxApp() {
  const navigation = useAwxNavigation();
  const { activeAwxUser } = useAwxActiveUser();
  const includeAdminResources = Boolean(
    activeAwxUser?.is_superuser || activeAwxUser?.is_system_auditor
  );
  useAwxPrefetch(includeAdminResources);
  return (
    <>
      <AwxSessionTimeoutWarning />
      <PageApp
        masthead={<AwxMasthead />}
        navigation={navigation}
        basename={process.env.ROUTE_PREFIX}
        defaultRefreshInterval={30}
      />
    </>
  );
}
