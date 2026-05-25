import {
  Brand,
  Login,
  LoginFooter,
  LoginForm,
  LoginMainBody,
  LoginMainFooter,
  LoginMainHeader,
} from '@patternfly/react-core';
import { ExclamationCircleIcon } from '@patternfly/react-icons';
import { ReactNode, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import styled from 'styled-components';
import { useFrameworkTranslations } from '../../../framework';
import { ErrorBoundary } from '../../../framework/components/ErrorBoundary';
import { getCookie } from '../crud/cookie';
import { createRequestError, RequestError } from '../crud/RequestError';
import { AuthOption, SocialAuthLogin } from '../SocialAuthLogin';

export function AnsibleLogin(props: {
  /** Title for the login main body header of the login page */
  loginTitle?: string;

  /** Subtitle for the login main body header of the login page */
  loginSubtitle?: string;

  /** The brand image for the login page */
  brandImg?: ReactNode;

  /** Attribute that specifies the alt text of the brand image for the login page */
  brandImgAlt: string;

  /** Content rendered inside of the text component of the login page */
  textContent?: string;

  /** Content rendered inside of social media login footer section */
  authOptions?: AuthOption[];

  /** Attribute that specifies the URL of the background image for the login page */
  backgroundImgSrc?: string;

  /** The url to the API endpoint for logging in */
  loginApiUrl: string;

  /** Callback function that is called when the user successfully logs in */
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const [translations] = useFrameworkTranslations();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [helperText, setHelperText] = useState<ReactNode>('');
  const location = useLocation();

  const { loginApiUrl } = props;
  const queryParams = new URLSearchParams(location.search);
  const nextPath = queryParams.get('next');
  const onSubmit = useCallback(async () => {
    try {
      const loginPageResponse = await fetch(loginApiUrl, {
        credentials: 'include',
        headers: { Accept: 'application/json,text/*' },
      });
      if (!loginPageResponse.ok) {
        throw await createRequestError(loginPageResponse);
      }

      const searchParams = new URLSearchParams();
      searchParams.set('username', username);
      searchParams.set('password', password);

      const headers = {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        ['X-Csrftoken']: getCookie('csrftoken') || '',
      };

      try {
        // We need to make a request to the login page first to get the CSRF token
        // the CSRF token is required for the login request
        // and is set as a cookie on the login page response
        const response = await fetch(loginApiUrl, {
          credentials: 'include',
          method: 'POST',
          headers,
          body: searchParams,
          redirect: 'manual',
        });
        if (!response.ok) {
          throw await createRequestError(response);
        }
      } catch (err) {
        if (!(err instanceof RequestError)) {
          throw err;
        }
        if (err.statusCode === 401 || err.statusCode === 403) {
          throw new Error(t('Invalid username or password. Please try again.'));
        } else if (err.statusCode !== 0) {
          throw err;
        }
      }

      if (nextPath) {
        window.location.href = nextPath;
      } else {
        props.onSuccess?.();
      }
    } catch (err) {
      if (err instanceof Error) {
        setHelperText(<ErrorSpanStyled>{err.message}</ErrorSpanStyled>);
      } else {
        setHelperText(
          <ErrorSpanStyled>{t('Invalid username or password. Please try again.')}</ErrorSpanStyled>
        );
      }
    }
  }, [loginApiUrl, password, props, t, username, nextPath]);

  const hasAuthFailedFlag = location.search.includes('auth_failed');
  useEffect(() => {
    if (hasAuthFailedFlag) {
      setHelperText(<ErrorSpanStyled>{t('Unable to complete social auth login')}</ErrorSpanStyled>);
    }
  }, [hasAuthFailedFlag, t]);

  // Need to use component version of PatternFly's LoginPage
  // because we need to be able to use a component for the brand image
  // SEE: https://github.com/patternfly/patternfly-react/blob/main/packages/react-core/src/components/LoginPage/LoginPage.tsx
  return (
    <LoginPageBackground
      style={
        props.backgroundImgSrc
          ? {
              backgroundImage: `url(${JSON.stringify(props.backgroundImgSrc)})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundAttachment: 'fixed',
            }
          : undefined
      }
    >
      {/* background applied via inline style above, no separate img element needed */}
      <ErrorBoundary message={translations.errorText}>
        <LoginStyled
          footer={
            props.textContent ? (
              <LoginFooter>
                <p>{props.textContent}</p>
              </LoginFooter>
            ) : undefined
          }
        >
          <BrandInCard>
            {typeof props.brandImg === 'string' ? (
              <Brand src={props.brandImg} alt={props.brandImgAlt} />
            ) : (
              props.brandImg
            )}
          </BrandInCard>
          <LoginMainHeader
            title={props.loginTitle ?? t('Log in to your account')}
            subtitle={props.loginSubtitle}
          />
          <LoginMainBody>
            <LoginForm
              showHelperText={!!helperText}
              helperText={helperText}
              helperTextIcon={<ErrorExclamationCircleIconStyled />}
              usernameLabel={t('Username')}
              usernameValue={username}
              onChangeUsername={(_, username) => {
                setHelperText('');
                setUsername(username);
              }}
              isValidUsername={!helperText || !!username}
              passwordLabel={t('Password')}
              passwordValue={password}
              onChangePassword={(_, password) => {
                setHelperText('');
                setPassword(password);
              }}
              isValidPassword={!helperText || !!password}
              isShowPasswordEnabled
              showPasswordAriaLabel={t('Show password')}
              hidePasswordAriaLabel={t('Hide password')}
              loginButtonLabel={t('Log in')}
              onLoginButtonClick={(event) => {
                event.preventDefault();
                if (!username) {
                  setHelperText(t('Username is required'));
                  return;
                }
                if (!password) {
                  setHelperText(t('Password is required'));
                  return;
                }
                void onSubmit();
              }}
            />
          </LoginMainBody>
          {props.authOptions && (
            <LoginMainFooter
              socialMediaLoginContent={
                props.authOptions ? <SocialAuthLogin options={props.authOptions} /> : undefined
              }
              socialMediaLoginAriaLabel={t('Log in with authentication provider')}
            />
          )}
        </LoginStyled>
      </ErrorBoundary>
    </LoginPageBackground>
  );
}

const ErrorSpanStyled = styled.span`
  color: var(--pf-v5-global--danger-color--200);
`;

const ErrorExclamationCircleIconStyled = styled(ExclamationCircleIcon)`
  color: var(--pf-v5-global--danger-color--100);
`;

/** Fills the viewport; background image is applied via inline style */
const LoginPageBackground = styled.div`
  min-height: 100vh;
`;

/** Login card gets a subtle shadow to stand out from any background image.
 *  Outer container is transparent so the background image shows through.
 *  On wide screens the card is shifted left so background art is visible. */
const LoginStyled = styled(Login)`
  background-color: transparent !important;
  --pf-v5-c-login--BackgroundColor: transparent;
  .pf-v5-c-login__main {
    box-shadow: 0 4px 40px rgba(0, 0, 0, 0.3);
  }
  @media (min-width: 1200px) {
    justify-content: flex-start;
    padding-left: 10%;
  }
  @media (min-width: 1920px) {
    padding-left: 15%;
  }
`;

const BrandInCard = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 24px 0 16px;
  img {
    height: 52px;
    max-width: 220px;
  }
`;
