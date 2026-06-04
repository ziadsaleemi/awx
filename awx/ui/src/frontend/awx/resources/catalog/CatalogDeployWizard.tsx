import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Checkbox,
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
import { requestGet } from '../../../common/crud/Data';
import { usePostRequest } from '../../../common/crud/usePostRequest';
import { AwxError } from '../../common/AwxError';
import { AwxRoute } from '../../main/AwxRoutes';
import { CatalogItem } from '../../interfaces/CatalogItem';
import { CatalogDeployment } from '../../interfaces/CatalogDeployment';
import { generateCatalogName, parseCatalogDynamicFieldNames } from './catalogNaming';
import { fetchProviderState } from '../cloud/cloudConnectionStore';

interface VmSizePreset {
  name: string;
  cpu: string;
  ram: string;
  enabled?: boolean;
}

type SurveyQuestionType =
  | 'text'
  | 'textarea'
  | 'password'
  | 'integer'
  | 'float'
  | 'multiplechoice'
  | 'multiselect';

interface SchemaProperty {
  type?: 'string' | 'integer' | 'number' | 'boolean' | 'array';
  title?: string;
  description?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  enum?: string[];
  items?: { type: 'string'; enum?: string[] };
  surveyType?: SurveyQuestionType;
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
  type: SurveyQuestionType;
  default?: unknown;
  choices?: string | string[]; // newline-separated or list choices for multiplechoice/multiselect
  min?: number;
  max?: number;
}

interface WjtSurveySpec {
  name: string;
  description?: string;
  spec: WjtSurveyQuestion[];
}

function normalizeSurveyChoices(choices: unknown): string[] {
  const rawChoices = Array.isArray(choices)
    ? choices
    : typeof choices === 'string'
      ? choices.split('\n')
      : [];
  return rawChoices.map((choice) => String(choice).trim()).filter((choice) => choice.length > 0);
}

function defaultToFormValue(prop: SchemaProperty): string {
  if (prop.default === undefined || prop.default === null || prop.default === '') return '';
  if (prop.type === 'array' || Array.isArray(prop.default)) {
    return normalizeSurveyChoices(prop.default).join('\n');
  }
  return String(prop.default);
}

function formValueToArray(value: string | undefined): string[] {
  return normalizeSurveyChoices(value ?? '');
}

