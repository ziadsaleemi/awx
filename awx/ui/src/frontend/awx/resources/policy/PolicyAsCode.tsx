import { PageHeader, PageLayout } from '../../../../framework';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { OPAPolicyManagementPanel } from '../../administration/settings/OPAPolicyManagementPanel';
import { useAwxActiveUser } from '../../common/useAwxActiveUser';
import { useAwxConfig } from '../../common/useAwxConfig';
import { useAwxNavigationCapabilities } from '../../main/awxNavigationCapabilities';
import { GatekeeperPolicyManager } from './GatekeeperPolicyManager';
import type { GatekeeperPolicyManagerView } from './GatekeeperPolicyManager';
import { PolicyAsCodeOverview } from './PolicyAsCodeOverview';

type PolicyAsCodeView =
  | 'overview'
  | 'gatekeeper-overview'
  | 'gatekeeper-changes'
  | 'gatekeeper-templates'
  | 'gatekeeper-constraints'
  | 'gatekeeper-violations'
  | 'gatekeeper-configs'
  | 'modules'
  | 'tester';

function gatekeeperView(view: PolicyAsCodeView): GatekeeperPolicyManagerView | undefined {
  if (view === 'gatekeeper-overview') return 'overview';
  if (view === 'gatekeeper-changes') return 'changes';
  if (view === 'gatekeeper-templates') return 'templates';
  if (view === 'gatekeeper-constraints') return 'constraints';
  if (view === 'gatekeeper-violations') return 'violations';
  if (view === 'gatekeeper-configs') return 'configs';
  return undefined;
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
  const title =
    view === 'modules'
      ? t('Policy Modules')
      : view === 'gatekeeper-changes'
        ? t('Gatekeeper Governed Changes')
        : view === 'gatekeeper-templates'
          ? t('Gatekeeper ConstraintTemplates')
          : view === 'gatekeeper-constraints'
            ? t('Gatekeeper Constraints')
            : view === 'gatekeeper-violations'
              ? t('Gatekeeper Violations')
              : view === 'gatekeeper-configs'
                ? t('Gatekeeper Configurations')
                : gatekeeperView(view)
                  ? t('Gatekeeper')
                  : view === 'tester'
                    ? t('Policy Tester')
                    : t('Policy as Code');

  if (view === 'modules' && activeAwxUser && !capabilities.isLoading && !canManagePolicy) {
    return <Navigate to="../overview" replace />;
  }
  if ((view === 'overview' || view === 'modules' || view === 'tester') && !moduleOpaEnabled) {
    return <Navigate to={moduleGatekeeperEnabled ? '../gatekeeper' : '../../overview'} replace />;
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
      {view === 'modules' ? (
        <OPAPolicyManagementPanel sections={['modules']} canManagePolicy={canManagePolicy} />
      ) : null}
      {view === 'tester' ? (
        <OPAPolicyManagementPanel sections={['tester']} canManagePolicy={canManagePolicy} />
      ) : null}
    </PageLayout>
  );
}
