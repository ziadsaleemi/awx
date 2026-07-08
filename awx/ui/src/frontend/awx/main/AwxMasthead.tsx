import { Brand, Button, ButtonVariant } from '@patternfly/react-core';
import { Icon, ToolbarGroup, ToolbarItem } from '@patternfly/react-core';
import { DropdownItem } from '@patternfly/react-core/deprecated';
import {
  ExternalLinkAltIcon,
  HistoryIcon,
  QuestionCircleIcon,
  UserCircleIcon,
} from '@patternfly/react-icons';
import {
  AI_ASSISTANT_CONTEXT_EVENT,
  AIAssistantButton,
  AIAssistantPanel,
  openAIAssistantWithContext,
  useAIAssistantEnabled,
} from '../common/AIAssistant';
import { ContextualAIAssistantButton } from '../common/ContextualAIAssistantButton';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageMasthead, useGetPageUrl, usePageNavigate } from '../../../framework';
import { PageMastheadDropdown } from '../../../framework/PageMasthead/PageMastheadDropdown';
import { PageNotificationsIcon } from '../../../framework/PageMasthead/PageNotificationsIcon';
import { PageThemeSwitcher } from '../../../framework/PageMasthead/PageThemeSwitcher';
import { usePageNotifications } from '../../../framework/PageNotifications/PageNotificationsProvider';
import { useAnsibleAboutModal } from '../../common/AboutModal';
import { PageRefreshIcon } from '../../common/PageRefreshIcon';
import { useGet } from '../../common/crud/useGet';
import { usePostRequest } from '../../common/crud/usePostRequest';
import { AwxItemsResponse } from '../common/AwxItemsResponse';
import { awxAPI } from '../common/api/awx-utils';
import { useAwxActiveUser } from '../common/useAwxActiveUser';
import { useAwxConfig } from '../common/useAwxConfig';
import { useAwxWebSocketSubscription } from '../common/useAwxWebSocket';
import { useGetDocsUrl } from '../common/util/useGetDocsUrl';
import { WorkflowApproval } from '../interfaces/WorkflowApproval';
import { AwxRoute } from './AwxRoutes';
import { AwxGlobalSearch } from './AwxGlobalSearch';
import { AwxSystemUsageBar } from './AwxSystemUsageBar';
import { useAwxNavigationCapabilities } from './awxNavigationCapabilities';
import { getWorkflowApprovalNotificationUrl } from './workflowApprovalNotification';

const LOGO_SIZE_KEY = 'awx-navbar-logo-size';
const CUSTOM_LOGO_KEY = 'awx-custom-logo';
const BLANK_BRAND_IMAGE =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"%3E%3C/svg%3E';

function getCachedCustomLogo() {
  if (typeof window === 'undefined') {
    return undefined;
  }
  try {
    return window.localStorage.getItem(CUSTOM_LOGO_KEY) || undefined;
  } catch {
    return undefined;
  }
}

function cacheCustomLogo(logo?: string) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    if (logo) {
      window.localStorage.setItem(CUSTOM_LOGO_KEY, logo);
    } else {
      window.localStorage.removeItem(CUSTOM_LOGO_KEY);
    }
  } catch {
    // Ignore browsers that block local storage.
  }
}

function applyCustomFavicon(logo: string) {
  const iconLinks = document.querySelectorAll<HTMLLinkElement>(
    'link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]'
  );
  iconLinks.forEach((link) => {
    link.href = logo;
    if (logo.startsWith('data:image/png')) {
      link.type = 'image/png';
    } else if (logo.startsWith('data:image/svg')) {
      link.type = 'image/svg+xml';
    }
  });

  const manifestLink = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!manifestLink || typeof URL === 'undefined' || typeof Blob === 'undefined') {
    return undefined;
  }

  const manifestUrl = URL.createObjectURL(
    new Blob(
      [
        JSON.stringify({
          name: 'AWX',
          short_name: 'AWX',
          start_url: '/',
          display: 'standalone',
          background_color: '#000000',
          theme_color: '#000000',
          icons: [
            {
              src: logo,
              sizes: 'any',
              type: logo.startsWith('data:image/png') ? 'image/png' : 'image/svg+xml',
            },
          ],
        }),
      ],
      { type: 'application/manifest+json' }
    )
  );
  manifestLink.href = manifestUrl;
  return () => URL.revokeObjectURL(manifestUrl);
}

