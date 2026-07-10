import { Page } from '@patternfly/react-core';
import { useEffect, useState } from 'react';
import useSWR, { mutate } from 'swr';
import { LoadingState } from '../../../framework/components/LoadingState';
import { AnsibleLogin } from '../../common/AnsibleLogin/AnsibleLogin';
import type { AuthOption } from '../../common/SocialAuthLogin';
import { requestGet } from '../../common/crud/Data';
import { awxAPI } from '../common/api/awx-utils';
import { useAwxActiveUser } from '../common/useAwxActiveUser';
import { AwxConfigProvider } from '../common/useAwxConfig';
import { WebSocketProvider } from '../common/useAwxWebSocket';
import { DocsVersionProvider } from '../common/useDocsVersion';

type AwxAuthOptions = {
  [key: string]: {
    login_url: string;
  };
};

const CUSTOM_LOGO_KEY = 'awx-custom-logo';
const STATIC_BRAND_LOGO = '/static/media/brand-logo.png';

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

export function AwxLogin(props: { children: React.ReactNode }) {
  const { data: options } = useSWR<AwxAuthOptions>(awxAPI`/auth/`, requestGet);
  // Fetch from the AllowAny root endpoint so custom_logo/custom_login_info are
  // available on the login page before the user authenticates.
  const { data: rootInfo } = useSWR<{
    custom_logo?: string;
    custom_login_info?: string;
    custom_login_background?: string;
  }>('/api/', requestGet);
  const authOptions: AuthOption[] = [];
  if (options && typeof options === 'object') {
    Object.keys(options).forEach((key) => {
      authOptions.push({ login_url: options[key].login_url, type: key });
    });
  }

  const { activeAwxUser, refreshActiveAwxUser } = useAwxActiveUser();
  const [cachedCustomLogo, setCachedCustomLogo] = useState<string | undefined>(getCachedCustomLogo);

  const customLogo =
    rootInfo?.custom_logo && rootInfo.custom_logo.startsWith('data:image/')
      ? rootInfo.custom_logo
      : undefined;

  useEffect(() => {
    if (customLogo) {
      setCachedCustomLogo(customLogo);
      try {
        window.localStorage.setItem(CUSTOM_LOGO_KEY, customLogo);
      } catch {
        // Ignore browsers that block local storage.
      }
    } else if (rootInfo) {
      setCachedCustomLogo(undefined);
      try {
        window.localStorage.removeItem(CUSTOM_LOGO_KEY);
      } catch {
        // Ignore browsers that block local storage.
      }
    }
  }, [customLogo, rootInfo]);

  if (activeAwxUser === undefined) {
    return (
      <Page>
        <LoadingState />
      </Page>
    );
  }

  const brandImg = customLogo ?? cachedCustomLogo ?? STATIC_BRAND_LOGO;

  if (!activeAwxUser) {
    return (
      <AnsibleLogin
        authOptions={authOptions}
        loginApiUrl="/api/login/"
        onSuccess={() => {
          refreshActiveAwxUser?.();
          void mutate(() => true);
        }}
        brandImg={brandImg}
        brandImgAlt={process.env.PRODUCT}
        textContent={rootInfo?.custom_login_info}
        backgroundImgSrc={rootInfo?.custom_login_background}
      />
    );
  }

  return (
    <DocsVersionProvider version={undefined}>
      <WebSocketProvider>
        <AwxConfigProvider>{props.children}</AwxConfigProvider>
      </WebSocketProvider>
    </DocsVersionProvider>
  );
}
