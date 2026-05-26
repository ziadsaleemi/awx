import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import {
  Button,
  Form,
  FormGroup,
  FormSelect,
  FormSelectOption,
  HelperText,
  HelperTextItem,
  PageSection,
  TextInput,
} from '@patternfly/react-core';
import {
  LoadingPage,
  PageHeader,
  PageLayout,
  usePageAlertToaster,
  usePageNavigate,
} from '../../../../framework';
import { awxAPI } from '../../common/api/awx-utils';
import { useGetItem } from '../../../common/crud/useGet';
import { useGet } from '../../../common/crud/useGet';
import { usePostRequest } from '../../../common/crud/usePostRequest';
import { AwxError } from '../../common/AwxError';
import { AwxRoute } from '../../main/AwxRoutes';
import { CatalogItem } from '../../interfaces/CatalogItem';
import { CatalogDeployment } from '../../interfaces/CatalogDeployment';

interface SchemaProperty {
  type?: 'string' | 'integer' | 'number' | 'boolean';
  title?: string;
  description?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  enum?: string[];
}

interface JsonSchema {
  type?: string;
  required?: string[];
  properties?: Record<string, SchemaProperty>;
}

interface DeploySurveyResponse {
  schema: JsonSchema;
}

export function CatalogDeployWizard() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const id = params.id ?? '';
  const pageNavigate = usePageNavigate();
  const alertToaster = usePageAlertToaster();

  const { data: item, error, isLoading, refresh } = useGetItem<CatalogItem>(
    awxAPI`/catalog_items`,
    id
  );
  const { data: deploySurvey } = useGet<DeploySurveyResponse>(
    awxAPI`/catalog_items/${id}/deploy_survey/`
  );

  const postRequest = usePostRequest<Record<string, unknown>, CatalogDeployment>();

  const schema = useMemo(
    () => (deploySurvey?.schema ?? (item?.extra_vars_schema ?? {})) as JsonSchema,
    [deploySurvey?.schema, item?.extra_vars_schema]
  );
  const properties = schema.properties ?? {};
  const requiredSet = new Set<string>(schema.required ?? []);

  const initialFormValues = useMemo((): Record<string, string> => {
    const values: Record<string, string> = {};
    for (const [key, prop] of Object.entries(properties)) {
      values[key] = prop.default !== undefined ? String(prop.default) : '';
    }
    return values;
  }, [properties]);

  const [name, setName] = useState('');
  const [formValues, setFormValues] = useState<Record<string, string>>(initialFormValues);
  const [nameError, setNameError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setFormValues(initialFormValues);
    setFieldErrors({});
  }, [initialFormValues]);

  const setValue = useCallback((key: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => ({ ...prev, [key]: '' }));
  }, []);

  const validate = (): boolean => {
    let valid = true;

    if (!name.trim()) {
      setNameError(t('Deployment name is required.'));
      valid = false;
    }

    const errors: Record<string, string> = {};
    for (const key of requiredSet) {
      if (!formValues[key]?.trim()) {
        errors[key] = t('This field is required.');
        valid = false;
      }
    }

    setFieldErrors(errors);
    return valid;
  };

  const onSubmit = async () => {
    if (!validate() || !item) return;

    setIsSubmitting(true);
    try {
      const extraVars: Record<string, unknown> = {};
      for (const [key, prop] of Object.entries(properties)) {
        const raw = formValues[key];
        if (raw === '' || raw === undefined) continue;
        if (prop.type === 'integer' || prop.type === 'number') {
          const parsed = Number(raw);
          if (!Number.isNaN(parsed)) extraVars[key] = parsed;
        } else if (prop.type === 'boolean') {
          extraVars[key] = raw === 'true';
        } else {
          extraVars[key] = raw;
        }
      }

      await postRequest(awxAPI`/catalog_items/${id}/deploy/`, {
        name: name.trim(),
        extra_vars: extraVars,
      });
      alertToaster.addAlert({
        variant: 'success',
        title: t('Deployment started for "{{name}}"', { name: name.trim() }),
        timeout: 4000,
      });
      pageNavigate(AwxRoute.CatalogDeployments);
    } catch (err) {
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Failed to deploy catalog item'),
        children: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const sortedEntries = [
    ...Object.entries(properties).filter(([key]) => requiredSet.has(key)),
    ...Object.entries(properties).filter(([key]) => !requiredSet.has(key)),
  ];

  if (error) return <AwxError error={error} handleRefresh={refresh} />;
  if (isLoading || !item) return <LoadingPage />;

  return (
    <PageLayout>
      <PageHeader
        title={t('Deploy: {{name}}', { name: item.name })}
        description={item.description}
        breadcrumbs={[
          { label: t('Catalog'), to: undefined },
          { label: item.name },
        ]}
      />
      <PageSection variant="light" hasBodyWrapper={false} style={{ padding: '1.5rem 2rem' }}>
        <Form>
          <FormGroup label={t('Deployment name')} isRequired fieldId="deploy-name">
            <TextInput
              id="deploy-name"
              value={name}
              onChange={(_event, val) => {
                setName(val);
                setNameError('');
              }}
              isRequired
              validated={nameError ? 'error' : 'default'}
              placeholder={t('e.g. My Dev VM')}
            />
            {nameError && (
              <HelperText>
                <HelperTextItem variant="error">{nameError}</HelperTextItem>
              </HelperText>
            )}
          </FormGroup>

          {sortedEntries.map(([key, prop]) => {
            const error = fieldErrors[key];
            const isReq = requiredSet.has(key);
            const label = prop.title ?? key;
            const fieldId = `deploy-field-${key}`;

            if (prop.enum && prop.enum.length > 0) {
              return (
                <FormGroup key={key} label={label} isRequired={isReq} fieldId={fieldId}>
                  {prop.description && (
                    <HelperText style={{ marginBottom: '0.25rem' }}>
                      <HelperTextItem>{prop.description}</HelperTextItem>
                    </HelperText>
                  )}
                  <FormSelect
                    id={fieldId}
                    value={formValues[key] ?? ''}
                    onChange={(_event, val) => setValue(key, val)}
                    validated={error ? 'error' : 'default'}
                  >
                    {!isReq && <FormSelectOption value="" label={t('Select...')} />}
                    {prop.enum.map((opt) => (
                      <FormSelectOption key={opt} value={opt} label={opt} />
                    ))}
                  </FormSelect>
                  {error && (
                    <HelperText>
                      <HelperTextItem variant="error">{error}</HelperTextItem>
                    </HelperText>
                  )}
                </FormGroup>
              );
            }

            return (
              <FormGroup key={key} label={label} isRequired={isReq} fieldId={fieldId}>
                {prop.description && (
                  <HelperText style={{ marginBottom: '0.25rem' }}>
                    <HelperTextItem>{prop.description}</HelperTextItem>
                  </HelperText>
                )}
                <TextInput
                  id={fieldId}
                  type={prop.type === 'integer' || prop.type === 'number' ? 'number' : 'text'}
                  value={formValues[key] ?? ''}
                  onChange={(_event, val) => setValue(key, val)}
                  validated={error ? 'error' : 'default'}
                  isRequired={isReq}
                  {...(prop.minimum !== undefined ? { min: prop.minimum } : {})}
                  {...(prop.maximum !== undefined ? { max: prop.maximum } : {})}
                />
                {error && (
                  <HelperText>
                    <HelperTextItem variant="error">{error}</HelperTextItem>
                  </HelperText>
                )}
              </FormGroup>
            );
          })}

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
            <Button variant="primary" onClick={() => void onSubmit()} isLoading={isSubmitting}>
              {t('Deploy')}
            </Button>
            <Button
              variant="link"
              onClick={() => pageNavigate(AwxRoute.CatalogItems)}
              isDisabled={isSubmitting}
            >
              {t('Cancel')}
            </Button>
          </div>
        </Form>
      </PageSection>
    </PageLayout>
  );
}