export function AwxMasthead() {
  const { t } = useTranslation();
  const openAnsibleAboutModal = useAnsibleAboutModal();
  const config = useAwxConfig();
  const pageNavigate = usePageNavigate();
  const { activeAwxUser, refreshActiveAwxUser } = useAwxActiveUser();
  const capabilities = useAwxNavigationCapabilities(activeAwxUser);
  const canViewActivityStream = Boolean(
    activeAwxUser?.is_superuser ||
      activeAwxUser?.is_system_auditor ||
      capabilities.canViewActivityStream
  );
  useAwxNotifications();
  const { enabled: aiEnabled } = useAIAssistantEnabled();
  const [aiOpen, setAiOpen] = useState(false);

  const [logoHeight] = useState<number>(() => {
    try {
      const stored = window.localStorage.getItem(LOGO_SIZE_KEY);
      return stored ? parseInt(stored, 10) : 48;
    } catch {
      return 48;
    }
  });
  const [cachedCustomLogo, setCachedCustomLogo] = useState<string | undefined>(getCachedCustomLogo);
  const logout = useCallback(async () => {
    await fetch('/api/logout/');
    refreshActiveAwxUser?.();
  }, [refreshActiveAwxUser]);

  useEffect(() => {
    const openAssistant = () => setAiOpen(true);
    window.addEventListener(AI_ASSISTANT_CONTEXT_EVENT, openAssistant);
    return () => window.removeEventListener(AI_ASSISTANT_CONTEXT_EVENT, openAssistant);
  }, []);

  const customLogoSrc =
    config?.custom_logo && config.custom_logo.startsWith('data:image/')
      ? config.custom_logo
      : undefined;
  const brandLogoSrc = customLogoSrc ?? cachedCustomLogo;

  useEffect(() => {
    if (customLogoSrc) {
      cacheCustomLogo(customLogoSrc);
      setCachedCustomLogo(customLogoSrc);
    } else if (config) {
      cacheCustomLogo(undefined);
      setCachedCustomLogo(undefined);
    }
  }, [config, customLogoSrc]);

  useEffect(() => {
    if (!brandLogoSrc) {
      return undefined;
    }
    return applyCustomFavicon(brandLogoSrc);
  }, [brandLogoSrc]);

  const brandElement = brandLogoSrc ? (
    <Brand src={brandLogoSrc} alt={t('Custom logo')} style={{ height: logoHeight }} />
  ) : (
    <span
      aria-hidden="true"
      style={{ display: 'inline-block', height: logoHeight, width: logoHeight }}
    />
  );

  return (
    <>
      {aiEnabled && (
        <>
          <AIAssistantPanel isOpen={aiOpen} onClose={() => setAiOpen(false)} />
          <ContextualAIAssistantButton isEnabled={aiEnabled} />
        </>
      )}
      <PageMasthead brand={brandElement}>
        <ToolbarGroup variant="icon-button-group" style={{ flexGrow: 1 }}>
          <ToolbarItem style={{ marginLeft: 'auto' }}>
            <PageRefreshIcon />
          </ToolbarItem>
          <ToolbarItem>
            <AwxGlobalSearch />
          </ToolbarItem>
          {aiEnabled && (
            <ToolbarItem>
              <AIAssistantButton
                onClick={() => {
                  if (aiOpen) {
                    setAiOpen(false);
                  } else {
                    openAIAssistantWithContext({ source: 'masthead' });
                  }
                }}
                isActive={aiOpen}
              />
            </ToolbarItem>
          )}
          <ToolbarItem>
            <PageThemeSwitcher />
          </ToolbarItem>
          <ToolbarItem>
            <PageNotificationsIcon />
          </ToolbarItem>
          {canViewActivityStream && (
            <ToolbarItem>
              <Button
                variant="plain"
                aria-label={t('Activity Stream')}
                title={t('Activity Stream')}
                onClick={() => pageNavigate(AwxRoute.ActivityStream)}
                data-cy="masthead-activity-stream"
              >
                <HistoryIcon />
              </Button>
            </ToolbarItem>
          )}
          <ToolbarItem>
            <AwxSystemUsageBar />
          </ToolbarItem>
          <ToolbarItem>
            <PageMastheadDropdown id="help-menu" icon={<QuestionCircleIcon />}>
              <DropdownItem
                id="documentation"
                icon={<ExternalLinkAltIcon />}
                component="a"
                href={useGetDocsUrl(config, 'index')}
                target="_blank"
                data-cy="masthead-documentation"
              >
                {t('Documentation')}
              </DropdownItem>
              <DropdownItem
                id="about"
                onClick={() =>
                  openAnsibleAboutModal({ brandImageSrc: brandLogoSrc ?? BLANK_BRAND_IMAGE })
                }
                data-cy="masthead-about"
              >
                {t('About')}
              </DropdownItem>
            </PageMastheadDropdown>
          </ToolbarItem>
          <ToolbarItem>
            <PageMastheadDropdown
              id="account-menu"
              icon={
                <Icon size="lg">
                  <UserCircleIcon />
                </Icon>
              }
              label={activeAwxUser?.username}
            >
              <DropdownItem
                id="user-details"
                label={t('User details')}
                onClick={() =>
                  pageNavigate(AwxRoute.UserDetails, { params: { id: activeAwxUser?.id } })
                }
              >
                {t('User details')}
              </DropdownItem>
              <DropdownItem id="logout" label={t('Logout')} onClick={() => void logout()}>
                {t('Logout')}
              </DropdownItem>
            </PageMastheadDropdown>
          </ToolbarItem>
        </ToolbarGroup>
      </PageMasthead>
    </>
  );
}

