import { PageHeader, PageLayout } from '../../../../framework';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { ExternalAutomationSmokePanel } from '../../administration/settings/ExternalAutomationSmokePanel';
import { OPAPolicyManagementPanel } from '../../administration/settings/OPAPolicyManagementPanel';
import { useAwxActiveUser } from '../../common/useAwxActiveUser';
import { useAwxNavigationCapabilities } from '../../main/awxNavigationCapabilities';
import { GatekeeperPolicyManager } from './GatekeeperPolicyManager';

type PolicyAsCodeView = 'overview' | 'gatekeeper' | 'modules' | 'tester' | 'smoke';

export function PolicyAsCode(props: { view: PolicyAsCodeView }) {
  const { t } = useTranslation();
  const { activeAwxUser } = useAwxActiveUser();
  const capabilities = useAwxNavigationCapabilities(activeAwxUser);
  const view = props.view;
  const canManagePolicy =
    Boolean(activeAwxUser?.is_superuser) || Boolean(capabilities.canManagePolicy);
  const title =
    view === 'modules'
      ? t('Policy Modules')
      : view === 'gatekeeper'
        ? t('Gatekeeper')
        : view === 'tester'
          ? t('Policy Tester')
          : view === 'smoke'
            ? t('Policy Smoke Test')
            : t('Policy as Code');

  if (view === 'modules' && activeAwxUser && !capabilities.isLoading && !canManagePolicy) {
    return <Navigate to="../overview" replace />;
  }

  return (
    <PageLayout>
      <PageHeader title={title} />
      {view === 'overview' ? (
        <OPAPolicyManagementPanel sections={['status']} canManagePolicy={canManagePolicy} />
      ) : null}
      {view === 'gatekeeper' ? <GatekeeperPolicyManager canManagePolicy={canManagePolicy} /> : null}
      {view === 'modules' ? (
        <OPAPolicyManagementPanel sections={['modules']} canManagePolicy={canManagePolicy} />
      ) : null}
      {view === 'tester' ? (
        <OPAPolicyManagementPanel sections={['tester']} canManagePolicy={canManagePolicy} />
      ) : null}
      {view === 'smoke' ? (
        <ExternalAutomationSmokePanel includeEda={false} includeGatekeeper />
      ) : null}
    </PageLayout>
  );
}
