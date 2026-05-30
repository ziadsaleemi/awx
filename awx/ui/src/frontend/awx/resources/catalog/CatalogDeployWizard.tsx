import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Form,
  FormGroup,
  FormSelect,
  FormSelectOption,
  HelperText,
  HelperTextItem,
  PageSection,
  Tab,
  Tabs,
  TabTitleText,
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
import { fetchProviderState } from '../cloud/cloudConnectionStore';

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

// AWX WorkflowJobTemplate survey spec format
interface WjtSurveyQuestion {
  variable: string;
  question_name: string;
  question_description?: string;
  required: boolean;
  type: 'text' | 'textarea' | 'password' | 'integer' | 'float' | 'multiplechoice' | 'multiselect';
  default?: unknown;
  choices?: string; // newline-separated choices for multiplechoice/multiselect
  min?: number;
  max?: number;
}

interface WjtSurveySpec {
  name: string;
  description?: string;
  spec: WjtSurveyQuestion[];
}

/** Convert an AWX WJT survey spec into the JsonSchema format used by the form renderer. */
function surveySpecToSchema(spec: WjtSurveySpec): JsonSchema {
  const properties: Record<string, SchemaProperty> = {};
  const required: string[] = [];

  for (const q of spec.spec) {
    const prop: SchemaProperty = {
      title: q.question_name,
      description: q.question_description || undefined,
    };

    if (q.type === 'integer') {
      prop.type = 'integer';
    } else if (q.type === 'float') {
      prop.type = 'number';
    } else {
      prop.type = 'string';
    }

    if (q.default !== undefined && q.default !== null && q.default !== '') {
      prop.default = q.default;
    }

    if (q.min !== undefined) prop.minimum = q.min;
    if (q.max !== undefined) prop.maximum = q.max;

    if (q.type === 'multiplechoice' && q.choices) {
      const choicesArr = Array.isArray(q.choices) ? q.choices : String(q.choices).split('\n');
      prop.enum = choicesArr.map((c) => c.trim()).filter(Boolean);
    }

    properties[q.variable] = prop;
    if (q.required) required.push(q.variable);
  }

  return { type: 'object', properties, required };
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

/**
 * Resolve a dynamic source path (e.g. "templates.name") against pulled provider data.
 * Returns a deduplicated list of string option values.
 */
function resolveDynamicOptions(data: Record<string, unknown> | null, sourcePath: string): string[] {
  if (!data || !sourcePath) return [];
  const dotIdx = sourcePath.indexOf('.');
  if (dotIdx === -1) return [];
  const arrayKey = sourcePath.slice(0, dotIdx);
  const valueField = sourcePath.slice(dotIdx + 1);
  const arr = data[arrayKey];
  if (!Array.isArray(arr)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of arr) {
    if (item && typeof item === 'object') {
      const v = (item as Record<string, unknown>)[valueField];
      if (v !== undefined && v !== null) {
        const s = String(v);
        if (s && !seen.has(s)) {
          seen.add(s);
          result.push(s);
        }
      }
    }
  }
  return result;
}

export function CatalogDeployWizard() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const id = params.id ?? '';
  const pageNavigate = usePageNavigate();

  const {
    data: item,
    error,
    isLoading,
    refresh,
  } = useGetItem<CatalogItem>(awxAPI`/catalog_items`, id);

  const urlProvider = searchParams.get('provider') ?? '';

  if (error) return <AwxError error={error} handleRefresh={refresh} />;
  if (isLoading || !item) return <LoadingPage />;

  return (
    <PageLayout>
      <PageHeader
        title={t('Deploy: {{name}}', { name: item.name })}
        description={item.description}
        breadcrumbs={[{ label: t('Catalog'), to: undefined }, { label: item.name }]}
      />
      <PageSection variant="light" style={{ padding: '1.5rem 2rem' }}>
        <CatalogDeployContent
          item={item}
          initialProvider={urlProvider}
          onDone={() => pageNavigate(AwxRoute.CatalogDeployments)}
          onCancel={() => pageNavigate(AwxRoute.CatalogItems)}
        />
      </PageSection>
    </PageLayout>
  );
}

