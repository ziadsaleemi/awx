import { Alert, Button } from '@patternfly/react-core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { requestGet } from '../../common/crud/Data';
import { useAwxActiveUser } from '../common/useAwxActiveUser';
import { awxAPI } from '../common/api/awx-utils';

const WARNING_BEFORE_EXPIRY_SECONDS = 120; // show warning 2 min before expiry
const CHECK_INTERVAL_MS = 10_000; // poll every 10 s

interface SettingsAuth {
  SESSION_COOKIE_AGE?: number;
}

export function AwxSessionTimeoutWarning() {
  const { t } = useTranslation();
  const { refreshActiveAwxUser } = useAwxActiveUser();
  const [showWarning, setShowWarning] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const lastActivityRef = useRef(Date.now());
  const sessionCookieAgeRef = useRef<number>(1800); // default 30 min

  // Load SESSION_COOKIE_AGE from AWX authentication settings
  useEffect(() => {
    void requestGet<SettingsAuth>(awxAPI`/settings/authentication/`)
      .then((settings) => {
        if (settings.SESSION_COOKIE_AGE && settings.SESSION_COOKIE_AGE > 0) {
          sessionCookieAgeRef.current = settings.SESSION_COOKIE_AGE;
        }
      })
      .catch(() => {
        // Keep the default; settings endpoint may require elevated perms
      });
  }, []);

  // Update last-activity timestamp on any user interaction
  const updateActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    setShowWarning(false);
  }, []);

  useEffect(() => {
    document.addEventListener('mousemove', updateActivity, { passive: true });
    document.addEventListener('keydown', updateActivity, { passive: true });
    document.addEventListener('click', updateActivity, { passive: true });
    return () => {
      document.removeEventListener('mousemove', updateActivity);
      document.removeEventListener('keydown', updateActivity);
      document.removeEventListener('click', updateActivity);
    };
  }, [updateActivity]);

  // Periodically check idle time and show warning when close to expiry
  useEffect(() => {
    const interval = setInterval(() => {
      const idleSeconds = (Date.now() - lastActivityRef.current) / 1000;
      const remaining = sessionCookieAgeRef.current - idleSeconds;

      if (remaining <= 0) {
        // Session has likely expired — trigger re-auth
        refreshActiveAwxUser?.();
      } else if (remaining <= WARNING_BEFORE_EXPIRY_SECONDS) {
        setShowWarning(true);
        setSecondsRemaining(Math.ceil(remaining));
      } else {
        setShowWarning(false);
      }
    }, CHECK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [refreshActiveAwxUser]);

  const extendSession = useCallback(() => {
    // Hitting any authenticated endpoint resets the Django session timer
    void fetch(awxAPI`/me/`).then(() => {
      lastActivityRef.current = Date.now();
      setShowWarning(false);
    });
  }, []);

  if (!showWarning) return null;

  return (
    <Alert
      variant="warning"
      isInline
      title={t('Your session will expire soon')}
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        zIndex: 9999,
        maxWidth: 480,
        boxShadow: 'var(--pf-v5-global--BoxShadow--lg)',
      }}
      actionLinks={
        <Button variant="link" onClick={extendSession} isInline>
          {t('Extend session')}
        </Button>
      }
    >
      {t('Your session will expire in {{seconds}} seconds due to inactivity.', {
        seconds: secondsRemaining,
      })}
    </Alert>
  );
}
