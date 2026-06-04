import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { PageNavigationItem } from '../../../../framework';
import { CloudConnections } from '../../resources/cloud/CloudConnections';
import { CloudProviderSettings } from '../../resources/cloud/CloudProviderSettings';
import {
  cloudConnectionsChangedEvent,
  fetchCloudConnections,
} from '../../resources/cloud/cloudConnectionStore';
import { getCloudProviderLabel } from '../../resources/cloud/cloudProviders';
import { useCloudOrganization } from '../../resources/cloud/useCloudOrganization';
import { AwxRoute } from '../AwxRoutes';

export function useAwxCloudRoutes() {
  const { t } = useTranslation();
  const { organizationId } = useCloudOrganization();
  const [connectedProviders, setConnectedProviders] = useState<string[]>([]);

  const refreshConnectedProviders = useCallback(() => {
    void fetchCloudConnections(undefined, organizationId).then((entries) => {
      const providers = [
        ...new Set(entries.filter((e) => e.status === 'connected').map((e) => e.providerId)),
      ];
      setConnectedProviders(providers);
    });
  }, [organizationId]);

  useEffect(() => {
    refreshConnectedProviders();
    window.addEventListener(cloudConnectionsChangedEvent, refreshConnectedProviders);
    return () => {
      window.removeEventListener(cloudConnectionsChangedEvent, refreshConnectedProviders);
    };
  }, [refreshConnectedProviders]);

  return useMemo<PageNavigationItem>(() => {
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
  }, [connectedProviders, t]);
}
