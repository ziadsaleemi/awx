import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { PageNavigationItem } from '../../../../framework';
import { CloudConnections } from '../../resources/cloud/CloudConnections';
import { CloudProviderSettings } from '../../resources/cloud/CloudProviderSettings';
import {
  cloudConnectionsChangedEvent,
  getConnectedCloudProviders,
} from '../../resources/cloud/cloudConnectionStore';
import { getCloudProviderLabel } from '../../resources/cloud/cloudProviders';
import { AwxRoute } from '../AwxRoutes';

export function useAwxCloudRoutes() {
  const { t } = useTranslation();
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const listener = () => setRefreshKey((value) => value + 1);
    window.addEventListener(cloudConnectionsChangedEvent, listener);
    window.addEventListener('storage', listener);
    return () => {
      window.removeEventListener(cloudConnectionsChangedEvent, listener);
      window.removeEventListener('storage', listener);
    };
  }, []);

  return useMemo<PageNavigationItem>(() => {
    const connectedProviders = getConnectedCloudProviders();
    return {
      id: AwxRoute.Cloud,
      label: t('Cloud'),
      path: 'cloud',
      children: [
        {
          id: AwxRoute.CloudConnections,
          label: t('Connections'),
          path: 'connections',
          element: <CloudConnections />,
        },
        ...connectedProviders.map((provider) => ({
          id: `${AwxRoute.CloudProviderSettings}-${provider}`,
          label: t(getCloudProviderLabel(provider)),
          path: `providers/${provider}`,
          element: <CloudProviderSettings provider={provider} />,
        })),
        {
          path: '',
          element: <Navigate to="connections" replace />,
        },
      ],
    };
  }, [refreshKey, t]);
}
