import { SecurityIcon } from '@patternfly/react-icons';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { PageNavigationItem } from '../../../../framework';
import { PolicyAsCode } from '../../resources/policy/PolicyAsCode';
import { AwxRoute } from '../AwxRoutes';

export function useAwxPolicyRoutes() {
  const { t } = useTranslation();

  return useMemo<PageNavigationItem>(
    () => ({
      id: AwxRoute.PolicyAsCode,
      label: t('Policy as Code'),
      path: 'policy-as-code',
      icon: <SecurityIcon />,
      children: [
        {
          id: AwxRoute.PolicyAsCodeOverview,
          label: t('Overview'),
          path: 'overview',
          element: <PolicyAsCode view="overview" />,
        },
        {
          id: AwxRoute.PolicyAsCodeGatekeeper,
          label: t('Gatekeeper'),
          path: 'gatekeeper',
          element: <PolicyAsCode view="gatekeeper" />,
        },
        {
          id: AwxRoute.PolicyAsCodeModules,
          label: t('Policy Modules'),
          path: 'modules',
          element: <PolicyAsCode view="modules" />,
        },
        {
          id: AwxRoute.PolicyAsCodeTester,
          label: t('Policy Tester'),
          path: 'tester',
          element: <PolicyAsCode view="tester" />,
        },
        {
          id: AwxRoute.PolicyAsCodeSmoke,
          label: t('Smoke Test'),
          path: 'smoke',
          element: <PolicyAsCode view="smoke" />,
        },
        {
          path: '',
          element: <Navigate to="overview" replace />,
        },
      ],
    }),
    [t]
  );
}
