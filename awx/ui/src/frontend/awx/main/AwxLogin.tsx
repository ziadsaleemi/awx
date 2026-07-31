import { Alert, Page } from '@patternfly/react-core';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
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
import { AwxTenantRegistration } from './AwxTenantRegistration';
import { AwxTenantVerification } from './AwxTenantVerification';

type AwxAuthOptions = {
  [key: string]: {
    login_url: string;
    name?: string;
  };
};

const CUSTOM_LOGO_KEY = 'awx-custom-logo';
const STATIC_BRAND_LOGO = '/assets/brand-fallback.png';

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
  const { t } = useTranslation();
  const { data: options } = useSWR<AwxAuthOptions>(awxAPI`/auth/`, requestGet);
  // Fetch from the AllowAny root endpoint so custom_logo/custom_login_info are
  // available on the login page before the user authenticates.
  const { data: rootInfo } = useSWR<{
    custom_logo?: string;
    custom_login_info?: string;
    custom_login_background?: string;
    password_auth_methods?: string[];
    product_mode?: 'on_prem' | 'saas';
    registration_enabled?: boolean;
    registration_url?: string;
    registration_verification_url?: string;
    registration_terms_version?: string;
    registration_terms_url?: string;
    registration_privacy_url?: string;
    registration_bot_provider?: 'turnstile';
    registration_bot_site_key?: string;
  }>('/api/', requestGet);
  const authOptions: AuthOption[] = [];
  if (options && typeof options === 'object') {
    Object.keys(options).forEach((key) => {
      authOptions.push({
        login_url: options[key].login_url,
        name: options[key].name,
        type: key,
      });
    });
  }

  const { activeAwxUser, refreshActiveAwxUser } = useAwxActiveUser();
  const location = useLocation();
  const navigate = useNavigate();
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
    if (location.pathname === '/register/verify') {
      const token = new URLSearchParams(location.search).get('token') ?? '';
      if (!rootInfo) {
        return (
          <Page>
            <LoadingState />
          </Page>
        );
      }
      if (!rootInfo.registration_enabled || !rootInfo.registration_verification_url || !token) {
        return <Navigate to="/register" replace />;
      }
      return (
        <AwxTenantVerification
          verificationUrl={rootInfo.registration_verification_url}
          token={token}
          brandImg={brandImg}
          brandImgAlt={process.env.PRODUCT}
          textContent={rootInfo.custom_login_info}
          backgroundImgSrc={rootInfo.custom_login_background}
        />
      );
    }
    if (location.pathname === '/register') {
      if (!rootInfo) {
        return (
          <Page>
            <LoadingState />
          </Page>
        );
      }
      if (
        rootInfo.product_mode !== 'saas' ||
        !rootInfo.registration_enabled ||
        !rootInfo.registration_url ||
        !rootInfo.registration_terms_version ||
        !rootInfo.registration_terms_url ||
        !rootInfo.registration_privacy_url ||
        rootInfo.registration_bot_provider !== 'turnstile' ||
        !rootInfo.registration_bot_site_key
      ) {
        return <Navigate to="/" replace />;
      }
      return (
        <AwxTenantRegistration
          registrationUrl={rootInfo.registration_url}
          termsVersion={rootInfo.registration_terms_version}
          termsUrl={rootInfo.registration_terms_url}
          privacyUrl={rootInfo.registration_privacy_url}
          botProvider={rootInfo.registration_bot_provider}
          botSiteKey={rootInfo.registration_bot_site_key}
          brandImg={brandImg}
          brandImgAlt={process.env.PRODUCT}
          textContent={rootInfo.custom_login_info}
          backgroundImgSrc={rootInfo.custom_login_background}
          onSuccess={() => {
            navigate('/?registration=pending', { replace: true });
          }}
        />
      );
    }

    const query = new URLSearchParams(location.search);
    const registrationPending = query.get('registration') === 'pending';
    const registrationVerified = query.get('registration') === 'verified';
    const registeredUsername = query.get('username') ?? undefined;
    return (
      <AnsibleLogin
        authOptions={authOptions}
        loginApiUrl="/api/login/"
        loginSubtitle={
          rootInfo?.password_auth_methods?.includes('ldap')
            ? t('Use your local or LDAP directory credentials.')
            : undefined
        }
        onSuccess={() => {
          refreshActiveAwxUser?.();
          void mutate(() => true);
        }}
        brandImg={brandImg}
        brandImgAlt={process.env.PRODUCT}
        textContent={rootInfo?.custom_login_info}
        backgroundImgSrc={rootInfo?.custom_login_background}
        initialUsername={registeredUsername}
        formNotice={
          registrationPending ? (
            <Alert
              isInline
              variant="info"
              title={t('Check your email')}
              style={{ marginBottom: 'var(--pf-v5-global--spacer--lg)' }}
            >
              {t(
                'Open the verification link before signing in. No organization has been created yet.'
              )}
            </Alert>
          ) : registrationVerified ? (
            <Alert
              isInline
              variant="success"
              title={t('Organization verified')}
              style={{ marginBottom: 'var(--pf-v5-global--spacer--lg)' }}
            >
              {t('Log in with the administrator account you created.')}
            </Alert>
          ) : undefined
        }
        formFooter={
          rootInfo?.product_mode === 'saas' && rootInfo.registration_enabled ? (
            <Link to="/register">{t('Create an organization')}</Link>
          ) : undefined
        }
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
