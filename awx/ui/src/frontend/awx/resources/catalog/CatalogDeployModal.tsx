import { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Form,
  FormGroup,
  FormSelect,
  FormSelectOption,
  HelperText,
  HelperTextItem,
  Modal,
  ModalBoxBody,
  ModalVariant,
  TextInput,
} from '@patternfly/react-core';
import { usePageAlertToaster, usePageNavigate } from '../../../../framework';
import { awxAPI } from '../../common/api/awx-utils';
import { useGet } from '../../../common/crud/useGet';
import { usePostRequest } from '../../../common/crud/usePostRequest';
import { CatalogItem } from '../../interfaces/CatalogItem';
import { CatalogDeployment } from '../../interfaces/CatalogDeployment';
import { AwxRoute } from '../../main/AwxRoutes';
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

interface CatalogDeployModalProps {
  item: CatalogItem;
  onClose: () => void;
}

interface DeploySurveyResponse {
  schema: JsonSchema;
}

interface CatalogDeploymentListResponse {
  count: number;
  results: Array<{ name: string }>;
}

export function CatalogDeployModal({ item, onClose }: CatalogDeployModalProps) {
  const { t } = useTranslation();
  const pageNavigate = usePageNavigate();
  const alertToaster = usePageAlertToaster();
  const postRequest = usePostRequest<Record<string, unknown>, CatalogDeployment>();

  const { data: surveyData } = useGet<DeploySurveyResponse>(
    awxAPI`/catalog_items/${String(item.id)}/deploy_survey/`
  );
  const { data: deploymentList } = useGet<CatalogDeploymentListResponse>(item.related.deployments);

  const schema = useMemo(
    () => (surveyData?.schema ?? (item.extra_vars_schema ?? {})) as JsonSchema,
    [item.extra_vars_schema, surveyData?.schema]
  );
  const properties = schema.properties ?? {};
  const requiredSet = new Set<string>(schema.required ?? []);

  const initialFormValues = useMemo((): Record<string, string> => {
    const vals: Record<string, string> = {};
    for (const [key, prop] of Object.entries(properties)) {
      vals[key] = prop.default !== undefined ? String(prop.default) : '';
    }
    return vals;
  }, [properties]);

  const [formValues, setFormValues] = useState<Record<string, string>>(initialFormValues);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const dynamicFieldNames = useMemo(
    () => parseCatalogDynamicFieldNames(item.dynamic_name_field),
    [item.dynamic_name_field]
  );
  const disabledFieldSet = useMemo(() => {
    const names = new Set<string>();
    for (const field of item.deploy_disabled_fields ?? []) {
      if (typeof field === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field)) {
        names.add(field);
      }
    }
    return names;
  }, [item.deploy_disabled_fields]);
  const hiddenFieldSet = useMemo(() => {
    const names = new Set<string>();
    for (const field of item.deploy_hidden_fields ?? []) {
      if (typeof field === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field)) {
        names.add(field);
      }
    }
    return names;
  }, [item.deploy_hidden_fields]);

  const generatedName = useMemo(() => {
    const existingNames = deploymentList?.results?.map((deployment) => deployment.name) ?? [];
    const dynamicField = dynamicFieldNames[0];
    const effectiveTemplate = item.name_template || (dynamicField ? `{${dynamicField}} deployment` : undefined);
    return generateCatalogName(
      effectiveTemplate,
      { user_org_name: item.summary_fields?.organization?.name, ...formValues },
      existingNames,
      item.name
    );
  }, [deploymentList?.results, dynamicFieldNames, formValues, item.name, item.name_template, item.summary_fields?.organization?.name]);

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
    if (!validate()) return;
    setIsSubmitting(true);
    try {
      const extraVars: Record<string, unknown> = {};
      for (const [key, prop] of Object.entries(properties)) {
        const raw = formValues[key];
        if (raw === '' || raw === undefined) continue;
        if (prop.type === 'integer' || prop.type === 'number') {
          const n = Number(raw);
          if (!isNaN(n)) extraVars[key] = n;
        } else {
          extraVars[key] = raw;
        }
      }
      await postRequest(awxAPI`/catalog_items/${String(item.id)}/deploy/`, {
        name: generatedName,
        extra_vars: extraVars,
      });
      alertToaster.addAlert({
        variant: 'success',
        title: t('Deployment "{{name}}" started.', { name: generatedName }),
        timeout: 4000,
      });
      onClose();
      pageNavigate(AwxRoute.CatalogDeployments);
    } catch (err) {
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Deployment failed'),
        children: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Sort: required fields first, optional second, preserving insertion order within each group
  const sortedEntries = [
    ...Object.entries(properties).filter(([k]) => requiredSet.has(k) && !hiddenFieldSet.has(k)),
    ...Object.entries(properties).filter(([k]) => !requiredSet.has(k) && !hiddenFieldSet.has(k)),
  ];

  return (
    <Modal
      title={t('Deploy: {{name}}', { name: item.name })}
      aria-label={t('Deploy catalog item')}
      variant={ModalVariant.medium}
      isOpen
      hasNoBodyWrapper
      onClose={onClose}
      actions={[
        <Button
          key="deploy"
          variant="primary"
          onClick={() => void onSubmit()}
          isLoading={isSubmitting}
          isDisabled={isSubmitting}
        >
          {t('Deploy')}
        </Button>,
        <Button key="cancel" variant="link" onClick={onClose} isDisabled={isSubmitting}>
          {t('Cancel')}
        </Button>,
      ]}
    >
      <ModalBoxBody style={{ padding: '1.5rem 2rem' }}>
        <Form>
          {/* Deployment name */}
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

          {/* Schema-driven survey fields */}
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
        </Form>
      </ModalBoxBody>
    </Modal>
  );
}
