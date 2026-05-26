import { useState, useCallback } from 'react';
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
import { usePostRequest } from '../../../common/crud/usePostRequest';
import { CatalogItem } from '../../interfaces/CatalogItem';
import { CatalogDeployment } from '../../interfaces/CatalogDeployment';
import { AwxRoute } from '../../main/AwxRoutes';

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

export function CatalogDeployModal({ item, onClose }: CatalogDeployModalProps) {
  const { t } = useTranslation();
  const pageNavigate = usePageNavigate();
  const alertToaster = usePageAlertToaster();
  const postRequest = usePostRequest<Record<string, unknown>, CatalogDeployment>();

  const schema = (item.extra_vars_schema ?? {}) as JsonSchema;
  const properties = schema.properties ?? {};
  const requiredSet = new Set<string>(schema.required ?? []);

  const buildInitialValues = (): Record<string, string> => {
    const vals: Record<string, string> = {};
    for (const [key, prop] of Object.entries(properties)) {
      vals[key] = prop.default !== undefined ? String(prop.default) : '';
    }
    return vals;
  };

  const [name, setName] = useState('');
  const [formValues, setFormValues] = useState<Record<string, string>>(buildInitialValues);
  const [nameError, setNameError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

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
        name: name.trim(),
        extra_vars: extraVars,
      });
      alertToaster.addAlert({
        variant: 'success',
        title: t('Deployment "{{name}}" started.', { name: name.trim() }),
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
    ...Object.entries(properties).filter(([k]) => requiredSet.has(k)),
    ...Object.entries(properties).filter(([k]) => !requiredSet.has(k)),
  ];

  return (
    <Modal
      title={t('Deploy: {{name}}', { name: item.name })}
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

          {/* Schema-driven survey fields */}
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
        </Form>
      </ModalBoxBody>
    </Modal>
  );
}
