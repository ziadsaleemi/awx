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
          id: AwxRoute.PolicyAsCodeOpa,
          label: t('OPA'),
          path: 'opa',
          children: [
            {
              id: AwxRoute.PolicyAsCodeOpaOverview,
              label: t('Overview'),
              path: 'overview',
              element: <PolicyAsCode view="opa-overview" />,
            },
            {
              id: AwxRoute.PolicyAsCodeOpaModules,
              label: t('Policy Modules'),
              path: 'modules',
              element: <PolicyAsCode view="opa-modules" />,
            },
            {
              id: AwxRoute.PolicyAsCodeOpaDecisions,
              label: t('Decisions'),
              path: 'decisions',
              element: <PolicyAsCode view="opa-decisions" />,
            },
            {
              id: AwxRoute.PolicyAsCodeOpaViolations,
              label: t('Violations'),
              path: 'violations',
              element: <PolicyAsCode view="opa-violations" />,
            },
            {
              id: AwxRoute.PolicyAsCodeOpaProjectSync,
              label: t('Project Sync'),
              path: 'project-sync',
              element: <PolicyAsCode view="opa-project-sync" />,
            },
            {
              id: AwxRoute.PolicyAsCodeOpaTester,
              label: t('Policy Tester'),
              path: 'tester',
              element: <PolicyAsCode view="opa-tester" />,
            },
            {
              path: '',
              element: <Navigate to="overview" replace />,
              hidden: true,
            },
          ],
        },
        {
          id: AwxRoute.PolicyAsCodeGatekeeper,
          label: t('Gatekeeper'),
          path: 'gatekeeper',
          children: [
            {
              id: AwxRoute.PolicyAsCodeGatekeeperOverview,
              label: t('Overview'),
              path: 'overview',
              element: <PolicyAsCode view="gatekeeper-overview" />,
            },
            {
              id: AwxRoute.PolicyAsCodeGatekeeperChanges,
              label: t('Governed Changes'),
              path: 'changes',
              element: <PolicyAsCode view="gatekeeper-changes" />,
            },
            {
              id: AwxRoute.PolicyAsCodeGatekeeperTemplates,
              label: t('ConstraintTemplates'),
              path: 'templates',
              element: <PolicyAsCode view="gatekeeper-templates" />,
            },
            {
              id: AwxRoute.PolicyAsCodeGatekeeperConstraints,
              label: t('Constraints'),
              path: 'constraints',
              element: <PolicyAsCode view="gatekeeper-constraints" />,
            },
            {
              id: AwxRoute.PolicyAsCodeGatekeeperViolations,
              label: t('Violations'),
              path: 'violations',
              element: <PolicyAsCode view="gatekeeper-violations" />,
            },
            {
              id: AwxRoute.PolicyAsCodeGatekeeperConfigs,
              label: t('Configurations'),
              path: 'configurations',
              element: <PolicyAsCode view="gatekeeper-configs" />,
            },
            {
              path: '',
              element: <Navigate to="overview" replace />,
              hidden: true,
            },
          ],
        },
        {
          id: AwxRoute.PolicyAsCodeModules,
          label: t('Policy Modules'),
          path: 'modules',
          element: <Navigate to="../opa/modules" replace />,
          hidden: true,
        },
        {
          id: AwxRoute.PolicyAsCodeTester,
          label: t('Policy Tester'),
          path: 'tester',
          element: <Navigate to="../opa/tester" replace />,
          hidden: true,
        },
        {
          path: 'smoke',
          element: <Navigate to="/settings/troubleshooting" replace />,
          hidden: true,
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
