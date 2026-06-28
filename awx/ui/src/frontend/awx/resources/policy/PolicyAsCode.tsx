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
import { PolicyAsCodeOverview } from './PolicyAsCodeOverview';

type PolicyAsCodeView =
  | 'overview'
  | 'opa-overview'
  | 'opa-modules'
  | 'opa-decisions'
  | 'opa-violations'
  | 'opa-project-sync'
  | 'opa-tester'
  | 'gatekeeper-overview'
  | 'gatekeeper-changes'
  | 'gatekeeper-templates'
  | 'gatekeeper-constraints'
  | 'gatekeeper-violations'
  | 'gatekeeper-configs';

function gatekeeperView(view: PolicyAsCodeView): GatekeeperPolicyManagerView | undefined {
  if (view === 'gatekeeper-overview') return 'overview';
  if (view === 'gatekeeper-changes') return 'changes';
  if (view === 'gatekeeper-templates') return 'templates';
  if (view === 'gatekeeper-constraints') return 'constraints';
  if (view === 'gatekeeper-violations') return 'violations';
  if (view === 'gatekeeper-configs') return 'configs';
  return undefined;
}

function opaView(view: PolicyAsCodeView): OPAPolicyManagerView | undefined {
  if (view === 'opa-overview') return 'overview';
  if (view === 'opa-modules') return 'modules';
  if (view === 'opa-decisions') return 'decisions';
  if (view === 'opa-violations') return 'violations';
  if (view === 'opa-project-sync') return 'project-sync';
  if (view === 'opa-tester') return 'tester';
  return undefined;
}

function policyTitle(view: PolicyAsCodeView, t: ReturnType<typeof useTranslation>['t']) {
  if (view === 'opa-overview') return t('OPA');
  if (view === 'opa-modules') return t('Policy Modules');
  if (view === 'opa-decisions') return t('OPA Decisions');
  if (view === 'opa-violations') return t('OPA Violations');
  if (view === 'opa-project-sync') return t('OPA Project Sync');
  if (view === 'opa-tester') return t('Policy Tester');
  if (view === 'gatekeeper-changes') return t('Gatekeeper Governed Changes');
  if (view === 'gatekeeper-templates') return t('Gatekeeper ConstraintTemplates');
  if (view === 'gatekeeper-constraints') return t('Gatekeeper Constraints');
  if (view === 'gatekeeper-violations') return t('Gatekeeper Violations');
  if (view === 'gatekeeper-configs') return t('Gatekeeper Configurations');
  if (gatekeeperView(view)) return t('Gatekeeper');
  return t('Policy as Code');
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
  if (
    (view === 'opa-modules' || view === 'opa-project-sync') &&
    activeAwxUser &&
    !capabilities.isLoading &&
    !canManagePolicy
  ) {
    return <Navigate to="../overview" replace />;
  }
  if ((view === 'overview' || opaPolicyView) && !moduleOpaEnabled) {
    return (
      <Navigate
        to={moduleGatekeeperEnabled ? '/policy-as-code/gatekeeper/overview' : '/overview'}
        replace
      />
    );
  }
  if (gatekeeperView(view) && !moduleGatekeeperEnabled) {
    return <Navigate to={moduleOpaEnabled ? '/policy-as-code/overview' : '/overview'} replace />;
  }
  const gatekeeperPolicyView = gatekeeperView(view);
  return (
    <PageLayout>
      <PageHeader title={title} />
      {view === 'overview' ? (
        <PolicyAsCodeOverview
          canManagePolicy={canManagePolicy}
          opaEnabled={moduleOpaEnabled}
          gatekeeperEnabled={moduleGatekeeperEnabled}
        />
      ) : null}
      {gatekeeperPolicyView ? (
        <GatekeeperPolicyManager view={gatekeeperPolicyView} canManagePolicy={canManagePolicy} />
      ) : null}
      {opaPolicyView ? (
        <OPAPolicyManager view={opaPolicyView} canManagePolicy={canManagePolicy} />
      ) : null}
    </PageLayout>
  );
}
