import { PageHeader, PageLayout } from '../../../../framework';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { useAwxActiveUser } from '../../common/useAwxActiveUser';
import { useAwxConfig } from '../../common/useAwxConfig';
import { useAwxNavigationCapabilities } from '../../main/awxNavigationCapabilities';
import { GatekeeperPolicyManager } from './GatekeeperPolicyManager';
import type { GatekeeperPolicyManagerView } from './GatekeeperPolicyManager';
import { OPAPolicyManager } from './OPAPolicyManager';
import type { OPAPolicyManagerView } from './OPAPolicyManager';
import {
  GatekeeperResourceDetailPage,
  GatekeeperResourceList,
  OPAActivityDetailPage,
  OPAActivityPage,
  OPAPolicyModuleList,
  OPAPolicyModulePage,
} from './PolicyResourcePages';

type PolicyAsCodeView =
  | 'opa-modules'
  | 'opa-module-create'
  | 'opa-module-edit'
  | 'opa-module-detail'
  | 'opa-decisions'
  | 'opa-decision-detail'
  | 'opa-violations'
  | 'opa-violation-detail'
  | 'opa-tester'
  | 'gatekeeper-changes'
  | 'gatekeeper-templates'
  | 'gatekeeper-template-detail'
  | 'gatekeeper-constraints'
  | 'gatekeeper-constraint-detail'
  | 'gatekeeper-violations'
  | 'gatekeeper-violation-detail'
  | 'gatekeeper-configs'
  | 'gatekeeper-config-detail';

function gatekeeperView(view: PolicyAsCodeView): GatekeeperPolicyManagerView | undefined {
  if (view === 'gatekeeper-changes') return 'changes';
  return undefined;
}

function opaView(view: PolicyAsCodeView): OPAPolicyManagerView | undefined {
  if (view === 'opa-tester') return 'tester';
  return undefined;
}

function policyTitle(view: PolicyAsCodeView, t: ReturnType<typeof useTranslation>['t']) {
  if (view === 'opa-modules') return t('Policy Modules');
  if (view === 'opa-decisions') return t('OPA Decisions');
  if (view === 'opa-violations') return t('OPA Violations');
  if (view === 'opa-tester') return t('Policy Tester');
  if (view === 'gatekeeper-changes') return t('Gatekeeper Governed Changes');
  if (view === 'gatekeeper-templates') return t('Gatekeeper ConstraintTemplates');
  if (view === 'gatekeeper-constraints') return t('Gatekeeper Constraints');
  if (view === 'gatekeeper-violations') return t('Gatekeeper Violations');
  if (view === 'gatekeeper-configs') return t('Gatekeeper Configurations');
  if (gatekeeperView(view)) return t('Gatekeeper');
  return t('Policy as Code');
}

function policyDescription(view: PolicyAsCodeView, t: ReturnType<typeof useTranslation>['t']) {
  if (view === 'opa-modules') {
    return t('Manage live Rego modules, validation, version history, and rollback.');
  }
  if (view === 'opa-decisions') {
    return t('Review allowed and denied policy checks recorded in Activity Stream.');
  }
  if (view === 'opa-violations') {
    return t('Investigate denied policy checks that blocked protected Capstan actions.');
  }
  if (view === 'opa-tester') {
    return t('Evaluate sample input against live OPA decision paths before rollout.');
  }
  if (view === 'gatekeeper-changes') {
    return t(
      'Preview, apply, delete, and roll back Kubernetes policy resources with audit evidence.'
    );
  }
  if (view === 'gatekeeper-templates') {
    return t('Review the policy templates that define available Kubernetes constraints.');
  }
  if (view === 'gatekeeper-constraints') {
    return t('Inspect active admission constraints, enforcement modes, and violation counts.');
  }
  if (view === 'gatekeeper-violations') {
    return t('Triage out-of-policy resources and prepare governed remediation.');
  }
  if (view === 'gatekeeper-configs') {
    return t('Review Gatekeeper data-sync and readiness configuration resources.');
  }
  return t(
    'Operate OPA guardrails and Kubernetes admission policy from one audited control plane.'
  );
}

