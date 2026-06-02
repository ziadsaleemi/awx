import { PageHeader, PageLayout } from '../../../../framework';
import { useTranslation } from 'react-i18next';
import { ExternalAutomationSmokePanel } from '../../administration/settings/ExternalAutomationSmokePanel';
import { OPAPolicyManagementPanel } from '../../administration/settings/OPAPolicyManagementPanel';

type PolicyAsCodeView = 'overview' | 'modules' | 'tester' | 'smoke';

export function PolicyAsCode(props: { view: PolicyAsCodeView }) {
  const { t } = useTranslation();
  const view = props.view;
  const title =
    view === 'modules'
      ? t('Policy Modules')
      : view === 'tester'
        ? t('Policy Tester')
        : view === 'smoke'
          ? t('OPA Smoke Test')
          : t('Policy as Code');

  return (
    <PageLayout>
      <PageHeader title={title} />
      {view === 'overview' ? <OPAPolicyManagementPanel sections={['status']} /> : null}
      {view === 'modules' ? <OPAPolicyManagementPanel sections={['modules']} /> : null}
      {view === 'tester' ? <OPAPolicyManagementPanel sections={['tester']} /> : null}
      {view === 'smoke' ? <ExternalAutomationSmokePanel includeEda={false} /> : null}
    </PageLayout>
  );
}
