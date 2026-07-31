import {
  ActionGroup,
  Alert,
  Button,
  Form,
  FormGroup,
  FormHelperText,
  Grid,
  GridItem,
  HelperTextItem,
  TextInput,
} from '@patternfly/react-core';
import { FormEvent, ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AnsibleLoginPage } from '../../common/AnsibleLogin/AnsibleLogin';
import { postRequest } from '../../common/crud/Data';
import { RequestError } from '../../common/crud/RequestError';

interface TenantRegistrationValues {
  organization_name: string;
  organization_slug: string;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  password: string;
  confirm_password: string;
}

interface TenantRegistrationResponse {
  organization: {
    id: number;
    name: string;
    tenant_slug: string;
    tenant_status: string;
  };
  user: {
    id: number;
    username: string;
    email: string;
  };
  login_url: string;
}

type TenantRegistrationErrors = Partial<Record<keyof TenantRegistrationValues | 'detail', string>>;

function TenantRegistrationField(props: {
  name: keyof TenantRegistrationValues;
  label: string;
  value: string;
  error?: string;
  type?: 'email' | 'password';
  helperText?: string;
  isRequired?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <FormGroup
      label={props.label}
      fieldId={`tenant-registration-${props.name}`}
      isRequired={props.isRequired}
    >
      <TextInput
        id={`tenant-registration-${props.name}`}
        name={props.name}
        type={props.type ?? 'text'}
        value={props.value}
        onChange={(_, value) => props.onChange(value)}
        validated={props.error ? 'error' : 'default'}
        isRequired={props.isRequired}
        autoComplete={
          props.name === 'password' || props.name === 'confirm_password'
            ? 'new-password'
            : undefined
        }
      />
      {props.error || props.helperText ? (
        <FormHelperText>
          <HelperTextItem variant={props.error ? 'error' : 'default'}>
            {props.error ?? props.helperText}
          </HelperTextItem>
        </FormHelperText>
      ) : null}
    </FormGroup>
  );
}

const initialValues: TenantRegistrationValues = {
  organization_name: '',
  organization_slug: '',
  username: '',
  email: '',
  first_name: '',
  last_name: '',
  password: '',
  confirm_password: '',
};

function organizationSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function requestErrors(error: unknown): TenantRegistrationErrors {
  if (!(error instanceof RequestError) || typeof error.body !== 'object' || !error.body) {
    return { detail: error instanceof Error ? error.message : String(error) };
  }

  return Object.fromEntries(
    Object.entries(error.body).map(([field, value]) => [
      field,
      Array.isArray(value) ? value.join(' ') : String(value),
    ])
  ) as TenantRegistrationErrors;
}

export function AwxTenantRegistration(props: {
  registrationUrl: string;
  brandImg?: ReactNode;
  brandImgAlt: string;
  textContent?: string;
  backgroundImgSrc?: string;
  onSuccess: (response: TenantRegistrationResponse) => void;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState<TenantRegistrationErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [slugWasEdited, setSlugWasEdited] = useState(false);

  const requiredFields = useMemo(
    () =>
      [
        'organization_name',
        'organization_slug',
        'username',
        'email',
        'password',
        'confirm_password',
      ] as const,
    []
  );

  const updateValue = (field: keyof TenantRegistrationValues, value: string) => {
    setErrors((current) => ({ ...current, [field]: undefined, detail: undefined }));
    setValues((current) => {
      const next = { ...current, [field]: value };
      if (field === 'organization_name' && !slugWasEdited) {
        next.organization_slug = organizationSlug(value);
      }
      return next;
    });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const nextErrors: TenantRegistrationErrors = {};
    requiredFields.forEach((field) => {
      if (!values[field].trim()) {
        nextErrors[field] = t('This field is required.');
      }
    });
    if (values.password && values.password !== values.confirm_password) {
      nextErrors.confirm_password = t('Passwords do not match.');
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setIsSubmitting(true);
    setErrors({});
    try {
      const { confirm_password: _confirmPassword, ...payload } = values;
      const response = await postRequest<TenantRegistrationResponse>(
        props.registrationUrl,
        payload
      );
      props.onSuccess(response);
    } catch (error) {
      setErrors(requestErrors(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const fieldProps = (name: keyof TenantRegistrationValues) => ({
    name,
    value: values[name],
    error: errors[name],
    onChange: (value: string) => {
      if (name === 'organization_slug') {
        setSlugWasEdited(true);
      }
      updateValue(name, value);
    },
  });
  const organizationNameProps = fieldProps('organization_name');
  const organizationSlugProps = fieldProps('organization_slug');
  const firstNameProps = fieldProps('first_name');
  const lastNameProps = fieldProps('last_name');
  const usernameProps = fieldProps('username');
  const emailProps = fieldProps('email');
  const passwordProps = fieldProps('password');
  const confirmPasswordProps = fieldProps('confirm_password');

  return (
    <AnsibleLoginPage
      loginTitle={t('Create your organization')}
      loginSubtitle={t('Set up a Capstan SaaS tenant and its first organization administrator.')}
      brandImg={props.brandImg}
      brandImgAlt={props.brandImgAlt}
      textContent={props.textContent}
      backgroundImgSrc={props.backgroundImgSrc}
    >
      {errors.detail ? (
        <Alert isInline variant="danger" title={t('Unable to create organization')}>
          {errors.detail}
        </Alert>
      ) : null}
      <Form onSubmit={(event) => void submit(event)}>
        <TenantRegistrationField
          {...organizationNameProps}
          label={t('Organization name')}
          isRequired
        />
        <TenantRegistrationField
          {...organizationSlugProps}
          label={t('Organization identifier')}
          helperText={t('Lowercase letters, numbers, and hyphens. This cannot be changed later.')}
          isRequired
        />
        <Grid hasGutter>
          <GridItem span={12} md={6}>
            <TenantRegistrationField {...firstNameProps} label={t('First name')} />
          </GridItem>
          <GridItem span={12} md={6}>
            <TenantRegistrationField {...lastNameProps} label={t('Last name')} />
          </GridItem>
        </Grid>
        <TenantRegistrationField
          {...usernameProps}
          label={t('Administrator username')}
          isRequired
        />
        <TenantRegistrationField
          {...emailProps}
          label={t('Administrator email')}
          type="email"
          isRequired
        />
        <TenantRegistrationField
          {...passwordProps}
          label={t('Password')}
          type="password"
          isRequired
        />
        <TenantRegistrationField
          {...confirmPasswordProps}
          label={t('Confirm password')}
          type="password"
          isRequired
        />
        <ActionGroup>
          <Button
            type="submit"
            variant="primary"
            isLoading={isSubmitting}
            isDisabled={isSubmitting}
          >
            {t('Create organization')}
          </Button>
          <Button component={(buttonProps) => <Link {...buttonProps} to="/" />} variant="link">
            {t('Back to login')}
          </Button>
        </ActionGroup>
      </Form>
    </AnsibleLoginPage>
  );
}
