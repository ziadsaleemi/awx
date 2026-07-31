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
      label: t('Policy Guardrails'),
      path: 'policy-as-code',
      icon: <SecurityIcon />,
      children: [
        {
          path: 'overview',
          element: <Navigate to="../opa/modules" replace />,
          hidden: true,
        },
        {
          id: AwxRoute.PolicyAsCodeOpa,
          label: t('OPA'),
          subtitle: t('Policy decisions'),
          path: 'opa',
          children: [
            {
              id: AwxRoute.PolicyAsCodeOpaModules,
              label: t('Policy Modules'),
              path: 'modules',
              element: <PolicyAsCode view="opa-modules" />,
            },
            {
              path: 'modules/new',
              element: <PolicyAsCode view="opa-module-create" />,
              hidden: true,
            },
            {
              path: 'modules/detail',
              element: <PolicyAsCode view="opa-module-detail" />,
              hidden: true,
            },
            {
              path: 'modules/edit',
              element: <PolicyAsCode view="opa-module-edit" />,
              hidden: true,
            },
            {
              id: AwxRoute.PolicyAsCodeOpaDecisions,
              label: t('Decisions'),
              path: 'decisions',
              element: <PolicyAsCode view="opa-decisions" />,
            },
            {
              path: 'decisions/:id',
              element: <PolicyAsCode view="opa-decision-detail" />,
              hidden: true,
            },
            {
              id: AwxRoute.PolicyAsCodeOpaViolations,
              label: t('Violations'),
              path: 'violations',
              element: <PolicyAsCode view="opa-violations" />,
            },
            {
              path: 'violations/:id',
              element: <PolicyAsCode view="opa-violation-detail" />,
              hidden: true,
            },
            {
              path: 'project-sync',
              element: <Navigate to="/policy-as-code/opa/modules/new" replace />,
              hidden: true,
            },
            {
              id: AwxRoute.PolicyAsCodeOpaTester,
              label: t('Policy Tester'),
              path: 'tester',
              element: <PolicyAsCode view="opa-tester" />,
            },
            {
              path: 'overview',
              element: <Navigate to="/policy-as-code/opa/modules" replace />,
              hidden: true,
            },
            {
              path: '',
              element: <Navigate to="modules" replace />,
              hidden: true,
            },
          ],
        },
        {
          id: AwxRoute.PolicyAsCodeGatekeeper,
          label: t('Gatekeeper'),
          subtitle: t('Kubernetes admission'),
          path: 'gatekeeper',
          children: [
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
              path: 'templates/detail',
              element: <PolicyAsCode view="gatekeeper-template-detail" />,
              hidden: true,
            },
            {
              id: AwxRoute.PolicyAsCodeGatekeeperConstraints,
              label: t('Constraints'),
              path: 'constraints',
              element: <PolicyAsCode view="gatekeeper-constraints" />,
            },
            {
              path: 'constraints/detail',
              element: <PolicyAsCode view="gatekeeper-constraint-detail" />,
              hidden: true,
            },
            {
              id: AwxRoute.PolicyAsCodeGatekeeperViolations,
              label: t('Violations'),
              path: 'violations',
              element: <PolicyAsCode view="gatekeeper-violations" />,
            },
            {
              path: 'violations/detail',
              element: <PolicyAsCode view="gatekeeper-violation-detail" />,
              hidden: true,
            },
            {
              id: AwxRoute.PolicyAsCodeGatekeeperConfigs,
              label: t('Configurations'),
              path: 'configurations',
              element: <PolicyAsCode view="gatekeeper-configs" />,
            },
            {
              path: 'configurations/detail',
              element: <PolicyAsCode view="gatekeeper-config-detail" />,
              hidden: true,
            },
            {
              path: 'overview',
              element: <Navigate to="/policy-as-code/gatekeeper/templates" replace />,
              hidden: true,
            },
            {
              path: '',
              element: <Navigate to="templates" replace />,
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
          element: <Navigate to="opa/modules" replace />,
        },
      ],
    }),
    [t]
  );
}
