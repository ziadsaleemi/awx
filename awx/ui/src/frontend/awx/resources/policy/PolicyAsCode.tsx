import { PageHeader, PageLayout } from '../../../../framework';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { OPAPolicyManagementPanel } from '../../administration/settings/OPAPolicyManagementPanel';
import { useAwxActiveUser } from '../../common/useAwxActiveUser';
import { useAwxConfig } from '../../common/useAwxConfig';
import { useAwxNavigationCapabilities } from '../../main/awxNavigationCapabilities';
import { GatekeeperPolicyManager } from './GatekeeperPolicyManager';

type PolicyAsCodeView = 'overview' | 'gatekeeper' | 'modules' | 'tester';

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
      : view === 'gatekeeper'
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
  if (view === 'gatekeeper' && !moduleGatekeeperEnabled) {
    return <Navigate to={moduleOpaEnabled ? '../overview' : '../../overview'} replace />;
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
    </PageLayout>
  );
}