export function PolicyAsCode(props: { view: PolicyAsCodeView }) {
  const { t } = useTranslation();
  const { activeAwxUser } = useAwxActiveUser();
  const awxConfig = useAwxConfig();
  const capabilities = useAwxNavigationCapabilities(activeAwxUser);
  const view = props.view;
  const moduleOpaEnabled = awxConfig?.modules?.opa?.enabled !== false;
  const moduleGatekeeperEnabled = awxConfig?.modules?.gatekeeper?.enabled !== false;
  const canManagePolicy =
    Boolean(activeAwxUser?.is_superuser) || Boolean(capabilities.canManagePolicy);
  const title = policyTitle(view, t);

  const opaPolicyView = opaView(view);
  const isOpaView = view.startsWith('opa-');
  const isGatekeeperView = view.startsWith('gatekeeper-');
  if (
    (view === 'opa-modules' ||
      view === 'opa-module-create' ||
      view === 'opa-module-edit' ||
      view === 'opa-module-detail') &&
    activeAwxUser &&
    !capabilities.isLoading &&
    !canManagePolicy
  ) {
    return <Navigate to="/policy-as-code/opa/decisions" replace />;
  }
  if (isOpaView && !moduleOpaEnabled) {
    return (
      <Navigate
        to={moduleGatekeeperEnabled ? '/policy-as-code/gatekeeper/templates' : '/overview'}
        replace
      />
    );
  }
  if (isGatekeeperView && !moduleGatekeeperEnabled) {
    return (
      <Navigate
        to={
          moduleOpaEnabled
            ? canManagePolicy
              ? '/policy-as-code/opa/modules'
              : '/policy-as-code/opa/decisions'
            : '/overview'
        }
        replace
      />
    );
  }

  if (view === 'opa-module-create') {
    return <OPAPolicyModulePage mode="create" canManagePolicy={canManagePolicy} />;
  }
  if (view === 'opa-module-edit') {
    return <OPAPolicyModulePage mode="edit" canManagePolicy={canManagePolicy} />;
  }
  if (view === 'opa-module-detail') {
    return <OPAPolicyModulePage mode="detail" canManagePolicy={canManagePolicy} />;
  }
  if (view === 'opa-decision-detail') {
    return <OPAActivityDetailPage />;
  }
  if (view === 'opa-violation-detail') {
    return <OPAActivityDetailPage violationsOnly />;
  }
  if (view === 'gatekeeper-template-detail') {
    return <GatekeeperResourceDetailPage kind="templates" canManagePolicy={canManagePolicy} />;
  }
  if (view === 'gatekeeper-constraint-detail') {
    return <GatekeeperResourceDetailPage kind="constraints" canManagePolicy={canManagePolicy} />;
  }
  if (view === 'gatekeeper-violation-detail') {
    return <GatekeeperResourceDetailPage kind="violations" canManagePolicy={canManagePolicy} />;
  }
  if (view === 'gatekeeper-config-detail') {
    return <GatekeeperResourceDetailPage kind="configs" canManagePolicy={canManagePolicy} />;
  }

  const gatekeeperPolicyView = gatekeeperView(view);
  return (
    <PageLayout>
      <PageHeader title={title} description={policyDescription(view, t)} />
      {gatekeeperPolicyView ? (
        <GatekeeperPolicyManager view={gatekeeperPolicyView} canManagePolicy={canManagePolicy} />
      ) : null}
      {view === 'gatekeeper-templates' ? <GatekeeperResourceList kind="templates" /> : null}
      {view === 'gatekeeper-constraints' ? <GatekeeperResourceList kind="constraints" /> : null}
      {view === 'gatekeeper-violations' ? <GatekeeperResourceList kind="violations" /> : null}
      {view === 'gatekeeper-configs' ? <GatekeeperResourceList kind="configs" /> : null}
      {view === 'opa-modules' ? <OPAPolicyModuleList canManagePolicy={canManagePolicy} /> : null}
      {view === 'opa-decisions' ? <OPAActivityPage /> : null}
      {view === 'opa-violations' ? <OPAActivityPage violationsOnly /> : null}
      {opaPolicyView ? (
        <OPAPolicyManager view={opaPolicyView} canManagePolicy={canManagePolicy} />
      ) : null}
    </PageLayout>
  );
}