export function useAwxNotifications() {
  const { t } = useTranslation();
  const getPageUrl = useGetPageUrl();
  const postRequest = usePostRequest();
  const postRequestRef = useRef(postRequest);

  const { data, refresh } = useGet<AwxItemsResponse<WorkflowApproval>>(
    awxAPI`/workflow_approvals/`,
    { page_size: 200, status: 'pending' }
  );
  const refreshRef = useRef(refresh);

  useEffect(() => {
    postRequestRef.current = postRequest;
    refreshRef.current = refresh;
  }, [postRequest, refresh]);

  const handleWebSocketMessage = useCallback(
    (message?: { group_name?: string; type?: string }) => {
      switch (message?.group_name) {
        case 'jobs':
          switch (message?.type) {
            case 'workflow_approval':
              void refresh();
              break;
          }
          break;
      }
    },
    [refresh]
  );

  useAwxWebSocketSubscription(
    { control: ['limit_reached_1'], jobs: ['status_changed'] },
    handleWebSocketMessage as (data: unknown) => void
  );

  const { setNotificationGroups } = usePageNotifications();
  useEffect(() => {
    setNotificationGroups((groups) => {
      groups['workflow-approvals'] = {
        title: t('Workflow Approvals'),
        count: data?.count ?? 0,
        notifications:
          data?.results.map((workflow_approval) => {
            const canApproveOrDeny =
              String(workflow_approval.can_approve_or_deny) === 'true' &&
              !workflow_approval.timed_out;
            return {
              title: workflow_approval.name,
              description: workflow_approval.summary_fields.workflow_job?.name,
              timestamp: workflow_approval.created,
              variant: 'info',
              to: getWorkflowApprovalNotificationUrl(getPageUrl, workflow_approval),
              actions: [
                {
                  label: t('Approve'),
                  variant: ButtonVariant.primary,
                  isDisabled: !canApproveOrDeny,
                  onClick: async () => {
                    await postRequestRef.current(
                      awxAPI`/workflow_approvals/${workflow_approval.id.toString()}/approve/`,
                      {}
                    );
                    void refreshRef.current();
                  },
                },
                {
                  label: t('Deny'),
                  variant: ButtonVariant.secondary,
                  isDanger: true,
                  isDisabled: !canApproveOrDeny,
                  onClick: async () => {
                    await postRequestRef.current(
                      awxAPI`/workflow_approvals/${workflow_approval.id.toString()}/deny/`,
                      {}
                    );
                    void refreshRef.current();
                  },
                },
              ],
            };
          }) ?? [],
      };
      return { ...groups };
    });
  }, [data, getPageUrl, setNotificationGroups, t]);

  return data?.count ?? 0;
}
