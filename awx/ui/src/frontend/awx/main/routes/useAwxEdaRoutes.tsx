import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { PageNavigationItem } from '../../../../framework';
import { EdaActivationPage } from '../../resources/eda/EdaActivationPage';
import { EdaActivations } from '../../resources/eda/EdaActivations';
import { AwxRoute } from '../AwxRoutes';

export function useAwxEdaRoutes() {
  const { t } = useTranslation();
  return useMemo<PageNavigationItem>(
    () => ({
      id: AwxRoute.EventDriven,
      label: t('Event-Driven'),
      path: 'eda',
      children: [
        {
          id: AwxRoute.EdaActivations,
          label: t('Activations'),
          path: 'activations',
          children: [
            {
              id: AwxRoute.EdaActivationPage,
              path: ':id',
              element: <EdaActivationPage />,
            },
            {
              path: '',
              element: <EdaActivations />,
            },
          ],
        },
        {
          path: '',
          element: <Navigate to="activations" replace />,
        },
      ],
    }),
    [t]
  );
}
