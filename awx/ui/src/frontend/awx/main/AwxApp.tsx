import { useEffect } from 'react';
import { PageApp } from '../../../framework/PageNavigation/PageApp';
import { awxAPI } from '../common/api/awx-utils';
import { AwxMasthead } from './AwxMasthead';
import { useAwxNavigation } from './useAwxNavigation';

/**
 * Prefetches key API data on app load so frequently-visited pages
 * (Overview dashboard, Instances) appear to load instantly.
 * The browser HTTP cache handles deduplication, so these requests
 * are effectively free when the same data is requested shortly after.
 */
function useAwxPrefetch() {
  useEffect(() => {
    const urls = [
      awxAPI`/dashboard/`,
      awxAPI`/instances/?page_size=50`,
      awxAPI`/config/`,
    ];
    for (const url of urls) {
      void fetch(url).catch(() => {
        // Prefetch errors are non-fatal — the actual component fetch will retry
      });
    }
  }, []);
}

export function AwxApp() {
  const navigation = useAwxNavigation();
  useAwxPrefetch();
  return (
    <PageApp
      masthead={<AwxMasthead />}
      navigation={navigation}
      basename={process.env.ROUTE_PREFIX}
      defaultRefreshInterval={30}
    />
  );
}
