import { Page } from '@patternfly/react-core';
import { useTranslation } from 'react-i18next';
import { PageHeader, PageLayout } from '../../../../framework';
import { useAwxActiveUser } from '../../common/useAwxActiveUser';
import { AutomationCalculator } from './AutomationCalculator';
import { AnalyticsErrorState } from './ErrorStates';

export function Reports() {
  const { t } = useTranslation();
  const { activeAwxUser } = useAwxActiveUser();
  const canViewCalculator = activeAwxUser?.is_superuser || activeAwxUser?.is_system_auditor;

  return (
    <Page>
      <PageLayout>
        <PageHeader
          title={t('Automation Calculator')}
          description={t(
            'Estimate time returned and cost avoidance from job runs visible in Capstan.'
          )}
        />
        {canViewCalculator ? <AutomationCalculator /> : <AnalyticsErrorState />}
      </PageLayout>
    </Page>
  );
}
