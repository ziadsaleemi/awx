import { Alert, Button, Spinner } from '@patternfly/react-core';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AnsibleLoginPage } from '../../common/AnsibleLogin/AnsibleLogin';
import { postRequest } from '../../common/crud/Data';

interface VerificationResponse {
  user: { username: string };
}

export function AwxTenantVerification(props: {
  verificationUrl: string;
  token: string;
  brandImg?: ReactNode;
  brandImgAlt: string;
  textContent?: string;
  backgroundImgSrc?: string;
}) {
  const { t } = useTranslation();
  const started = useRef(false);
  const [username, setUsername] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void postRequest<VerificationResponse>(props.verificationUrl, { token: props.token })
      .then((response) => setUsername(response.user.username))
      .catch(() => setError(t('This verification link is invalid, expired, or already used.')));
  }, [props.token, props.verificationUrl, t]);

  return (
    <AnsibleLoginPage
      loginTitle={t('Verify your organization')}
      loginSubtitle={t('Confirming the first administrator and tenant execution pool.')}
      brandImg={props.brandImg}
      brandImgAlt={props.brandImgAlt}
      textContent={props.textContent}
      backgroundImgSrc={props.backgroundImgSrc}
    >
      {username ? (
        <Alert isInline variant="success" title={t('Organization verified')}>
          <p>{t('Your organization is ready. Sign in with {{ username }}.', { username })}</p>
          <Button
            component={(buttonProps) => (
              <Link
                {...buttonProps}
                to={`/?registration=verified&username=${encodeURIComponent(username)}`}
              />
            )}
            variant="link"
            isInline
          >
            {t('Continue to login')}
          </Button>
        </Alert>
      ) : error ? (
        <Alert isInline variant="danger" title={t('Unable to verify organization')}>
          <p>{error}</p>
          <Button
            component={(buttonProps) => <Link {...buttonProps} to="/register" />}
            variant="link"
            isInline
          >
            {t('Start a new registration')}
          </Button>
        </Alert>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '24px' }}>
          <Spinner aria-label={t('Verifying organization')} />
        </div>
      )}
    </AnsibleLoginPage>
  );
}
