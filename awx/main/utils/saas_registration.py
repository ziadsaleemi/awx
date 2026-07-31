from django.conf import settings


def registration_configuration_errors():
    if settings.CAPSTAN_PRODUCT_MODE != 'saas':
        return ('product mode is not SaaS',)
    if not settings.CAPSTAN_SAAS_REGISTRATION_ENABLED:
        return ('registration is disabled',)

    required_values = {
        'public URL': settings.CAPSTAN_SAAS_REGISTRATION_PUBLIC_URL,
        'email sender': settings.CAPSTAN_SAAS_REGISTRATION_EMAIL_FROM,
        'SMTP host': settings.EMAIL_HOST,
        'terms version': settings.CAPSTAN_SAAS_REGISTRATION_TERMS_VERSION,
        'terms URL': settings.CAPSTAN_SAAS_REGISTRATION_TERMS_URL,
        'privacy URL': settings.CAPSTAN_SAAS_REGISTRATION_PRIVACY_URL,
        'Turnstile site key': settings.CAPSTAN_SAAS_REGISTRATION_TURNSTILE_SITE_KEY,
        'Turnstile secret key': settings.CAPSTAN_SAAS_REGISTRATION_TURNSTILE_SECRET_KEY,
    }
    errors = ['{} is not configured'.format(label) for label, value in required_values.items() if not value]
    for label, value in (
        ('public URL', settings.CAPSTAN_SAAS_REGISTRATION_PUBLIC_URL),
        ('terms URL', settings.CAPSTAN_SAAS_REGISTRATION_TERMS_URL),
        ('privacy URL', settings.CAPSTAN_SAAS_REGISTRATION_PRIVACY_URL),
    ):
        if value and not value.startswith('https://'):
            errors.append('{} must use HTTPS'.format(label))
    if settings.CAPSTAN_SAAS_REGISTRATION_BOT_PROVIDER != 'turnstile':
        errors.append('bot provider must be turnstile')
    if settings.CAPSTAN_SAAS_REGISTRATION_TOKEN_MAX_AGE <= 0:
        errors.append('verification token lifetime must be positive')
    return tuple(errors)


def registration_is_ready():
    return not registration_configuration_errors()
