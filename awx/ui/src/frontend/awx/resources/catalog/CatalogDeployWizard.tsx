import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router-dom';
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
import { generateCatalogName, parseCatalogDynamicFieldNames } from './catalogNaming';

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

interface CatalogDeploymentListResponse {
  count: number;
  results: Array<{ name: string; extra_vars?: Record<string, unknown> | null }>;
}

function renderDynamicTemplate(template: string, context: Record<string, string>) {
  return template.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_match, key: string) => {
    const value = context[key];
    return value !== undefined && value !== null ? String(value) : '';
  });
}

function resolveSequenceSuffix(value: string, existingValues: string[]) {
  const trimmed = value.trim();
  if (!trimmed.endsWith('+1')) {
    return value;
  }

  const base = trimmed.slice(0, -2);
  const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escapedBase}(?<sequence>\\d+)?$`, 'i');

  let highestSequence = 0;
  let matched = false;
  for (const existingValue of existingValues) {
    const match = pattern.exec(existingValue.trim());
    if (!match) continue;
    matched = true;
    const sequence = match.groups?.sequence;
    highestSequence = Math.max(highestSequence, sequence ? Number(sequence) : 1);
  }

  return matched ? `${base}${highestSequence + 1}` : `${base}1`;
}

export function CatalogDeployWizard() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
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
  const { data: deploymentList } = useGet<CatalogDeploymentListResponse>(item?.related.deployments);

  const postRequest = usePostRequest<Record<string, unknown>, CatalogDeployment>();

  const schema = useMemo(
    () => (deploySurvey?.schema ?? (item?.extra_vars_schema ?? {})) as JsonSchema,
    [deploySurvey?.schema, item?.extra_vars_schema]
  );
  const properties = schema.properties ?? {};
  const requiredSet = new Set<string>(schema.required ?? []);

  const existingDynamicFieldValues = useMemo(() => {
    const valuesByField: Record<string, string[]> = {};
    for (const deployment of deploymentList?.results ?? []) {
      const extraVars = deployment.extra_vars;
      if (!extraVars || typeof extraVars !== 'object') continue;

      for (const [key, value] of Object.entries(extraVars)) {
        if (value === undefined || value === null) continue;
        if (!valuesByField[key]) {
          valuesByField[key] = [];
        }
        valuesByField[key].push(String(value));
      }
    }
    return valuesByField;
  }, [deploymentList?.results]);

  const prefilledValues = useMemo(() => {
    const values: Record<string, string> = {};
    const cpuField = searchParams.get('cpu_field');
    const cpuValue = searchParams.get('cpu');
    if (cpuField && cpuValue !== null && Object.prototype.hasOwnProperty.call(properties, cpuField)) {
      values[cpuField] = cpuValue;
    }

    const ramField = searchParams.get('ram_field');
    const ramValue = searchParams.get('ram');
    if (ramField && ramValue !== null && Object.prototype.hasOwnProperty.call(properties, ramField)) {
      values[ramField] = ramValue;
    }

    return values;
  }, [properties, searchParams]);

  const initialFormValues = useMemo((): Record<string, string> => {
    const values: Record<string, string> = {};
    for (const [key, prop] of Object.entries(properties)) {
      values[key] = prop.default !== undefined ? String(prop.default) : '';
    }
    Object.assign(values, prefilledValues);

    const dynamicTemplates = item?.dynamic_field_templates ?? {};
    for (const [field, template] of Object.entries(dynamicTemplates)) {
      if (typeof template !== 'string' || template.trim() === '') continue;
      if (!Object.prototype.hasOwnProperty.call(properties, field)) continue;
      const renderedValue = renderDynamicTemplate(template, values);
      values[field] = resolveSequenceSuffix(renderedValue, existingDynamicFieldValues[field] ?? []);
    }

    return values;
  }, [existingDynamicFieldValues, item?.dynamic_field_templates, prefilledValues, properties]);

  const [formValues, setFormValues] = useState<Record<string, string>>(initialFormValues);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const dynamicFieldNames = useMemo(
    () => parseCatalogDynamicFieldNames(item?.dynamic_name_field),
    [item?.dynamic_name_field]
  );
  const disabledFieldSet = useMemo(() => {
    const names = new Set<string>();
    for (const field of item?.deploy_disabled_fields ?? []) {
      if (typeof field === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field)) {
        names.add(field);
      }
    }
    return names;
  }, [item?.deploy_disabled_fields]);
  const hiddenFieldSet = useMemo(() => {
    const names = new Set<string>();
    for (const field of item?.deploy_hidden_fields ?? []) {
      if (typeof field === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field)) {
        names.add(field);
      }
    }
    return names;
  }, [item?.deploy_hidden_fields]);

  useEffect(() => {
    setFormValues(initialFormValues);
    setFieldErrors({});
  }, [initialFormValues]);

  const generatedName = useMemo(() => {
    const existingNames = deploymentList?.results?.map((deployment) => deployment.name) ?? [];
    const dynamicField = dynamicFieldNames[0];
    const effectiveTemplate =
      item?.name_template || (dynamicField ? `{${dynamicField}} deployment` : undefined);
    return generateCatalogName(
      effectiveTemplate,
      { user_org_name: item?.summary_fields?.organization?.name, ...formValues },
      existingNames,
      item?.name ?? 'deployment'
    );
  }, [deploymentList?.results, dynamicFieldNames, formValues, item?.name, item?.name_template, item?.summary_fields?.organization?.name]);

  const setValue = useCallback((key: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => ({ ...prev, [key]: '' }));
  }, []);

  const validate = (): boolean => {
    let valid = true;

    const errors: Record<string, string> = {};
    for (const key of requiredSet) {
      if (hiddenFieldSet.has(key)) continue;
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
      const resolvedValues: Record<string, string> = { ...formValues };
      const dynamicTemplates = item.dynamic_field_templates ?? {};
      for (const [field, template] of Object.entries(dynamicTemplates)) {
        if (typeof template !== 'string' || template.trim() === '') continue;
        if (!Object.prototype.hasOwnProperty.call(properties, field)) continue;
        const renderedValue = renderDynamicTemplate(template, resolvedValues);
        resolvedValues[field] = resolveSequenceSuffix(
          renderedValue,
          existingDynamicFieldValues[field] ?? []
        );
      }

      const extraVars: Record<string, unknown> = {};
      for (const [key, prop] of Object.entries(properties)) {
        const raw = resolvedValues[key];
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
        name: generatedName,
        extra_vars: extraVars,
      });
      alertToaster.addAlert({
        variant: 'success',
        title: t('Deployment started for "{{name}}"', { name: generatedName }),
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
    ...Object.entries(properties).filter(([key]) => requiredSet.has(key) && !hiddenFieldSet.has(key)),
    ...Object.entries(properties).filter(([key]) => !requiredSet.has(key) && !hiddenFieldSet.has(key)),
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
              value={generatedName}
              onChange={() => undefined}
              isRequired
              isDisabled
            />
            <HelperText>
              <HelperTextItem>
                {t('Auto-generated from your template and deploy form values.')}
              </HelperTextItem>
            </HelperText>
          </FormGroup>

          {sortedEntries.map(([key, prop]) => {
            const error = fieldErrors[key];
            const isReq = requiredSet.has(key);
            const label = prop.title ?? key;
            const fieldId = `deploy-field-${key}`;
            const isAdminDisabledField = disabledFieldSet.has(key);
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
                    isDisabled={isAdminDisabledField || isSubmitting}
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
                  isDisabled={isAdminDisabledField || isSubmitting}
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
