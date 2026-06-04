import '@patternfly/patternfly/patternfly-addons.css';
import '@patternfly/patternfly/patternfly-base.css';
import '@patternfly/patternfly/patternfly-charts.css';

import '@patternfly/patternfly/patternfly-charts-theme-dark.css';

import { useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { IPageSettings, PageFramework, usePageSettingsSwitchUser } from '../../../framework';
import { requestPatch } from '../../common/crud/Data';
import '../../common/i18n';
import { AwxActiveUserProvider } from '../common/useAwxActiveUser';
import { useAwxActiveUser } from '../common/useAwxActiveUser';
import { AwxUser } from '../interfaces/User';
import { AwxApp } from './AwxApp';
import { AwxLogin } from './AwxLogin';
import { awxAPI } from '../common/api/awx-utils';

/** Syncs user-specific settings when the logged-in user changes. */
function AwxUserSettingsSync() {
  const { activeAwxUser, refreshActiveAwxUser } = useAwxActiveUser();
  const switchUser = usePageSettingsSwitchUser();
  useEffect(() => {
    if (activeAwxUser === undefined) return; // still loading
    if (!activeAwxUser) {
      switchUser(null);
      return;
    }
    switchUser(
      String(activeAwxUser.id),
      activeAwxUser.ui_preferences,
      async (settings: IPageSettings) => {
        await requestPatch<AwxUser, { ui_preferences: IPageSettings }>(awxAPI`/me/`, {
          ui_preferences: settings,
        });
        refreshActiveAwxUser?.();
      }
    );
  }, [activeAwxUser, refreshActiveAwxUser, switchUser]);
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