export function CatalogDeployContent({
  item,
  initialProvider,
  onDone,
  onCancel,
}: {
  item: CatalogItem;
  initialProvider?: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const alertToaster = usePageAlertToaster();
  const id = String(item.id);

  const { data: deploySurvey } = useGet<DeploySurveyResponse>(
    awxAPI`/catalog_items/${id}/deploy_survey/`
  );
  const { data: deploymentList } = useGet<CatalogDeploymentListResponse>(item.related.deployments);

  const postRequest = usePostRequest<Record<string, unknown>, CatalogDeployment>();

  // Multi-cloud state — pre-select from initialProvider prop
  const allProviders = useMemo(() => {
    const set = new Set<string>();
    // available_providers takes precedence — it is the authoritative enabled list
    if (item.available_providers && item.available_providers.length > 0) {
      for (const p of item.available_providers) set.add(p);
    } else {
      for (const k of Object.keys(item.cloud_backends ?? {})) set.add(k);
      for (const k of Object.keys(item.provider_workflows ?? {})) set.add(k);
    }
    return [...set];
  }, [item.available_providers, item.cloud_backends, item.provider_workflows]);

  const [selectedProvider, setSelectedProvider] = useState<string>(() => {
    if (
      initialProvider &&
      (allProviders.includes(initialProvider) || initialProvider === 'default')
    ) {
      return initialProvider;
    }
    return allProviders[0] ?? '';
  });

  // When the modal is opened from a specific provider icon, lock to that provider
  // and skip rendering tabs for other providers.
  const lockedProvider = initialProvider ?? null;
  const isProviderConfigured = (p: string) =>
    Boolean(
      (item.provider_workflows && item.provider_workflows[p]) ||
        (item.cloud_backends && item.cloud_backends[p])
    );

  const PROVIDER_LABELS: Record<string, string> = {
    digitalocean: 'DigitalOcean',
    proxmox: 'Proxmox VE',
    vmware: 'VMware vSphere',
    azure: 'Microsoft Azure',
    aws: 'Amazon AWS',
  };

  // Fetch the WJT survey for the currently-selected provider, if configured
  const providerSurveyUrl =
    selectedProvider && item.related?.provider_workflow_surveys
      ? item.related.provider_workflow_surveys[selectedProvider]
      : undefined;
  const { data: providerSurveyData } = useGet<WjtSurveySpec>(providerSurveyUrl);

  // The active schema: provider survey > catalog deploy_survey > extra_vars_schema
  const schema = useMemo((): JsonSchema => {
    if (providerSurveyData?.spec) {
      return surveySpecToSchema(providerSurveyData);
    }
    return (deploySurvey?.schema ?? item.extra_vars_schema ?? {}) as JsonSchema;
  }, [providerSurveyData, deploySurvey?.schema, item.extra_vars_schema]);
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
    return {};
  }, []);

  const initialFormValues = useMemo((): Record<string, string> => {
    const values: Record<string, string> = {};
    for (const [key, prop] of Object.entries(properties)) {
      values[key] = prop.default !== undefined ? String(prop.default) : '';
    }
    Object.assign(values, prefilledValues);

    const dynamicTemplates = item.dynamic_field_templates ?? {};
    for (const [field, template] of Object.entries(dynamicTemplates)) {
      if (typeof template !== 'string' || template.trim() === '') continue;
      if (!Object.prototype.hasOwnProperty.call(properties, field)) continue;
      const renderedValue = renderDynamicTemplate(template, values);
      values[field] = resolveSequenceSuffix(renderedValue, existingDynamicFieldValues[field] ?? []);
    }

    return values;
  }, [existingDynamicFieldValues, item.dynamic_field_templates, prefilledValues, properties]);

  const [formValues, setFormValues] = useState<Record<string, string>>(initialFormValues);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Generic provider state for dynamic field source resolution
  const [providerStateData, setProviderStateData] = useState<Record<string, unknown> | null>(null);
  const [providerAdminSettings, setProviderAdminSettings] = useState<unknown>(null);

  // Fetch provider state for dynamic field source resolution.
  // For DigitalOcean, provider_data is a flat object { regions, pricing, images, vpcs }.
  // For other providers, provider_data is keyed by connection ID; aggregate arrays into a flat dict.
  useEffect(() => {
    if (!selectedProvider) {
      setProviderStateData(null);
      setProviderAdminSettings(null);
      return;
    }
    void fetchProviderState(selectedProvider).then((state) => {
      const rawData = state?.provider_data as Record<string, unknown> | null | undefined;
      if (rawData && typeof rawData === 'object') {
        if (selectedProvider === 'digitalocean') {
          // DO data is a flat object — map to generic key names used by resolveDynamicOptions
          const doRaw = rawData as {
            regions?: unknown[];
            pricing?: unknown[];
            images?: unknown[];
            vpcs?: unknown[];
          };
          setProviderStateData({
            regions: doRaw.regions ?? [],
            droplet_sizes: doRaw.pricing ?? [],
            droplet_images: doRaw.images ?? [],
            vpcs: doRaw.vpcs ?? [],
          });
        } else {
          // Other providers: keyed by connection ID — merge arrays from all connections
          const aggregated: Record<string, unknown[]> = {};
          for (const connData of Object.values(rawData)) {
            if (connData && typeof connData === 'object') {
              for (const [key, val] of Object.entries(connData as Record<string, unknown>)) {
                if (Array.isArray(val)) {
                  if (aggregated[key]) {
                    aggregated[key].push(...val);
                  } else {
                    aggregated[key] = [...val];
                  }
                }
              }
            }
          }
          setProviderStateData(aggregated);
        }
      } else {
        setProviderStateData(null);
      }
      setProviderAdminSettings(state?.admin_settings ?? null);
    });
  }, [selectedProvider]);

  // When provider changes, reset form values so stale fields from a previous survey don't persist
  useEffect(() => {
    setFormValues({});
    setFieldErrors({});
  }, [selectedProvider]);
  const dynamicFieldNames = useMemo(
    () => parseCatalogDynamicFieldNames(item.dynamic_name_field),
    [item.dynamic_name_field]
  );
  // Use per-provider field config when available, fall back to global
  const providerFieldCfg = item.provider_field_configs?.[selectedProvider];
  const disabledFieldSet = useMemo(() => {
    const names = new Set<string>();
    const src = providerFieldCfg?.disabled_fields ?? item.deploy_disabled_fields ?? [];
    for (const field of src) {
      if (typeof field === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field)) {
        names.add(field);
      }
    }
    return names;
  }, [providerFieldCfg, item.deploy_disabled_fields]);
  const hiddenFieldSet = useMemo(() => {
    const names = new Set<string>();
    const src = providerFieldCfg?.hidden_fields ?? item.deploy_hidden_fields ?? [];
    for (const field of src) {
      if (typeof field === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field)) {
        names.add(field);
      }
    }
    return names;
  }, [providerFieldCfg, item.deploy_hidden_fields]);

  useEffect(() => {
    setFormValues(initialFormValues);
    setFieldErrors({});
  }, [initialFormValues]);

  const generatedName = useMemo(() => {
    const existingNames = deploymentList?.results?.map((deployment) => deployment.name) ?? [];
    const dynamicField = dynamicFieldNames[0];
    const effectiveTemplate =
      item.name_template || (dynamicField ? `{${dynamicField}} deployment` : undefined);
    return generateCatalogName(
      effectiveTemplate,
      { user_org_name: item.summary_fields?.organization?.name, ...formValues },
      existingNames,
      item.name ?? 'deployment'
    );
  }, [
    deploymentList?.results,
    dynamicFieldNames,
    formValues,
    item.name,
    item.name_template,
    item.summary_fields?.organization?.name,
  ]);

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

      const body: Record<string, unknown> = {
        name: generatedName,
        extra_vars: extraVars,
      };
      if (selectedProvider) {
        body['target_provider'] = selectedProvider;
      }

      await postRequest(awxAPI`/catalog_items/${id}/deploy/`, body);
      alertToaster.addAlert({
        variant: 'success',
        title: t('Deployment started for "{{name}}"', { name: generatedName }),
        timeout: 4000,
      });
      onDone();
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
    ...Object.entries(properties).filter(
      ([key]) => requiredSet.has(key) && !hiddenFieldSet.has(key)
    ),
    ...Object.entries(properties).filter(
      ([key]) => !requiredSet.has(key) && !hiddenFieldSet.has(key)
    ),
  ];

  return (
    <Form>
      {/* Provider tabs — one per cloud/hypervisor backend.
              When opened from a specific cloud icon (lockedProvider), restrict to that provider only. */}
      {lockedProvider && !isProviderConfigured(lockedProvider) ? (
        <Alert
          variant="warning"
          isInline
          title={t('{{provider}} is not configured', {
            provider: PROVIDER_LABELS[lockedProvider] ?? lockedProvider,
          })}
        >
          {t(
            'No workflow or Terraform template is configured for this provider on this catalog item. Ask an administrator to configure it in the catalog item settings.'
          )}
        </Alert>
      ) : (lockedProvider ? [lockedProvider] : allProviders).length > 0 ? (
        <Tabs
          activeKey={selectedProvider}
          onSelect={(_evt, key) => setSelectedProvider(String(key))}
          style={{ marginBottom: '1.5rem' }}
        >
          {(lockedProvider ? [lockedProvider] : allProviders).map((p) => {
            const tabLabel = PROVIDER_LABELS[p] ?? p.charAt(0).toUpperCase() + p.slice(1);
            return (
              <Tab key={p} eventKey={p} title={<TabTitleText>{tabLabel}</TabTitleText>}>
                {/* Only render content for the active tab so hooks/schema stay in sync */}
                {selectedProvider === p && (
                  <div style={{ paddingTop: '1.25rem' }}>
                    {/* Dynamic fields from the provider's WJT survey (or catalog deploy_survey fallback) */}
                    {sortedEntries.map(([key, prop]) => {
                      const fieldError = fieldErrors[key];
                      const isReq = requiredSet.has(key);
                      const fieldLabel = prop.title ?? key;
                      const fieldId = `deploy-field-${key}`;
                      const isAdminDisabledField = disabledFieldSet.has(key);

                      // Check for a dynamic source configured for this field
                      const dynamicSourcePath = providerFieldCfg?.dynamic_field_sources?.[key];
                      let dynamicOptions = dynamicSourcePath
                        ? resolveDynamicOptions(providerStateData, dynamicSourcePath)
                        : [];

                      // Apply admin allow-list for Proxmox templates
                      if (
                        dynamicOptions.length > 0 &&
                        selectedProvider === 'proxmox' &&
                        dynamicSourcePath?.startsWith('templates.')
                      ) {
                        const proxmoxAdmin = providerAdminSettings as {
                          allowedTemplateNames?: string[] | null;
                        } | null;
                        if (
                          proxmoxAdmin?.allowedTemplateNames !== null &&
                          proxmoxAdmin?.allowedTemplateNames !== undefined
                        ) {
                          dynamicOptions = dynamicOptions.filter((opt) =>
                            proxmoxAdmin.allowedTemplateNames!.includes(opt)
                          );
                        }
                      }

                      // Apply admin allow-list for VMware resources
                      if (dynamicOptions.length > 0 && selectedProvider === 'vmware') {
                        const vmwareAdmin = providerAdminSettings as {
                          allowedNetworkNames?: string[] | null;
                          allowedDatastoreNames?: string[] | null;
                        } | null;
                        if (
                          dynamicSourcePath?.startsWith('networks.') &&
                          vmwareAdmin?.allowedNetworkNames !== null &&
                          vmwareAdmin?.allowedNetworkNames !== undefined
                        ) {
                          dynamicOptions = dynamicOptions.filter((opt) =>
                            vmwareAdmin.allowedNetworkNames!.includes(opt)
                          );
                        }
                        if (
                          dynamicSourcePath?.startsWith('datastores.') &&
                          vmwareAdmin?.allowedDatastoreNames !== null &&
                          vmwareAdmin?.allowedDatastoreNames !== undefined
                        ) {
                          dynamicOptions = dynamicOptions.filter((opt) =>
                            vmwareAdmin.allowedDatastoreNames!.includes(opt)
                          );
                        }
                      }

                      // Apply admin allow-list for Azure resources
                      if (dynamicOptions.length > 0 && selectedProvider === 'azure') {
                        const azureAdmin = providerAdminSettings as {
                          allowedVMImageUrns?: string[] | null;
                          allowedLocationNames?: string[] | null;
                          allowedVMSizeNames?: string[] | null;
                        } | null;
                        if (
                          dynamicSourcePath?.startsWith('vm_images.') &&
                          azureAdmin?.allowedVMImageUrns !== null &&
                          azureAdmin?.allowedVMImageUrns !== undefined
                        ) {
                          dynamicOptions = dynamicOptions.filter((opt) =>
                            azureAdmin.allowedVMImageUrns!.includes(opt)
                          );
                        }
                        if (
                          dynamicSourcePath?.startsWith('locations.') &&
                          azureAdmin?.allowedLocationNames !== null &&
                          azureAdmin?.allowedLocationNames !== undefined
                        ) {
                          dynamicOptions = dynamicOptions.filter((opt) =>
                            azureAdmin.allowedLocationNames!.includes(opt)
                          );
                        }
                        if (
                          dynamicSourcePath?.startsWith('vm_sizes.') &&
                          azureAdmin?.allowedVMSizeNames !== null &&
                          azureAdmin?.allowedVMSizeNames !== undefined
                        ) {
                          dynamicOptions = dynamicOptions.filter((opt) =>
                            azureAdmin.allowedVMSizeNames!.includes(opt)
                          );
                        }
                      }

                      // Apply admin allow-list for DigitalOcean resources
                      if (dynamicOptions.length > 0 && selectedProvider === 'digitalocean') {
                        const doAdmin = providerAdminSettings as {
                          allowedRegionSlugs?: string[] | null;
                          allowedSizeSlugs?: string[] | null;
                          allowedVpcIds?: string[] | null;
                        } | null;
                        if (
                          dynamicSourcePath?.startsWith('regions.') &&
                          doAdmin?.allowedRegionSlugs !== null &&
                          doAdmin?.allowedRegionSlugs !== undefined
                        ) {
                          dynamicOptions = dynamicOptions.filter((opt) =>
                            doAdmin.allowedRegionSlugs!.includes(opt)
                          );
                        }
                        if (
                          dynamicSourcePath?.startsWith('droplet_sizes.') &&
                          doAdmin?.allowedSizeSlugs !== null &&
                          doAdmin?.allowedSizeSlugs !== undefined
                        ) {
                          dynamicOptions = dynamicOptions.filter((opt) =>
                            doAdmin.allowedSizeSlugs!.includes(opt)
                          );
                        }
                        if (
                          dynamicSourcePath === 'vpcs.id' &&
                          doAdmin?.allowedVpcIds !== null &&
                          doAdmin?.allowedVpcIds !== undefined
                        ) {
                          dynamicOptions = dynamicOptions.filter((opt) =>
                            doAdmin.allowedVpcIds!.includes(opt)
                          );
                        }
                      }

                      if (dynamicOptions.length > 0) {
                        return (
                          <FormGroup
                            key={key}
                            label={fieldLabel}
                            isRequired={isReq}
                            fieldId={fieldId}
                          >
                            {prop.description && (
                              <HelperText style={{ marginBottom: '0.25rem' }}>
                                <HelperTextItem>{prop.description}</HelperTextItem>
                              </HelperText>
                            )}
                            <FormSelect
                              id={fieldId}
                              value={formValues[key] ?? ''}
                              onChange={(_event, val) => setValue(key, val)}
                              validated={fieldError ? 'error' : 'default'}
                              isDisabled={isAdminDisabledField || isSubmitting}
                            >
                              <FormSelectOption value="" label={t('— Select —')} />
                              {dynamicOptions.map((opt) => (
                                <FormSelectOption key={opt} value={opt} label={opt} />
                              ))}
                            </FormSelect>
                            {fieldError && (
                              <HelperText>
                                <HelperTextItem variant="error">{fieldError}</HelperTextItem>
                              </HelperText>
                            )}
                          </FormGroup>
                        );
                      }

                      if (prop.enum && prop.enum.length > 0) {
                        return (
                          <FormGroup
                            key={key}
                            label={fieldLabel}
                            isRequired={isReq}
                            fieldId={fieldId}
                          >
                            {prop.description && (
                              <HelperText style={{ marginBottom: '0.25rem' }}>
                                <HelperTextItem>{prop.description}</HelperTextItem>
                              </HelperText>
                            )}
                            <FormSelect
                              id={fieldId}
                              value={formValues[key] ?? ''}
                              onChange={(_event, val) => setValue(key, val)}
                              validated={fieldError ? 'error' : 'default'}
                              isDisabled={isAdminDisabledField || isSubmitting}
                            >
                              {!isReq && <FormSelectOption value="" label={t('Select...')} />}
                              {prop.enum.map((opt) => (
                                <FormSelectOption key={opt} value={opt} label={opt} />
                              ))}
                            </FormSelect>
                            {fieldError && (
                              <HelperText>
                                <HelperTextItem variant="error">{fieldError}</HelperTextItem>
                              </HelperText>
                            )}
                          </FormGroup>
                        );
                      }
                      return (
                        <FormGroup
                          key={key}
                          label={fieldLabel}
                          isRequired={isReq}
                          fieldId={fieldId}
                        >
                          {prop.description && (
                            <HelperText style={{ marginBottom: '0.25rem' }}>
                              <HelperTextItem>{prop.description}</HelperTextItem>
                            </HelperText>
                          )}
                          <TextInput
                            id={fieldId}
                            type={
                              prop.type === 'integer' || prop.type === 'number' ? 'number' : 'text'
                            }
                            value={formValues[key] ?? ''}
                            onChange={(_event, val) => setValue(key, val)}
                            validated={fieldError ? 'error' : 'default'}
                            isRequired={isReq}
                            isDisabled={isAdminDisabledField || isSubmitting}
                            {...(prop.minimum !== undefined ? { min: prop.minimum } : {})}
                            {...(prop.maximum !== undefined ? { max: prop.maximum } : {})}
                          />
                          {fieldError && (
                            <HelperText>
                              <HelperTextItem variant="error">{fieldError}</HelperTextItem>
                            </HelperText>
                          )}
                        </FormGroup>
                      );
                    })}
                  </div>
                )}
              </Tab>
            );
          })}
        </Tabs>
      ) : (
        /* Fallback when no cloud/hypervisor backends are configured */
        <>
          {sortedEntries.map(([key, prop]) => {
            const fieldError = fieldErrors[key];
            const isReq = requiredSet.has(key);
            const fieldLabel = prop.title ?? key;
            const fieldId = `deploy-field-${key}`;
            const isAdminDisabledField = disabledFieldSet.has(key);
            if (prop.enum && prop.enum.length > 0) {
              return (
                <FormGroup key={key} label={fieldLabel} isRequired={isReq} fieldId={fieldId}>
                  {prop.description && (
                    <HelperText style={{ marginBottom: '0.25rem' }}>
                      <HelperTextItem>{prop.description}</HelperTextItem>
                    </HelperText>
                  )}
                  <FormSelect
                    id={fieldId}
                    value={formValues[key] ?? ''}
                    onChange={(_event, val) => setValue(key, val)}
                    validated={fieldError ? 'error' : 'default'}
                    isDisabled={isAdminDisabledField || isSubmitting}
                  >
                    {!isReq && <FormSelectOption value="" label={t('Select...')} />}
                    {prop.enum.map((opt) => (
                      <FormSelectOption key={opt} value={opt} label={opt} />
                    ))}
                  </FormSelect>
                  {fieldError && (
                    <HelperText>
                      <HelperTextItem variant="error">{fieldError}</HelperTextItem>
                    </HelperText>
                  )}
                </FormGroup>
              );
            }
            return (
              <FormGroup key={key} label={fieldLabel} isRequired={isReq} fieldId={fieldId}>
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
                  validated={fieldError ? 'error' : 'default'}
                  isRequired={isReq}
                  isDisabled={isAdminDisabledField || isSubmitting}
                  {...(prop.minimum !== undefined ? { min: prop.minimum } : {})}
                  {...(prop.maximum !== undefined ? { max: prop.maximum } : {})}
                />
                {fieldError && (
                  <HelperText>
                    <HelperTextItem variant="error">{fieldError}</HelperTextItem>
                  </HelperText>
                )}
              </FormGroup>
            );
          })}
        </>
      )}

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

      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
        <Button
          variant="primary"
          onClick={() => void onSubmit()}
          isLoading={isSubmitting}
          isDisabled={Boolean(lockedProvider) && !isProviderConfigured(lockedProvider!)}
        >
          {t('Deploy')}
        </Button>
        <Button variant="link" onClick={() => onCancel()} isDisabled={isSubmitting}>
          {t('Cancel')}
        </Button>
      </div>
    </Form>
  );
}