/** Convert an AWX WJT survey spec into the JsonSchema format used by the form renderer. */
function surveySpecToSchema(spec: WjtSurveySpec): JsonSchema {
  const properties: Record<string, SchemaProperty> = {};
  const required: string[] = [];

  for (const q of spec.spec) {
    const prop: SchemaProperty = {
      title: q.question_name,
      description: q.question_description || undefined,
      surveyType: q.type,
    };

    if (q.type === 'integer') {
      prop.type = 'integer';
    } else if (q.type === 'float') {
      prop.type = 'number';
    } else if (q.type === 'multiselect') {
      prop.type = 'array';
    } else {
      prop.type = 'string';
    }

    if (q.default !== undefined && q.default !== null && q.default !== '') {
      prop.default = q.default;
    }

    if (q.min !== undefined) prop.minimum = q.min;
    if (q.max !== undefined) prop.maximum = q.max;

    if ((q.type === 'multiplechoice' || q.type === 'multiselect') && q.choices) {
      const choices = normalizeSurveyChoices(q.choices);
      prop.enum = choices;
      if (q.type === 'multiselect') {
        prop.items = { type: 'string', enum: choices };
      }
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

  // TTL / lease state
  const defaultLeaseMinutes = item.default_lease_minutes ?? null;
  const requireLease = item.require_lease ?? false;
  const [leaseDurationMinutes, setLeaseDurationMinutes] = useState<number | null>(
    defaultLeaseMinutes
  );
  const [autoDeprovision, setAutoDeprovision] = useState<boolean>(Boolean(defaultLeaseMinutes));

  const TTL_PRESETS = useMemo(
    () => [
      { label: t('2 h'), minutes: 120 },
      { label: t('8 h'), minutes: 480 },
      { label: t('24 h'), minutes: 1440 },
      { label: t('7 d'), minutes: 10080 },
    ],
    [t]
  );

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

  useEffect(() => {
    if (
      initialProvider &&
      (allProviders.includes(initialProvider) || initialProvider === 'default')
    ) {
      setSelectedProvider(initialProvider);
      return;
    }
    if (selectedProvider && allProviders.includes(selectedProvider)) {
      return;
    }
    setSelectedProvider(allProviders[0] ?? '');
  }, [allProviders, initialProvider, selectedProvider]);

  // When the modal is opened from a specific provider icon, lock to that provider
  // and skip rendering tabs for other providers.
  const lockedProvider = initialProvider ?? null;
  const isProviderConfigured = (p: string) =>
    Boolean(
      (item.provider_workflows && item.provider_workflows[p]) ||
        (item.cloud_backends && item.cloud_backends[p]) ||
        item.terraform_job_template ||
        item.provision_workflow
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
  const [providerSurveyData, setProviderSurveyData] = useState<WjtSurveySpec | undefined>();
  const [providerSurveyError, setProviderSurveyError] = useState<Error | undefined>();

  useEffect(() => {
    setProviderSurveyData(undefined);
    setProviderSurveyError(undefined);
    if (!providerSurveyUrl) return;

    const abortController = new AbortController();
    void requestGet<WjtSurveySpec>(providerSurveyUrl, abortController.signal)
      .then((data) => setProviderSurveyData(data))
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setProviderSurveyError(err instanceof Error ? err : new Error(String(err)));
      });

    return () => abortController.abort();
  }, [providerSurveyUrl]);

  // The active schema: provider survey > catalog deploy_survey > extra_vars_schema
  const schema = useMemo((): JsonSchema => {
    if (providerSurveyData?.spec) {
      return surveySpecToSchema(providerSurveyData);
    }
    return (deploySurvey?.schema ?? item.extra_vars_schema ?? {}) as JsonSchema;
  }, [providerSurveyData, deploySurvey?.schema, item.extra_vars_schema]);
  const properties = useMemo(() => schema.properties ?? {}, [schema.properties]);
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
      values[key] = defaultToFormValue(prop);
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
  const [leaseError, setLeaseError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Generic provider state for dynamic field source resolution
  const [providerStateData, setProviderStateData] = useState<Record<string, unknown> | null>(null);
  const [providerAdminSettings, setProviderAdminSettings] = useState<unknown>(null);

  // Global VM size presets (enabled only)
  const [globalVmSizes, setGlobalVmSizes] = useState<VmSizePreset[]>([]);
  const [selectedVmSize, setSelectedVmSize] = useState<string>('');

  // Fetch provider state for dynamic field source resolution.
  // For DigitalOcean, provider_data is a flat object { regions, pricing, images, vpcs }.
  // For other providers, provider_data is keyed by connection ID; aggregate arrays into a flat dict.
  useEffect(() => {
    if (!selectedProvider) {
      setProviderStateData(null);
      setProviderAdminSettings(null);
      return;
    }
    void fetchProviderState(selectedProvider, item.organization).then((state) => {
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
                  const values = val as unknown[];
                  if (aggregated[key]) {
                    aggregated[key].push(...values);
                  } else {
                    aggregated[key] = [...values];
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
  }, [item.organization, selectedProvider]);

  // Fetch global VM size presets once on mount
  useEffect(() => {
    void fetchProviderState('global', item.organization).then((state) => {
      const settings = state?.provider_settings as { vm_sizes?: VmSizePreset[] } | null | undefined;
      const sizes = settings?.vm_sizes ?? [];
      setGlobalVmSizes(sizes.filter((s) => s.enabled !== false));
    });
  }, [item.organization]);

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

  // VM size settings for the active provider
  const vmSizeSettings = providerFieldCfg?.vm_size_settings;
  const showVmSizePicker = vmSizeSettings?.enabled !== false && globalVmSizes.length > 0;

  const onVmSizeSelect = useCallback(
    (sizeName: string) => {
      setSelectedVmSize(sizeName);
      if (!sizeName) return;
      const size = globalVmSizes.find((s) => s.name === sizeName);
      if (size) {
        if (vmSizeSettings?.cpu_variable) {
          setFormValues((prev) => ({ ...prev, [vmSizeSettings.cpu_variable]: size.cpu }));
          setFieldErrors((prev) => ({ ...prev, [vmSizeSettings.cpu_variable]: '' }));
        }
        if (vmSizeSettings?.ram_variable) {
          setFormValues((prev) => ({ ...prev, [vmSizeSettings.ram_variable]: size.ram }));
          setFieldErrors((prev) => ({ ...prev, [vmSizeSettings.ram_variable]: '' }));
        }
      }
    },
    [globalVmSizes, vmSizeSettings]
  );

  // Determine whether the current CPU / RAM values exceed the configured limits
  const isLimitExceeded = useMemo(() => {
    if (!vmSizeSettings) return false;
    const cpuVar = vmSizeSettings.cpu_variable;
    const ramVar = vmSizeSettings.ram_variable;
    const cpuVal = cpuVar ? Number(formValues[cpuVar]) : NaN;
    const ramVal = ramVar ? Number(formValues[ramVar]) : NaN;
    const cpuOver =
      vmSizeSettings.cpu_limit !== null &&
      !Number.isNaN(cpuVal) &&
      cpuVal > (vmSizeSettings.cpu_limit ?? Infinity);
    const ramOver =
      vmSizeSettings.ram_limit !== null &&
      !Number.isNaN(ramVal) &&
      ramVal > (vmSizeSettings.ram_limit ?? Infinity);
    return cpuOver || ramOver;
  }, [formValues, vmSizeSettings]);

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

  const setMultiSelectValue = useCallback(
    (key: string, option: string, checked: boolean, options: string[]) => {
      setFormValues((prev) => {
        const selected = new Set(formValueToArray(prev[key]));
        if (checked) {
          selected.add(option);
        } else {
          selected.delete(option);
        }
        return {
          ...prev,
          [key]: options.filter((candidate) => selected.has(candidate)).join('\n'),
        };
      });
      setFieldErrors((prev) => ({ ...prev, [key]: '' }));
    },
    []
  );

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
    if (requireLease && (leaseDurationMinutes === null || leaseDurationMinutes <= 0)) {
      setLeaseError(t('This catalog item requires a lease duration.'));
      valid = false;
    } else {
      setLeaseError('');
    }
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
        if (prop.type === 'array' || prop.surveyType === 'multiselect') {
          extraVars[key] = formValueToArray(raw);
        } else if (prop.type === 'integer' || prop.type === 'number') {
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
      if (isLimitExceeded && vmSizeSettings?.require_approval) {
        body['requires_approval'] = true;
      }
      if (leaseDurationMinutes !== null && leaseDurationMinutes > 0) {
        const expiresAt = new Date(Date.now() + leaseDurationMinutes * 60 * 1000);
        body['expires_at'] = expiresAt.toISOString();
        body['auto_deprovision'] = autoDeprovision;
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
      {providerSurveyError && (
        <Alert
          variant="danger"
          isInline
          title={t('Failed to load provider survey')}
          style={{ marginBottom: '1rem' }}
        >
          {providerSurveyError.message}
        </Alert>
      )}
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
                    {/* VM size preset selector */}
                    {showVmSizePicker && (
                      <FormGroup
                        label={t('VM Size')}
                        fieldId="deploy-vm-size"
                        style={{ marginBottom: '1rem' }}
                      >
                        <FormSelect
                          id="deploy-vm-size"
                          value={selectedVmSize}
                          onChange={(_event, val) => onVmSizeSelect(val)}
                          isDisabled={isSubmitting}
                        >
                          <FormSelectOption value="" label={t('— Select a VM size preset —')} />
                          {globalVmSizes.map((size) => (
                            <FormSelectOption
                              key={size.name}
                              value={size.name}
                              label={`${size.name} (${size.cpu} CPU · ${size.ram} GB RAM)`}
                            />
                          ))}
                        </FormSelect>
                        <HelperText>
                          <HelperTextItem>
                            {vmSizeSettings?.allow_manual
                              ? t(
                                  'Selecting a preset pre-fills CPU and RAM. You can still edit them.'
                                )
                              : t('Selecting a preset fills in CPU and RAM automatically.')}
                          </HelperTextItem>
                        </HelperText>
                      </FormGroup>
                    )}

                    {/* Dynamic fields from the provider's WJT survey (or catalog deploy_survey fallback) */}
                    {sortedEntries.map(([key, prop]) => {
                      const fieldError = fieldErrors[key];
                      const isReq = requiredSet.has(key);
                      const fieldLabel = prop.title ?? key;
                      const fieldId = `deploy-field-${key}`;
                      const isAdminDisabledField = disabledFieldSet.has(key);
                      // Lock CPU/RAM inputs when a size is selected and manual override is not allowed
                      const isVmSizeLocked =
                        showVmSizePicker &&
                        !vmSizeSettings?.allow_manual &&
                        selectedVmSize !== '' &&
                        (key === vmSizeSettings?.cpu_variable ||
                          key === vmSizeSettings?.ram_variable);
                      const isEffectivelyDisabled = isAdminDisabledField || isVmSizeLocked;

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
                              isDisabled={isEffectivelyDisabled || isSubmitting}
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

                      if (prop.surveyType === 'multiselect' && prop.enum && prop.enum.length > 0) {
                        const selectedValues = formValueToArray(formValues[key]);
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
                            <div style={{ display: 'grid', gap: '0.5rem' }}>
                              {prop.enum.map((opt, index) => (
                                <Checkbox
                                  key={opt}
                                  id={`${fieldId}-${index}`}
                                  label={opt}
                                  isChecked={selectedValues.includes(opt)}
                                  onChange={(_event, checked) =>
                                    setMultiSelectValue(key, opt, checked, prop.enum ?? [])
                                  }
                                  isDisabled={isEffectivelyDisabled || isSubmitting}
                                />
                              ))}
                            </div>
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
                              isDisabled={isEffectivelyDisabled || isSubmitting}
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
                            isDisabled={isEffectivelyDisabled || isSubmitting}
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
            if (prop.surveyType === 'multiselect' && prop.enum && prop.enum.length > 0) {
              const selectedValues = formValueToArray(formValues[key]);
              return (
                <FormGroup key={key} label={fieldLabel} isRequired={isReq} fieldId={fieldId}>
                  {prop.description && (
                    <HelperText style={{ marginBottom: '0.25rem' }}>
                      <HelperTextItem>{prop.description}</HelperTextItem>
                    </HelperText>
                  )}
                  <div style={{ display: 'grid', gap: '0.5rem' }}>
                    {prop.enum.map((opt, index) => (
                      <Checkbox
                        key={opt}
                        id={`${fieldId}-${index}`}
                        label={opt}
                        isChecked={selectedValues.includes(opt)}
                        onChange={(_event, checked) =>
                          setMultiSelectValue(key, opt, checked, prop.enum ?? [])
                        }
                        isDisabled={isAdminDisabledField || isSubmitting}
                      />
                    ))}
                  </div>
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

      {/* Approval warning — shown when CPU/RAM exceeds the configured limit */}
      {isLimitExceeded && vmSizeSettings && (
        <Alert
          variant={vmSizeSettings.require_approval ? 'warning' : 'info'}
          isInline
          title={
            vmSizeSettings.require_approval
              ? t('Resource limits exceeded — admin approval required')
              : t('Resource limits exceeded')
          }
          style={{ marginBottom: '1rem' }}
        >
          {vmSizeSettings.require_approval
            ? t(
                'The requested CPU or RAM exceeds the configured limits (CPU: {{cpuLimit}} cores, RAM: {{ramLimit}} GB). This deployment will be submitted for admin approval before it runs.',
                {
                  cpuLimit: vmSizeSettings.cpu_limit ?? t('unlimited'),
                  ramLimit: vmSizeSettings.ram_limit ?? t('unlimited'),
                }
              )
            : t(
                'The requested CPU or RAM exceeds the configured limits (CPU: {{cpuLimit}} cores, RAM: {{ramLimit}} GB).',
                {
                  cpuLimit: vmSizeSettings.cpu_limit ?? t('unlimited'),
                  ramLimit: vmSizeSettings.ram_limit ?? t('unlimited'),
                }
              )}
        </Alert>
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

      {/* ---- TTL / Lease section ---- */}
      <FormGroup
        label={requireLease ? t('Lease duration (required)') : t('Lease duration (optional)')}
        fieldId="deploy-ttl"
      >
        <HelperText>
          <HelperTextItem>
            {t(
              'Set a time limit on this deployment. After the lease expires the deployment will be marked expired.'
            )}
          </HelperTextItem>
        </HelperText>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {TTL_PRESETS.map((preset) => (
            <Button
              key={preset.minutes}
              variant={leaseDurationMinutes === preset.minutes ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => {
                setLeaseDurationMinutes(preset.minutes);
                setLeaseError('');
              }}
            >
              {preset.label}
            </Button>
          ))}
          <Button
            variant={leaseDurationMinutes === null ? 'secondary' : 'plain'}
            size="sm"
            isDisabled={requireLease}
            onClick={() => {
              setLeaseDurationMinutes(null);
              setAutoDeprovision(false);
              setLeaseError('');
            }}
          >
            {t('No limit')}
          </Button>
        </div>
        {leaseError && (
          <HelperText>
            <HelperTextItem variant="error">{leaseError}</HelperTextItem>
          </HelperText>
        )}
        {leaseDurationMinutes !== null && (
          <div style={{ marginTop: '0.75rem' }}>
            <Checkbox
              id="deploy-auto-deprovision"
              label={t('Auto-deprovision when lease expires')}
              isChecked={autoDeprovision}
              onChange={(_evt, checked) => setAutoDeprovision(checked)}
            />
            <HelperText>
              <HelperTextItem>
                {autoDeprovision
                  ? t('The deprovision workflow will run automatically when the lease expires.')
                  : t(
                      'The deployment will be flagged as expired but resources will not be removed automatically.'
                    )}
              </HelperTextItem>
            </HelperText>
          </div>
        )}
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
