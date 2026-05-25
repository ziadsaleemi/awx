import '@patternfly/patternfly/patternfly-addons.css';
import '@patternfly/patternfly/patternfly-base.css';
import '@patternfly/patternfly/patternfly-charts.css';

import '@patternfly/patternfly/patternfly-charts-theme-dark.css';

import { useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { PageFramework, usePageSettingsSwitchUser } from '../../../framework';
import '../../common/i18n';
import { AwxActiveUserProvider } from '../common/useAwxActiveUser';
import { useAwxActiveUser } from '../common/useAwxActiveUser';
import { AwxApp } from './AwxApp';
import { AwxLogin } from './AwxLogin';

/** Syncs user-specific settings when the logged-in user changes. */
function AwxUserSettingsSync() {
  const { activeAwxUser } = useAwxActiveUser();
  const switchUser = usePageSettingsSwitchUser();
  useEffect(() => {
    if (activeAwxUser === undefined) return; // still loading
    switchUser(activeAwxUser ? String(activeAwxUser.id) : null);
  }, [activeAwxUser, switchUser]);
  return null;
}

// eslint-disable-next-line no-restricted-exports
export default function AwxMain() {
  return (
    <BrowserRouter>
      <PageFramework defaultRefreshInterval={10}>
        <AwxActiveUserProvider>
          <AwxUserSettingsSync />
          <AwxLogin>
            <AwxApp />
          </AwxLogin>
        </AwxActiveUserProvider>
      </PageFramework>
    </BrowserRouter>
  );
}
