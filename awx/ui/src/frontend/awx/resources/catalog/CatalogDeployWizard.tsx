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
import {
  fetchProviderState,
  DigitalOceanProviderData,
  DigitalOceanAdminSettings,
} from '../cloud/cloudConnectionStore';

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
      prop.enum = q.choices
        .split('\n')
        .map((c) => c.trim())
        .filter(Boolean);
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

export function CatalogDeployWizard() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const id = params.id ?? '';
  const pageNavigate = usePageNavigate();

  const { data: item, error, isLoading, refresh } = useGetItem<CatalogItem>(
    awxAPI`/catalog_items`,
    id
  );

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
      <PageSection variant="light" hasBodyWrapper={false} style={{ padding: '1.5rem 2rem' }}>
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
    if (initialProvider && (allProviders.includes(initialProvider) || initialProvider === 'default')) {
      return initialProvider;
    }
    return allProviders[0] ?? '';
  });

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
    return (deploySurvey?.schema ?? (item.extra_vars_schema ?? {})) as JsonSchema;
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

  // DigitalOcean-specific state
  const [doData, setDoData] = useState<DigitalOceanProviderData | null>(null);
  const [doAdminSettings, setDoAdminSettings] = useState<DigitalOceanAdminSettings | null>(null);
  const [doRegion, setDoRegion] = useState('');
  const [doSize, setDoSize] = useState('');
  const [doImage, setDoImage] = useState('');
  const [doVpc, setDoVpc] = useState('');

  useEffect(() => {
    if (selectedProvider === 'digitalocean') {
      void fetchProviderState('digitalocean').then((state) => {
        if (state?.provider_data) {
          setDoData(state.provider_data as DigitalOceanProviderData);
        }
        if (state?.admin_settings) {
          setDoAdminSettings(state.admin_settings as DigitalOceanAdminSettings);
        }
      });
    }
  }, [selectedProvider]);

  // Allowed regions: intersection of admin allowlist + available flag
  const allowedRegions = useMemo(() => {
    if (!doData) return [];
    return doData.regions.filter(
      (r) =>
        r.available &&
        (!doAdminSettings?.allowedRegionSlugs ||
          doAdminSettings.allowedRegionSlugs.includes(r.slug))
    );
  }, [doData, doAdminSettings]);

  // Allowed sizes: admin allowlist, further narrowed to the selected region when set
  const allowedSizes = useMemo(() => {
    if (!doData) return [];
    return doData.pricing.filter(
      (s) =>
        s.available !== false &&
        (!doAdminSettings?.allowedSizeSlugs || doAdminSettings.allowedSizeSlugs.includes(s.slug)) &&
        (!doRegion || !s.regions || s.regions.length === 0 || s.regions.includes(doRegion))
    );
  }, [doData, doAdminSettings, doRegion]);

  // Allowed images: admin allowlist, further narrowed to the selected region when set
  const allowedImages = useMemo(() => {
    if (!doData) return [];
    return doData.images.filter(
      (img) =>
        (!doAdminSettings?.allowedImageIds || doAdminSettings.allowedImageIds.includes(img.id)) &&
        (!doRegion || !img.regions || img.regions.length === 0 || img.regions.includes(doRegion))
    );
  }, [doData, doAdminSettings, doRegion]);

  // Allowed VPCs: admin allowlist, further narrowed to the selected region when set
  const allowedVpcs = useMemo(() => {
    if (!doData) return [];
    return doData.vpcs.filter(
      (v) =>
        (!doAdminSettings?.allowedVpcIds || doAdminSettings.allowedVpcIds.includes(v.id)) &&
        (!doRegion || v.region === doRegion)
    );
  }, [doData, doAdminSettings, doRegion]);

  // When region changes, clear downstream selections that are no longer valid
  useEffect(() => {
    if (doSize && !allowedSizes.some((s) => s.slug === doSize)) setDoSize('');
    if (doImage && !allowedImages.some((img) => String(img.id) === doImage)) setDoImage('');
    if (doVpc && !allowedVpcs.some((v) => v.id === doVpc)) setDoVpc('');
  }, [doRegion, allowedSizes, allowedImages, allowedVpcs, doSize, doImage, doVpc]);

  // When provider changes, reset form values so stale fields from a previous survey don't persist
  useEffect(() => {
    setFormValues({});
    setFieldErrors({});
    setDoRegion('');
    setDoSize('');
    setDoImage('');
    setDoVpc('');
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
  }, [deploymentList?.results, dynamicFieldNames, formValues, item.name, item.name_template, item.summary_fields?.organization?.name]);

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

      // Inject DigitalOcean-specific extra vars when provider is selected
      if (selectedProvider === 'digitalocean') {
        if (doSize) extraVars['do_droplet_size'] = doSize;
        if (doImage) extraVars['do_image_id'] = Number(doImage) || doImage;
        if (doRegion) extraVars['do_region'] = doRegion;
        if (doVpc) extraVars['do_vpc_uuid'] = doVpc;
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
    ...Object.entries(properties).filter(([key]) => requiredSet.has(key) && !hiddenFieldSet.has(key)),
    ...Object.entries(properties).filter(([key]) => !requiredSet.has(key) && !hiddenFieldSet.has(key)),
  ];

  return (
    <Form>
          {/* Provider tabs — one per cloud/hypervisor backend */}
          {allProviders.length > 0 ? (
            <Tabs
              activeKey={selectedProvider}
              onSelect={(_evt, key) => setSelectedProvider(String(key))}
              style={{ marginBottom: '1.5rem' }}
            >
              {allProviders.map((p) => {
                const tabLabel = PROVIDER_LABELS[p] ?? p.charAt(0).toUpperCase() + p.slice(1);
                return (
                  <Tab key={p} eventKey={p} title={<TabTitleText>{tabLabel}</TabTitleText>}>
                    {/* Only render content for the active tab so hooks/schema stay in sync */}
                    {selectedProvider === p && (
                      <div style={{ paddingTop: '1.25rem' }}>
                        {/* DigitalOcean infrastructure selectors */}
                        {p === 'digitalocean' && doData && (
                          <>
                            <FormGroup label={t('Region')} isRequired fieldId="do-region">
                              <FormSelect
                                id="do-region"
                                value={doRegion}
                                onChange={(_evt, val) => setDoRegion(val)}
                              >
                                <FormSelectOption value="" label={t('— Select region —')} />
                                {allowedRegions.map((r) => (
                                  <FormSelectOption key={r.slug} value={r.slug} label={r.name} />
                                ))}
                              </FormSelect>
                            </FormGroup>
                            <FormGroup label={t('Droplet size')} isRequired fieldId="do-size">
                              <FormSelect
                                id="do-size"
                                value={doSize}
                                onChange={(_evt, val) => setDoSize(val)}
                                isDisabled={!doRegion}
                              >
                                <FormSelectOption value="" label={doRegion ? t('— Select size —') : t('— Select a region first —')} />
                                {allowedSizes.map((s) => (
                                  <FormSelectOption
                                    key={s.slug}
                                    value={s.slug}
                                    label={`${s.slug} — ${s.vcpus} vCPU · ${(s.memory_mb / 1024).toFixed(0)} GB RAM · $${s.price_monthly.toFixed(0)}/mo`}
                                  />
                                ))}
                              </FormSelect>
                            </FormGroup>
                            <FormGroup label={t('Image')} isRequired fieldId="do-image">
                              <FormSelect
                                id="do-image"
                                value={doImage}
                                onChange={(_evt, val) => setDoImage(val)}
                                isDisabled={!doRegion}
                              >
                                <FormSelectOption value="" label={doRegion ? t('— Select image —') : t('— Select a region first —')} />
                                {allowedImages.map((img) => (
                                  <FormSelectOption
                                    key={img.id}
                                    value={String(img.id)}
                                    label={`${img.name} (${img.distribution})`}
                                  />
                                ))}
                              </FormSelect>
                            </FormGroup>
                            <FormGroup label={t('VPC')} fieldId="do-vpc">
                              <FormSelect
                                id="do-vpc"
                                value={doVpc}
                                onChange={(_evt, val) => setDoVpc(val)}
                                isDisabled={!doRegion}
                              >
                                <FormSelectOption value="" label={doRegion ? t('— Select VPC (optional) —') : t('— Select a region first —')} />
                                {allowedVpcs.map((v) => (
                                  <FormSelectOption
                                    key={v.id}
                                    value={v.id}
                                    label={`${v.name} (${v.ip_range})`}
                                  />
                                ))}
                              </FormSelect>
                            </FormGroup>
                          </>
                        )}

                        {/* Dynamic fields from the provider's WJT survey (or catalog deploy_survey fallback) */}
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
            <Button variant="primary" onClick={() => void onSubmit()} isLoading={isSubmitting}>
              {t('Deploy')}
            </Button>
            <Button
              variant="link"
              onClick={() => onCancel()}
              isDisabled={isSubmitting}
            >
              {t('Cancel')}
            </Button>
          </div>
        </Form>
  );
}
