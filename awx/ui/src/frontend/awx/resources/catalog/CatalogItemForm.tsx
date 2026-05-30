import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import {
  Button,
  Checkbox,
  DataList,
  FormSelect,
  FormSelectOption,
  DataListCell,
  DataListContent,
  DataListItem,
  DataListItemCells,
  DataListItemRow,
  DataListToggle,
  FormGroup,
  Grid,
  GridItem,
  Label,
  Switch,
  TextInput,
} from '@patternfly/react-core';
import {
  LoadingPage,
  PageTab,
  PageTabs,
  PageFormSubmitHandler,
  PageHeader,
  PageLayout,
  usePageNavigate,
} from '../../../../framework';
import { PageFormTextInput } from '../../../../framework/PageForm/Inputs/PageFormTextInput';
import { PageFormTextArea } from '../../../../framework/PageForm/Inputs/PageFormTextArea';
import { PageFormCheckbox } from '../../../../framework/PageForm/Inputs/PageFormCheckbox';
import { AwxPageForm } from '../../common/AwxPageForm';
import { awxAPI } from '../../common/api/awx-utils';
import { useGetItem } from '../../../common/crud/useGet';
import { useGet } from '../../../common/crud/useGet';
import { requestPatch, postRequest } from '../../../common/crud/Data';
import { AwxError } from '../../common/AwxError';
import { AwxRoute } from '../../main/AwxRoutes';
import { CatalogItem } from '../../interfaces/CatalogItem';
import { PageFormSelectOrganization } from '../../access/organizations/components/PageFormOrganizationSelect';
import { useSelectWorkflowJobTemplate } from '../templates/hooks/useSelectWorkflowJobTemplate';
import { PageAsyncSingleSelect } from '../../../../framework/PageInputs/PageAsyncSingleSelect';
import { requestGet } from '../../../common/crud/Data';
import { AwxItemsResponse } from '../../common/AwxItemsResponse';
import { Survey } from '../../interfaces/Survey';
import { PageFormGroup } from '../../../../framework/PageForm/Inputs/PageFormGroup';
import { Controller, useController, useFieldArray, useFormContext } from 'react-hook-form';
import { parseCatalogDynamicFieldNames } from './catalogNaming';

interface ProviderConfig {
  provider: string;
  tft_id: number | null;
  wjt_id: number | null;
  dwjt_id: number | null;
  enabled: boolean;
}

interface CatalogItemFormValues {
  name: string;
  description: string;
  icon_data: string;
  icon_url: string;
  name_template: string;
  dynamic_name_field: string;
  dynamic_field_templates: Record<string, string>;
  deploy_disabled_fields: string[];
  deploy_hidden_fields: string[];
  organization: number | null;
  provision_workflow: number | null;
  terraform_job_template: number | null;
  deprovision_workflow: number | null;
  override_workflow_limit: boolean;
  extra_vars_schema: string;
  provider_configs: ProviderConfig[];
  provider_field_configs: Record<string, {
    disabled_fields: string[];
    hidden_fields: string[];
    field_templates: Record<string, string>;
    dynamic_field_sources: Record<string, string>;
    target_inventory?: number | null;
    target_group?: string;
    vm_size_settings?: {
      enabled: boolean;
      allow_manual: boolean;
      cpu_variable: string;
      ram_variable: string;
      cpu_limit: number | null;
      ram_limit: number | null;
      require_approval: boolean;
    };
  }>;
}

const StyledUploadButton = styled.label`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 16px;
  background-color: var(--pf-v5-global--primary-color--100);
  color: #fff;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 500;
  transition: background-color 0.2s;
  width: fit-content;

  &:hover {
    background-color: var(--pf-v5-global--primary-color--200);
  }
`;

const DynamicFieldRow = styled.div`
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
  padding: 12px 16px;
  background-color: #222428;
  border: 1px solid var(--pf-v5-global--BorderColor--100);
  border-radius: 6px;
  margin-bottom: 8px;
`;

const SuggestionDropdown = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  margin-top: 4px;
  z-index: 20;
  border: 1px solid var(--pf-v5-global--BorderColor--100);
  background-color: #222428 !important;
  border-radius: 4px;
  box-shadow: var(--pf-v5-global--BoxShadow--sm);
  max-height: 220px;
  overflow-y: auto;
`;

const SuggestionItem = styled(Button)`
  width: 100% !important;
  justify-content: flex-start !important;
  text-align: left !important;
  border-radius: 0 !important;
  padding: 8px 12px !important;
  background-color: transparent !important;
  color: var(--pf-v5-global--Color--100) !important;

  &:hover {
    background-color: var(--pf-v5-global--BackgroundColor--200) !important;
    color: var(--pf-v5-global--primary-color--100) !important;
  }
`;

/* eslint-disable-next-line i18next/no-literal-string */
const extraVarsSchemaPlaceholder = '{\n  "type": "object",\n  "properties": {}\n}';

const templateVariablePattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function parseSchemaVariableNames(rawSchema: string | undefined): string[] {
  if (!rawSchema?.trim()) return [];

  try {
    const parsed = JSON.parse(rawSchema) as { properties?: Record<string, unknown> };
    return Object.keys(parsed.properties ?? {}).filter((name) =>
      templateVariablePattern.test(name)
    );
  } catch {
    return [];
  }
}

function getTemplateVariables(template: string): string[] {
  const names = new Set<string>();
  for (const match of template.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)) {
    if (match[1] !== 'user_org_name') {
      names.add(match[1]);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

function removeTemplateVariable(template: string, variable: string): string {
  const escapedVariable = variable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return template
    .replace(new RegExp(`\\{${escapedVariable}\\}`, 'g'), '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function getTemplateTokenContext(value: string, cursorPosition: number) {
  const safeCursor = Math.max(0, Math.min(cursorPosition, value.length));
  const beforeCursor = value.slice(0, safeCursor);
  const lastOpenBrace = beforeCursor.lastIndexOf('{');
  const lastCloseBrace = beforeCursor.lastIndexOf('}');

  if (lastOpenBrace < 0 || lastCloseBrace > lastOpenBrace) {
    return undefined;
  }

  const typedFragment = beforeCursor.slice(lastOpenBrace + 1);
  if (!/^[a-zA-Z0-9_]*$/.test(typedFragment)) {
    return undefined;
  }

  return {
    openBraceIndex: lastOpenBrace,
    typedFragment,
    cursorPosition: safeCursor,
  };
}

function makeDefaultValues(item?: CatalogItem): CatalogItemFormValues {
  return {
    name: item?.name ?? '',
    description: item?.description ?? '',
    icon_data: item?.icon_data ?? '',
    icon_url: item?.icon_url ?? '',
    name_template: item?.name_template ?? '',
    dynamic_name_field: item?.dynamic_name_field ?? '',
    dynamic_field_templates: item?.dynamic_field_templates ?? {},
    deploy_disabled_fields: item?.deploy_disabled_fields ?? [],
    deploy_hidden_fields: item?.deploy_hidden_fields ?? [],
    organization: item?.organization ?? item?.summary_fields?.organization?.id ?? null,
    provision_workflow:
      item?.provision_workflow ?? item?.summary_fields?.provision_workflow?.id ?? null,
    terraform_job_template:
      item?.terraform_job_template ?? item?.summary_fields?.terraform_job_template?.id ?? null,
    deprovision_workflow:
      item?.deprovision_workflow ?? item?.summary_fields?.deprovision_workflow?.id ?? null,
    override_workflow_limit: item?.override_workflow_limit ?? true,
    extra_vars_schema: item?.extra_vars_schema
      ? JSON.stringify(item.extra_vars_schema, null, 2)
      : '',
    provider_configs: buildProviderConfigs(item),
    provider_field_configs: item?.provider_field_configs ?? {},
  };
}

function buildProviderConfigs(item?: CatalogItem): ProviderConfig[] {
  const allProviders = new Set<string>();
  if (item?.available_providers) {
    item.available_providers.forEach((p) => allProviders.add(p));
  }
  if (item?.cloud_backends) {
    Object.keys(item.cloud_backends).forEach((p) => allProviders.add(p));
  }
  if (item?.provider_workflows) {
    Object.keys(item.provider_workflows).forEach((p) => allProviders.add(p));
  }
  if (item?.provider_deprovision_workflows) {
    Object.keys(item.provider_deprovision_workflows).forEach((p) => allProviders.add(p));
  }
  return Array.from(allProviders).map((provider) => ({
    provider,
    tft_id: (item?.cloud_backends as Record<string, number> | null)?.[provider] ?? null,
    wjt_id: (item?.provider_workflows as Record<string, number> | null)?.[provider] ?? null,
    dwjt_id: (item?.provider_deprovision_workflows as Record<string, number> | null)?.[provider] ?? null,
    enabled: item?.available_providers?.includes(provider) ?? false,
  }));
}

export function CreateCatalogItem() {
  const { t } = useTranslation();
  const pageNavigate = usePageNavigate();

  const onSubmit: PageFormSubmitHandler<CatalogItemFormValues> = async (values) => {
    let extra_vars_schema: Record<string, unknown> | null = null;
    if ((values.extra_vars_schema ?? '').trim()) {
      extra_vars_schema = JSON.parse(values.extra_vars_schema) as Record<string, unknown>;
    }
    const payload = {
      name: values.name,
      description: values.description,
      icon_data: values.icon_data,
      icon_url: values.icon_url,
      name_template: values.name_template,
      dynamic_name_field: values.dynamic_name_field,
      dynamic_field_templates: values.dynamic_field_templates,
      deploy_disabled_fields: values.deploy_disabled_fields,
      deploy_hidden_fields: values.deploy_hidden_fields,
      organization: values.organization ?? null,
      provision_workflow: values.provision_workflow,
      terraform_job_template: values.terraform_job_template,
      deprovision_workflow: values.deprovision_workflow,
      override_workflow_limit: values.override_workflow_limit,
      extra_vars_schema,
      cloud_backends:
        values.provider_configs.filter((e) => e.provider && e.tft_id != null).length > 0
          ? Object.fromEntries(
              values.provider_configs
                .filter((e) => e.provider && e.tft_id != null)
                .map((e) => [e.provider, e.tft_id as number])
            )
          : null,
      provider_workflows:
        values.provider_configs.filter((e) => e.provider && e.wjt_id != null).length > 0
          ? Object.fromEntries(
              values.provider_configs
                .filter((e) => e.provider && e.wjt_id != null)
                .map((e) => [e.provider, e.wjt_id as number])
            )
          : null,
      provider_deprovision_workflows:
        values.provider_configs.filter((e) => e.provider && e.dwjt_id != null).length > 0
          ? Object.fromEntries(
              values.provider_configs
                .filter((e) => e.provider && e.dwjt_id != null)
                .map((e) => [e.provider, e.dwjt_id as number])
            )
          : null,
      available_providers:
        values.provider_configs.filter((e) => e.provider && e.enabled).length > 0
          ? values.provider_configs.filter((e) => e.provider && e.enabled).map((e) => e.provider)
          : null,
      provider_field_configs:
        Object.keys(values.provider_field_configs).length > 0
          ? values.provider_field_configs
          : null,
    };
    const created = await postRequest<CatalogItem, typeof payload>(
      awxAPI`/catalog_items/`,
      payload
    );
    pageNavigate(AwxRoute.CatalogItemPage, { params: { id: created.id } });
  };

  return (
    <PageLayout>
      <PageHeader
        title={t('Create Catalog Item')}
        breadcrumbs={[{ label: t('Catalog Items') }, { label: t('Create Catalog Item') }]}
      />
      <AwxPageForm
        submitText={t('Create catalog item')}
        onSubmit={onSubmit}
        defaultValue={makeDefaultValues()}
        onCancel={() => pageNavigate(AwxRoute.CatalogAdminItems)}
      >
        <CatalogItemFormInputs />
      </AwxPageForm>
    </PageLayout>
  );
}

export function EditCatalogItem() {
  const { t } = useTranslation();
  const pageNavigate = usePageNavigate();
  const params = useParams<{ id: string }>();
  const id = params.id ?? '';

  const { data: item, error, refresh } = useGetItem<CatalogItem>(awxAPI`/catalog_items`, id);

  if (error) return <AwxError error={error} handleRefresh={refresh} />;
  if (!item) return <LoadingPage />;

  const onSubmit: PageFormSubmitHandler<CatalogItemFormValues> = async (values) => {
    let extra_vars_schema: Record<string, unknown> | null = null;
    if ((values.extra_vars_schema ?? '').trim()) {
      extra_vars_schema = JSON.parse(values.extra_vars_schema) as Record<string, unknown>;
    }
    const payload = {
      name: values.name,
      description: values.description,
      icon_data: values.icon_data,
      icon_url: values.icon_url,
      name_template: values.name_template,
      dynamic_name_field: values.dynamic_name_field,
      dynamic_field_templates: values.dynamic_field_templates,
      deploy_disabled_fields: values.deploy_disabled_fields,
      deploy_hidden_fields: values.deploy_hidden_fields,
      organization: values.organization ?? null,
      provision_workflow: values.provision_workflow,
      terraform_job_template: values.terraform_job_template,
      deprovision_workflow: values.deprovision_workflow,
      override_workflow_limit: values.override_workflow_limit,
      extra_vars_schema,
      cloud_backends:
        values.provider_configs.filter((e) => e.provider && e.tft_id != null).length > 0
          ? Object.fromEntries(
              values.provider_configs
                .filter((e) => e.provider && e.tft_id != null)
                .map((e) => [e.provider, e.tft_id as number])
            )
          : null,
      provider_workflows:
        values.provider_configs.filter((e) => e.provider && e.wjt_id != null).length > 0
          ? Object.fromEntries(
              values.provider_configs
                .filter((e) => e.provider && e.wjt_id != null)
                .map((e) => [e.provider, e.wjt_id as number])
            )
          : null,
      provider_deprovision_workflows:
        values.provider_configs.filter((e) => e.provider && e.dwjt_id != null).length > 0
          ? Object.fromEntries(
              values.provider_configs
                .filter((e) => e.provider && e.dwjt_id != null)
                .map((e) => [e.provider, e.dwjt_id as number])
            )
          : null,
      available_providers:
        values.provider_configs.filter((e) => e.provider && e.enabled).length > 0
          ? values.provider_configs.filter((e) => e.provider && e.enabled).map((e) => e.provider)
          : null,
      provider_field_configs:
        Object.keys(values.provider_field_configs).length > 0
          ? values.provider_field_configs
          : null,
    };
    await requestPatch<typeof payload>(awxAPI`/catalog_items/${id}/`, payload);
    pageNavigate(AwxRoute.CatalogItemPage, { params: { id } });
  };

  return (
    <PageLayout>
      <PageHeader
        title={t('Edit Catalog Item')}
        breadcrumbs={[{ label: t('Catalog Items') }, { label: item.name }, { label: t('Edit') }]}
      />
      <AwxPageForm
        submitText={t('Save catalog item')}
        onSubmit={onSubmit}
        defaultValue={makeDefaultValues(item)}
        onCancel={() => pageNavigate(AwxRoute.CatalogItemPage, { params: { id } })}
      >
        <CatalogItemFormInputs />
      </AwxPageForm>
    </PageLayout>
  );
}

function CatalogItemFormInputs() {
  const { t } = useTranslation();
  const { watch } = useFormContext<CatalogItemFormValues>();
  const providerConfigs = watch('provider_configs');
  const enabledProviders = providerConfigs.filter((c) => c.enabled);

  return (
    <div style={{ width: '100%', gridColumn: '1 / -1' }}>
      <PageTabs initialTabIndex={0}>
        <PageTab label={t('Details')}>
          <div style={{ marginTop: 16, display: 'grid', gap: 20 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: 16,
                alignItems: 'start',
              }}
            >
              <PageFormTextInput<CatalogItemFormValues>
                name="name"
                label={t('Name')}
                isRequired
                maxLength={512}
                placeholder={t('Enter catalog item name')}
              />
              <PageFormTextInput<CatalogItemFormValues>
                name="description"
                label={t('Description')}
                placeholder={t('Enter an optional description')}
              />
              <CatalogNameTemplateInput />
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: 16,
                alignItems: 'start',
              }}
            >
              <PageFormSelectOrganization<CatalogItemFormValues> name="organization" />
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: 16,
                alignItems: 'start',
              }}
            >
              <CatalogItemImageUpload />
              <PageFormCheckbox<CatalogItemFormValues>
                name="override_workflow_limit"
                label={t('Override downstream workflow limit')}
                labelHelpTitle={t('Override downstream workflow limit')}
                labelHelp={t(
                  'When enabled, deployments force terraform_override_limit=true so workflow-launched job templates can use Terraform-provided host limits.'
                )}
              />
              <PageFormTextArea<CatalogItemFormValues>
                name="extra_vars_schema"
                label={t('Extra variables schema')}
                labelHelpTitle={t('Extra variables schema')}
                labelHelp={t(
                  'Optional JSON Schema definition for additional deploy-time fields. Workflow survey questions are pulled live from the provision workflow and merged at launch.'
                )}
                placeholder={extraVarsSchemaPlaceholder}
              />
            </div>
          </div>
        </PageTab>
        <PageTab label={t('Cloud providers')}>
          <CloudProvidersTab />
        </PageTab>
        {enabledProviders.map((config) => (
          <PageTab
            key={config.provider}
            label={`${PROVIDER_LABELS[config.provider] ?? config.provider} Fields`}
          >
            <ProviderFormFieldsTab provider={config.provider} />
          </PageTab>
        ))}
      </PageTabs>
    </div>
  );
}

const PROVIDER_LABELS: Record<string, string> = {
  digitalocean: 'DigitalOcean',
  proxmox: 'Proxmox VE',
  vmware: 'VMware vSphere',
  azure: 'Microsoft Azure',
  aws: 'Amazon AWS',
};

interface CloudConnectionApiResult {
  count: number;
  results: Array<{
    id: number;
    provider_id: string;
    name: string;
    status: string;
  }>;
}

function ProviderWjtSelector({ index }: { index: number }) {
  const { t } = useTranslation();
  const { control, watch } = useFormContext<CatalogItemFormValues>();
  const openSelect = useSelectWorkflowJobTemplate();
  const [localName, setLocalName] = useState<string | null>(null);
  const providerConfigs = watch('provider_configs');
  const idValue = providerConfigs[index]?.wjt_id ?? null;

  const { data: wjtInfo } = useGet<{ id: number; name: string }>(
    idValue != null && localName === null
      ? awxAPI`/workflow_job_templates/${String(idValue)}/`
      : undefined
  );
  useEffect(() => {
    if (wjtInfo?.name) setLocalName(wjtInfo.name);
  }, [wjtInfo?.name]);

  const queryOptions = async (options: {
    next?: string | number;
    search?: string;
    signal?: AbortSignal;
  }) => {
    const params = new URLSearchParams();
    params.set('page_size', '20');
    params.set('order_by', 'name');
    if (options.next) params.set('name__gt', String(options.next));
    if (options.search) params.set('name__icontains', options.search);
    try {
      const url = awxAPI`/workflow_job_templates/` + '?' + params.toString();
      const response = await requestGet<AwxItemsResponse<{ id: number; name: string }>>(
        url,
        options.signal
      );
      const results = response.results ?? [];
      return {
        remaining: response.count - results.length,
        options: results.map((r) => ({ label: r.name, value: r.id })),
        next: results[results.length - 1]?.name,
      };
    } catch {
      return { remaining: 0, options: [], next: 0 };
    }
  };

  return (
    <FormGroup label={t('Survey workflow')}>
      <Controller
        control={control}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        name={`provider_configs.${index}.wjt_id` as any}
        shouldUnregister={false}
        render={({ field }) => (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <PageAsyncSingleSelect<number>
                id={`wjt-${index}`}
                placeholder={t('Select workflow job template')}
                queryPlaceholder={t('Loading workflows…')}
                queryErrorText={t('Error loading workflows')}
                value={(idValue as number) ?? undefined}
                onSelect={(v) => {
                  field.onChange(v ?? null);
                  setLocalName(null);
                }}
                queryOptions={queryOptions}
                queryLabel={(v) => <>{localName ?? `#${String(v)}`}</>}
                onBrowse={() =>
                  openSelect((wjt) => {
                    field.onChange(wjt.id);
                    setLocalName(wjt.name);
                  })
                }
              />
            </div>
            {idValue != null && (
              <Button
                variant="plain"
                onClick={() => {
                  field.onChange(null);
                  setLocalName(null);
                }}
                aria-label={t('Clear')}
              >
                ✕
              </Button>
            )}
          </div>
        )}
      />
    </FormGroup>
  );
}

function ProviderDeprovisionWjtSelector({ index }: { index: number }) {
  const { t } = useTranslation();
  const { control, watch } = useFormContext<CatalogItemFormValues>();
  const openSelect = useSelectWorkflowJobTemplate();
  const [localName, setLocalName] = useState<string | null>(null);
  const providerConfigs = watch('provider_configs');
  const idValue = providerConfigs[index]?.dwjt_id ?? null;

  const { data: wjtInfo } = useGet<{ id: number; name: string }>(
    idValue != null && localName === null
      ? awxAPI`/workflow_job_templates/${String(idValue)}/`
      : undefined
  );
  useEffect(() => {
    if (wjtInfo?.name) setLocalName(wjtInfo.name);
  }, [wjtInfo?.name]);

  const queryOptions = async (options: {
    next?: string | number;
    search?: string;
    signal?: AbortSignal;
  }) => {
    const params = new URLSearchParams();
    params.set('page_size', '20');
    params.set('order_by', 'name');
    if (options.next) params.set('name__gt', String(options.next));
    if (options.search) params.set('name__icontains', options.search);
    try {
      const url = awxAPI`/workflow_job_templates/` + '?' + params.toString();
      const response = await requestGet<AwxItemsResponse<{ id: number; name: string }>>(
        url,
        options.signal
      );
      const results = response.results ?? [];
      return {
        remaining: response.count - results.length,
        options: results.map((r) => ({ label: r.name, value: r.id })),
        next: results[results.length - 1]?.name,
      };
    } catch {
      return { remaining: 0, options: [], next: 0 };
    }
  };

  return (
    <FormGroup label={t('Deprovision workflow')}>
      <Controller
        control={control}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        name={`provider_configs.${index}.dwjt_id` as any}
        shouldUnregister={false}
        render={({ field }) => (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <PageAsyncSingleSelect<number>
                id={`dwjt-${index}`}
                placeholder={t('Select deprovision workflow')}
                queryPlaceholder={t('Loading workflows…')}
                queryErrorText={t('Error loading workflows')}
                value={(idValue as number) ?? undefined}
                onSelect={(v) => {
                  field.onChange(v ?? null);
                  setLocalName(null);
                }}
                queryOptions={queryOptions}
                queryLabel={(v) => <>{localName ?? `#${String(v)}`}</>}
                onBrowse={() =>
                  openSelect((wjt) => {
                    field.onChange(wjt.id);
                    setLocalName(wjt.name);
                  })
                }
              />
            </div>
            {idValue != null && (
              <Button
                variant="plain"
                onClick={() => {
                  field.onChange(null);
                  setLocalName(null);
                }}
                aria-label={t('Clear')}
              >
                ✕
              </Button>
            )}
          </div>
        )}
      />
    </FormGroup>
  );
}

function CloudProvidersTab() {
  const { t } = useTranslation();
  const { control, watch } = useFormContext<CatalogItemFormValues>();
  const { fields, append } = useFieldArray({ control, name: 'provider_configs' });
  const [expandedProviders, setExpandedProviders] = useState<Record<string, boolean>>({});

  const { data: connectionsData } = useGet<CloudConnectionApiResult>(
    awxAPI`/catalog_cloud/connections/`
  );

  const providerConfigs = watch('provider_configs');

  // Ensure all connected providers appear in the field array
  useEffect(() => {
    if (!connectionsData?.results) return;
    const providerIds = new Set(connectionsData.results.map((c) => c.provider_id));
    providerIds.forEach((pid) => {
      const exists = providerConfigs.some((c) => c.provider === pid);
      if (!exists) {
        append({ provider: pid, tft_id: null, wjt_id: null, dwjt_id: null, enabled: false });
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionsData]);

  // Group connections by provider_id
  const providerGroups = useMemo(() => {
    const groups: Record<string, Array<{ id: number; name: string; status: string }>> = {};
    for (const conn of connectionsData?.results ?? []) {
      if (!groups[conn.provider_id]) groups[conn.provider_id] = [];
      groups[conn.provider_id].push({ id: conn.id, name: conn.name, status: conn.status });
    }
    return groups;
  }, [connectionsData]);

  const toggleExpand = (pid: string) =>
    setExpandedProviders((prev) => ({ ...prev, [pid]: !prev[pid] }));

  return (
    <div style={{ marginTop: 16 }}>
      <p style={{ color: 'var(--pf-v5-global--Color--200)', marginBottom: 12 }}>
        {t(
          'Enable cloud providers for this catalog item and select the survey workflow for each.'
        )}
      </p>
      {fields.length > 0 ? (
        <DataList aria-label={t('Cloud provider configurations')} isCompact>
          {fields.map((field, index) => {
            const conns = providerGroups[field.provider] ?? [];
            const hasConnected = conns.some((c) => c.status === 'connected');
            const label = PROVIDER_LABELS[field.provider] ?? field.provider;
            const enabled = providerConfigs[index]?.enabled ?? false;
            const isExpanded = (expandedProviders[field.provider] ?? false) && hasConnected;
            const rowId = `provider-label-${field.provider}`;
            const expandId = `provider-expand-${field.provider}`;

            return (
              <DataListItem key={field.id} aria-labelledby={rowId} isExpanded={isExpanded}>
                <DataListItemRow>
                  <DataListToggle
                    onClick={() => hasConnected && toggleExpand(field.provider)}
                    isExpanded={isExpanded}
                    id={`provider-toggle-${field.provider}`}
                    aria-controls={expandId}
                  />
                  <DataListItemCells
                    dataListCells={[
                      <DataListCell key="label">
                        <span id={rowId} style={{ fontWeight: 600 }}>
                          {label}
                        </span>
                        {!hasConnected && (
                          <Label color="red" isCompact style={{ marginLeft: 8 }}>
                            {t('No active connector')}
                          </Label>
                        )}
                      </DataListCell>,
                      <DataListCell key="switch" isFilled={false} alignRight>
                        <Controller
                          control={control}
                          name={`provider_configs.${index}.enabled`}
                          render={({ field: f }) => (
                            <Switch
                              id={`provider-switch-${index}`}
                              isChecked={f.value}
                              onChange={(_e, checked) => {
                                f.onChange(checked);
                                if (checked && !isExpanded) toggleExpand(field.provider);
                              }}
                              isDisabled={!hasConnected}
                              aria-label={t('Enable {{label}}', { label })}
                              label={t('Enabled')}
                              labelOff={t('Disabled')}
                            />
                          )}
                        />
                      </DataListCell>,
                    ]}
                  />
                </DataListItemRow>
                <DataListContent
                  aria-label={t('{{label}} configuration', { label })}
                  id={expandId}
                  isHidden={!isExpanded}
                >
                  {conns.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <p
                        style={{
                          fontSize: '0.85rem',
                          fontWeight: 600,
                          color: 'var(--pf-v5-global--Color--200)',
                          marginBottom: 8,
                        }}
                      >
                        {t('Connectors')}
                      </p>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {conns.map((conn) => (
                          <Label
                            key={conn.id}
                            color={conn.status === 'connected' ? 'green' : 'red'}
                            isCompact
                          >
                            {conn.name}{' '}
                            <span
                              style={{
                                fontSize: '0.75rem',
                                textTransform: 'capitalize',
                                opacity: 0.8,
                              }}
                            >
                              ({conn.status})
                            </span>
                          </Label>
                        ))}
                      </div>
                    </div>
                  )}
                  {enabled && (
                    <Grid hasGutter>
                      <GridItem sm={12} lg={6}>
                        <ProviderWjtSelector index={index} />
                      </GridItem>
                      <GridItem sm={12} lg={6}>
                        <ProviderDeprovisionWjtSelector index={index} />
                      </GridItem>
                    </Grid>
                  )}
                </DataListContent>
              </DataListItem>
            );
          })}
        </DataList>
      ) : (
        <p style={{ color: 'var(--pf-v5-global--Color--200)', fontSize: '0.875rem' }}>
          {t('No cloud provider connections found. Add connections in Cloud Connectors first.')}
        </p>
      )}
    </div>
  );
}

function CatalogDynamicFieldSelector() {
  const { t } = useTranslation();
  const { setValue, watch } = useFormContext<CatalogItemFormValues>();
  const [fieldTemplates, setFieldTemplates] = useState<Record<string, string>>({});
  const [cursorPositions, setCursorPositions] = useState<Record<string, number>>({});
  const fieldInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const selectedProvisionWorkflowId = watch('provision_workflow');
  const selectedDynamicFieldRaw = watch('dynamic_name_field') ?? '';
  const configuredDynamicFieldTemplates = watch('dynamic_field_templates') ?? {};
  const configuredDisabledDeployFields = watch('deploy_disabled_fields') ?? [];
  const configuredHiddenDeployFields = watch('deploy_hidden_fields') ?? [];
  const extraVarsSchema = watch('extra_vars_schema');
  const selectedDynamicFields = useMemo(
    () => parseCatalogDynamicFieldNames(selectedDynamicFieldRaw),
    [selectedDynamicFieldRaw]
  );

  const { data: survey } = useGet<Survey>(
    selectedProvisionWorkflowId
      ? awxAPI`/workflow_job_templates/${selectedProvisionWorkflowId.toString()}/survey_spec/`
      : undefined
  );

  const surveyVariables = useMemo(() => {
    const names = new Set<string>();
    for (const variable of survey?.spec?.map((question) => question.variable) ?? []) {
      if (templateVariablePattern.test(variable)) {
        names.add(variable);
      }
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [survey?.spec]);

  const controlledFields = useMemo(() => {
    const names = new Set<string>();

    for (const variable of surveyVariables) {
      names.add(variable);
    }

    for (const variable of selectedDynamicFields) {
      if (templateVariablePattern.test(variable)) {
        names.add(variable);
      }
    }

    for (const variable of Object.keys(configuredDynamicFieldTemplates)) {
      if (templateVariablePattern.test(variable)) {
        names.add(variable);
      }
    }

    for (const variable of configuredDisabledDeployFields) {
      if (typeof variable === 'string' && templateVariablePattern.test(variable)) {
        names.add(variable);
      }
    }

    return [...names].sort((a, b) => a.localeCompare(b));
  }, [
    configuredDisabledDeployFields,
    configuredDynamicFieldTemplates,
    selectedDynamicFields,
    surveyVariables,
  ]);

  const disabledDeployFieldSet = useMemo(() => {
    const names = new Set<string>();
    for (const field of configuredDisabledDeployFields) {
      if (typeof field === 'string' && templateVariablePattern.test(field)) {
        names.add(field);
      }
    }
    return names;
  }, [configuredDisabledDeployFields]);

  const hiddenDeployFieldSet = useMemo(() => {
    const names = new Set<string>();
    for (const field of configuredHiddenDeployFields) {
      if (typeof field === 'string' && templateVariablePattern.test(field)) {
        names.add(field);
      }
    }
    return names;
  }, [configuredHiddenDeployFields]);

  const availableVariables = useMemo(() => {
    const variableNames = new Set<string>();
    variableNames.add('user_org_name');

    for (const variable of parseSchemaVariableNames(extraVarsSchema)) {
      variableNames.add(variable);
    }

    for (const variable of surveyVariables) {
      variableNames.add(variable);
    }

    // Keep dynamic field suggestions stable even when workflow fields are on a different tab.
    for (const variable of selectedDynamicFields) {
      if (templateVariablePattern.test(variable)) {
        variableNames.add(variable);
      }
    }

    for (const variable of Object.keys(configuredDynamicFieldTemplates)) {
      if (templateVariablePattern.test(variable)) {
        variableNames.add(variable);
      }
    }

    for (const variable of configuredDisabledDeployFields) {
      if (typeof variable === 'string' && templateVariablePattern.test(variable)) {
        variableNames.add(variable);
      }
    }

    return [...variableNames].sort((a, b) => a.localeCompare(b));
  }, [
    configuredDisabledDeployFields,
    configuredDynamicFieldTemplates,
    extraVarsSchema,
    selectedDynamicFields,
    surveyVariables,
  ]);

  useEffect(() => {
    const nextDynamicFields = controlledFields;
    if (nextDynamicFields.join(',') !== selectedDynamicFields.join(',')) {
      setValue('dynamic_name_field', nextDynamicFields.join(','), {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
  }, [controlledFields, selectedDynamicFields, setValue]);

  useEffect(() => {
    setFieldTemplates((prev) => {
      const next = { ...prev };
      let changed = false;

      for (const [field, template] of Object.entries(configuredDynamicFieldTemplates)) {
        if (!templateVariablePattern.test(field)) {
          continue;
        }
        if (typeof template !== 'string') {
          continue;
        }
        if (next[field] !== template) {
          next[field] = template;
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [configuredDynamicFieldTemplates]);

  useEffect(() => {
    setFieldTemplates((prev) => {
      const next = { ...prev };
      for (const field of controlledFields) {
        if (!(field in next)) {
          next[field] = `{${field}}`;
        }
      }
      return next;
    });
  }, [controlledFields]);

  useEffect(() => {
    const nextTemplates: Record<string, string> = {};
    for (const field of controlledFields) {
      nextTemplates[field] = fieldTemplates[field] ?? '';
    }

    const currentTemplates: Record<string, string> = {};
    for (const field of controlledFields) {
      currentTemplates[field] = configuredDynamicFieldTemplates[field] ?? '';
    }

    if (JSON.stringify(nextTemplates) !== JSON.stringify(currentTemplates)) {
      setValue('dynamic_field_templates', nextTemplates, {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
  }, [configuredDynamicFieldTemplates, controlledFields, fieldTemplates, setValue]);

  useEffect(() => {
    const normalizedDisabledFields = controlledFields.filter((field) =>
      disabledDeployFieldSet.has(field)
    );
    if (
      JSON.stringify(normalizedDisabledFields) !== JSON.stringify(configuredDisabledDeployFields)
    ) {
      setValue('deploy_disabled_fields', normalizedDisabledFields, {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
  }, [configuredDisabledDeployFields, controlledFields, disabledDeployFieldSet, setValue]);

  useEffect(() => {
    const normalizedHiddenFields = controlledFields.filter((field) =>
      hiddenDeployFieldSet.has(field)
    );
    if (JSON.stringify(normalizedHiddenFields) !== JSON.stringify(configuredHiddenDeployFields)) {
      setValue('deploy_hidden_fields', normalizedHiddenFields, {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
  }, [configuredHiddenDeployFields, controlledFields, hiddenDeployFieldSet, setValue]);

  return (
    <PageFormGroup
      fieldId="catalog_dynamic_field_selector"
      label={t('Dynamic deploy field')}
      labelHelpTitle={t('Dynamic deploy field')}
      labelHelp={t(
        'Survey fields are loaded automatically. Configure each field value and deploy-form locking below.'
      )}
      helperText={t(
        'All survey fields are listed automatically. Type { to browse variables for each field value. These values are independent from Name template. Use Disable or Hide per field for deploy form behavior.'
      )}
    >
      {controlledFields.length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {controlledFields.map((field) => {
            const fieldTemplate = fieldTemplates[field] ?? '';
            const cursorPosition = cursorPositions[field] ?? fieldTemplate.length;
            const tokenContext = getTemplateTokenContext(fieldTemplate, cursorPosition);
            const typedFragment = tokenContext?.typedFragment?.toLowerCase() ?? '';
            const filteredVariables = tokenContext
              ? availableVariables.filter((variable) =>
                  variable.toLowerCase().startsWith(typedFragment)
                )
              : [];

            const insertVariable = (variable: string) => {
              const insertedToken = `{${variable}}`;
              let updatedTemplate = fieldTemplate;
              let nextCursorPosition = fieldTemplate.length + insertedToken.length;

              if (tokenContext) {
                const beforeToken = fieldTemplate.slice(0, tokenContext.openBraceIndex);
                const afterToken = fieldTemplate.slice(tokenContext.cursorPosition);
                updatedTemplate = `${beforeToken}${insertedToken}${afterToken}`;
                nextCursorPosition = beforeToken.length + insertedToken.length;
              } else {
                const needsSpacer = fieldTemplate.length > 0 && !fieldTemplate.endsWith(' ');
                updatedTemplate = `${fieldTemplate}${needsSpacer ? ' ' : ''}${insertedToken}`;
                nextCursorPosition = updatedTemplate.length;
              }

              setFieldTemplates((prev) => ({
                ...prev,
                [field]: updatedTemplate,
              }));

              setCursorPositions((prev) => ({
                ...prev,
                [field]: nextCursorPosition,
              }));

              window.requestAnimationFrame(() => {
                const input = fieldInputRefs.current[field];
                input?.focus();
                input?.setSelectionRange(nextCursorPosition, nextCursorPosition);
              });
            };

            return (
              <DynamicFieldRow key={field}>
                <div style={{ minWidth: 160, fontWeight: 600, fontSize: '0.875rem' }}>{field}</div>
                <div style={{ flex: 1, position: 'relative' }}>
                  <TextInput
                    id={`dynamic_field_${field}`}
                    ref={(element) => {
                      fieldInputRefs.current[field] = element;
                    }}
                    value={fieldTemplate}
                    onChange={(_event, nextValue) => {
                      setFieldTemplates((prev) => ({
                        ...prev,
                        [field]: nextValue,
                      }));
                      setCursorPositions((prev) => ({
                        ...prev,
                        [field]: nextValue.length,
                      }));
                    }}
                    onClick={(event) => {
                      const nextCursorPosition =
                        event.currentTarget.selectionStart ?? fieldTemplate.length;
                      setCursorPositions((prev) => ({
                        ...prev,
                        [field]: nextCursorPosition,
                      }));
                    }}
                    onKeyUp={(event) => {
                      const nextCursorPosition =
                        event.currentTarget.selectionStart ?? fieldTemplate.length;
                      setCursorPositions((prev) => ({
                        ...prev,
                        [field]: nextCursorPosition,
                      }));
                    }}
                    onSelect={(event) => {
                      const nextCursorPosition =
                        event.currentTarget.selectionStart ?? fieldTemplate.length;
                      setCursorPositions((prev) => ({
                        ...prev,
                        [field]: nextCursorPosition,
                      }));
                    }}
                    placeholder={t('Enter template, for example {vm_name}-{env}')}
                    autoComplete="off"
                  />
                  {filteredVariables.length > 0 && tokenContext && (
                    <SuggestionDropdown>
                      {filteredVariables.map((variable) => (
                        <SuggestionItem
                          key={`${field}-${variable}`}
                          variant="plain"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            insertVariable(variable);
                          }}
                        >
                          {`{${variable}}`}
                        </SuggestionItem>
                      ))}
                    </SuggestionDropdown>
                  )}
                </div>
                <Checkbox
                  id={`disable_deploy_field_${field}`}
                  label={t('Disable')}
                  isChecked={disabledDeployFieldSet.has(field)}
                  onChange={(_event, isChecked) => {
                    const nextDisabledSet = new Set(disabledDeployFieldSet);
                    if (isChecked) {
                      nextDisabledSet.add(field);
                    } else {
                      nextDisabledSet.delete(field);
                    }
                    const nextDisabledFields = controlledFields.filter((name) =>
                      nextDisabledSet.has(name)
                    );
                    setValue('deploy_disabled_fields', nextDisabledFields, {
                      shouldDirty: true,
                      shouldValidate: true,
                    });
                  }}
                />
                <Checkbox
                  id={`hide_deploy_field_${field}`}
                  label={t('Hide')}
                  isChecked={hiddenDeployFieldSet.has(field)}
                  onChange={(_event, isChecked) => {
                    const nextHiddenSet = new Set(hiddenDeployFieldSet);
                    if (isChecked) {
                      nextHiddenSet.add(field);
                    } else {
                      nextHiddenSet.delete(field);
                    }
                    const nextHiddenFields = controlledFields.filter((name) =>
                      nextHiddenSet.has(name)
                    );
                    setValue('deploy_hidden_fields', nextHiddenFields, {
                      shouldDirty: true,
                      shouldValidate: true,
                    });
                  }}
                />
              </DynamicFieldRow>
            );
          })}
        </div>
      )}

      {controlledFields.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: '0.85rem' }}>
            {t('Current dynamic fields: {{fields}}', {
              fields: controlledFields.join(', '),
            })}
          </span>
        </div>
      )}

      {surveyVariables.length === 0 && (
        <div style={{ fontSize: '0.85rem', opacity: 0.8 }}>
          {t('Select a provision workflow with survey fields to configure dynamic field controls.')}
        </div>
      )}
    </PageFormGroup>
  );
}

// ─── Per-Provider Form Fields Tab ─────────────────────────────────────────────

const PROVIDER_SOURCE_OPTIONS: Record<string, Array<{ value: string; label: string }>> = {
  proxmox: [
    { value: 'templates.name', label: 'Templates → name' },
    { value: 'nodes.node', label: 'Nodes → node name' },
    { value: 'storage.storage', label: 'Storage → pool name' },
  ],
  vmware: [
    { value: 'clusters.name', label: 'Clusters → name' },
    { value: 'hosts.name', label: 'Hosts → name' },
    { value: 'datastores.name', label: 'Datastores → name' },
    { value: 'networks.name', label: 'Networks → name' },
    { value: 'datacenters.name', label: 'Datacenters → name' },
  ],
  azure: [
    { value: 'locations.name', label: 'Locations → name' },
    { value: 'locations.display_name', label: 'Locations → display name' },
    { value: 'resource_groups.name', label: 'Resource Groups → name' },
    { value: 'vnets.name', label: 'VNets → name' },
    { value: 'vm_images.urn', label: 'VM Images → URN (Terraform ref)' },
    { value: 'vm_images.name', label: 'VM Images → name' },
    { value: 'vm_sizes.name', label: 'VM Sizes → name' },
  ],
  digitalocean: [
    { value: 'regions.slug', label: 'Regions → slug' },
    { value: 'regions.name', label: 'Regions → name' },
    { value: 'droplet_sizes.slug', label: 'Droplet Sizes → slug' },
    { value: 'droplet_images.name', label: 'Images → name' },
    { value: 'vpcs.id', label: 'VPCs → ID' },
    { value: 'vpcs.name', label: 'VPCs → name' },
  ],
};

function ProviderFormFieldsTab({ provider }: { provider: string }) {
  const { t } = useTranslation();
  const { setValue, watch } = useFormContext<CatalogItemFormValues>();
  const providerConfigs = watch('provider_configs');
  const wjtId = providerConfigs.find((c) => c.provider === provider)?.wjt_id ?? null;
  const [cursorPositions, setCursorPositions] = useState<Record<string, number>>({});
  const fieldInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const providerFieldConfigs = watch('provider_field_configs');
  const cfg = providerFieldConfigs[provider] ?? {
    disabled_fields: [],
    hidden_fields: [],
    field_templates: {},
    dynamic_field_sources: {},
  };

  // Use saved templates as the source of truth; derive local state lazily
  const [fieldTemplates, setFieldTemplates] = useState<Record<string, string>>(
    () => cfg.field_templates ?? {}
  );

  const { data: survey } = useGet<Survey>(
    wjtId ? awxAPI`/workflow_job_templates/${wjtId.toString()}/survey_spec/` : undefined
  );

  const surveyVariables = useMemo(() => {
    const names = new Set<string>();
    for (const question of survey?.spec ?? []) {
      if (templateVariablePattern.test(question.variable)) names.add(question.variable);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [survey?.spec]);

  // Once survey loads, fill in defaults for any variable not yet in local state
  useEffect(() => {
    if (surveyVariables.length === 0) return;
    setFieldTemplates((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const v of surveyVariables) {
        if (!(v in next)) {
          next[v] = cfg.field_templates?.[v] ?? `{${v}}`;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surveyVariables]);

  // --- Inventory & group targeting via WJT's TFT node ---
  const { data: wjtNodesData } = useGet<{
    count: number;
    results: Array<{
      id: number;
      unified_job_template: number | null;
      summary_fields: { unified_job_template?: { unified_job_type: string } };
    }>;
  }>(wjtId ? awxAPI`/workflow_job_templates/${String(wjtId)}/workflow_nodes/` : undefined);

  const tftNodeId = useMemo(
    () =>
      wjtNodesData?.results?.find(
        (n) => n.summary_fields?.unified_job_template?.unified_job_type === 'terraform_job'
      )?.unified_job_template ?? null,
    [wjtNodesData]
  );

  const { data: tftData } = useGet<{ id: number; target_inventory: number | null; target_group: string }>(
    tftNodeId ? awxAPI`/terraform_job_templates/${String(tftNodeId)}/` : undefined
  );

  const { data: invListData } = useGet<{ count: number; results: Array<{ id: number; name: string }> }>(
    awxAPI`/inventories/`,
    { page_size: '200' }
  );
  const inventoryList = invListData?.results ?? [];

  const selectedInventoryId = cfg.target_inventory ?? null;
  const { data: groupListData } = useGet<{ count: number; results: Array<{ id: number; name: string }> }>(
    selectedInventoryId ? awxAPI`/inventories/${String(selectedInventoryId)}/groups/` : undefined,
    selectedInventoryId ? { page_size: '200' } : undefined
  );
  const groupList = groupListData?.results ?? [];

  const tftInitRef = useRef<string | null>(null);
  useEffect(() => {
    const key = tftNodeId ? String(tftNodeId) : null;
    if (!tftData || !key || tftInitRef.current === key) return;
    tftInitRef.current = key;
    const current = providerFieldConfigs[provider] ?? {};
    if (!('target_inventory' in current) && !('target_group' in current)) {
      const next = { ...providerFieldConfigs };
      const defaults = { disabled_fields: [] as string[], hidden_fields: [] as string[], field_templates: {} as Record<string, string>, dynamic_field_sources: {} as Record<string, string> };
      next[provider] = { ...defaults, ...current, target_inventory: tftData.target_inventory ?? null, target_group: tftData.target_group ?? '' };
      setValue('provider_field_configs', next, { shouldDirty: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tftData, tftNodeId]);

  const disabledSet = useMemo(() => new Set(cfg.disabled_fields), [cfg.disabled_fields]);
  const hiddenSet = useMemo(() => new Set(cfg.hidden_fields), [cfg.hidden_fields]);

  const saveConfig = (updates: Partial<typeof cfg>) => {
    const next = { ...providerFieldConfigs };
    next[provider] = { ...cfg, ...updates };
    setValue('provider_field_configs', next, { shouldDirty: true });
  };

  const handleInventoryGroupChange = async (
    field: 'target_inventory' | 'target_group',
    value: number | null | string
  ) => {
    saveConfig({ [field]: value });
    if (tftNodeId) {
      await requestPatch(awxAPI`/terraform_job_templates/${String(tftNodeId)}/`, {
        [field]: value,
      });
    }
  };

  const insertVariable = (variable: string, field: string) => {
    const currentTemplate = fieldTemplates[field] ?? '';
    const cursor = cursorPositions[field] ?? currentTemplate.length;
    const tokenCtx = getTemplateTokenContext(currentTemplate, cursor);
    const token = `{${variable}}`;
    let updated: string;
    let nextCursor: number;
    if (tokenCtx) {
      const before = currentTemplate.slice(0, tokenCtx.openBraceIndex);
      const after = currentTemplate.slice(tokenCtx.cursorPosition);
      updated = `${before}${token}${after}`;
      nextCursor = before.length + token.length;
    } else {
      const needsSpacer = currentTemplate.length > 0 && !currentTemplate.endsWith(' ');
      updated = `${currentTemplate}${needsSpacer ? ' ' : ''}${token}`;
      nextCursor = updated.length;
    }
    const next = { ...fieldTemplates, [field]: updated };
    setFieldTemplates(next);
    setCursorPositions((prev) => ({ ...prev, [field]: nextCursor }));
    saveConfig({ field_templates: next });
    window.requestAnimationFrame(() => {
      const input = fieldInputRefs.current[field];
      input?.focus();
      input?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  if (!wjtId) {
    return (
      <div style={{ marginTop: 16, fontSize: '0.875rem', color: 'var(--pf-v5-global--Color--200)' }}>
        {t('No workflow job template linked for {{provider}}. Assign one in the Cloud providers tab to configure field overrides.', { provider: PROVIDER_LABELS[provider] ?? provider })}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 16 }}>
      {tftNodeId && (
        <div
          style={{
            marginBottom: 16,
            padding: '12px 16px',
            background: '#1b1d21',
            border: '1px solid var(--pf-v5-global--BorderColor--100)',
            borderRadius: 6,
          }}
        >
          <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: 10 }}>
            {t('Provisioning target')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>
            <div>
              <label
                htmlFor={`pft_inv_${provider}`}
                style={{
                  color: 'var(--pf-v5-global--Color--200)',
                  display: 'block',
                  marginBottom: 4,
                  fontSize: '0.8rem',
                }}
              >
                {t('Target inventory')}
              </label>
              <FormSelect
                id={`pft_inv_${provider}`}
                value={String(cfg.target_inventory ?? '')}
                onChange={(_e, val) => void handleInventoryGroupChange('target_inventory', val ? Number(val) : null)}
                aria-label={t('Target inventory')}
              >
                <FormSelectOption value="" label={t('— not configured —')} />
                {inventoryList.map((inv) => (
                  <FormSelectOption key={inv.id} value={String(inv.id)} label={inv.name} />
                ))}
              </FormSelect>
            </div>
            <div>
              <label
                htmlFor={`pft_grp_${provider}`}
                style={{
                  color: 'var(--pf-v5-global--Color--200)',
                  display: 'block',
                  marginBottom: 4,
                  fontSize: '0.8rem',
                }}
              >
                {t('Target group')}
              </label>
              <FormSelect
                id={`pft_grp_${provider}`}
                value={cfg.target_group ?? ''}
                onChange={(_e, val) => void handleInventoryGroupChange('target_group', val)}
                aria-label={t('Target group')}
                isDisabled={!selectedInventoryId}
              >
                <FormSelectOption value="" label={selectedInventoryId ? t('— select a group —') : t('— select an inventory first —')} />
                {groupList.map((grp) => (
                  <FormSelectOption key={grp.id} value={grp.name} label={grp.name} />
                ))}
              </FormSelect>
            </div>
          </div>
        </div>
      )}
      {surveyVariables.length === 0 && survey && (
        <div style={{ fontSize: '0.875rem', color: 'var(--pf-v5-global--Color--200)' }}>
          {t('The linked workflow has no survey fields to configure.')}
        </div>
      )}
      {surveyVariables.length > 0 && (
        <p style={{ fontSize: '0.875rem', color: 'var(--pf-v5-global--Color--200)', marginBottom: 12 }}>
          {t(
            'Configure each survey field for {{provider}} deployments. Set a default value template, or mark the field as disabled or hidden in the deploy form.',
            { provider: PROVIDER_LABELS[provider] ?? provider }
          )}
        </p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {surveyVariables.map((variable) => {
          const tmpl = fieldTemplates[variable] ?? '';
          const cursor = cursorPositions[variable] ?? tmpl.length;
          const tokenCtx = getTemplateTokenContext(tmpl, cursor);
          const fragment = tokenCtx?.typedFragment?.toLowerCase() ?? '';
          const suggestions = tokenCtx
            ? surveyVariables.filter((v) => v !== variable && v.toLowerCase().startsWith(fragment))
            : [];

          return (
            <DynamicFieldRow key={variable}>
              <div style={{ minWidth: 160, fontWeight: 600, fontSize: '0.875rem' }}>{variable}</div>
              <div style={{ flex: 1, position: 'relative' }}>
                <TextInput
                  id={`${provider}_tmpl_${variable}`}
                  ref={(el) => { fieldInputRefs.current[variable] = el; }}
                  value={tmpl}
                  placeholder={t('Default value, e.g. {{{variable}}}', { variable })}
                  autoComplete="off"
                  onChange={(_e, val) => {
                    const next = { ...fieldTemplates, [variable]: val };
                    setFieldTemplates(next);
                    setCursorPositions((prev) => ({ ...prev, [variable]: val.length }));
                    saveConfig({ field_templates: next });
                  }}
                  onClick={(e) => { const p = e.currentTarget.selectionStart ?? tmpl.length; setCursorPositions((prev) => ({ ...prev, [variable]: p })); }}
                  onKeyUp={(e) => { const p = e.currentTarget.selectionStart ?? tmpl.length; setCursorPositions((prev) => ({ ...prev, [variable]: p })); }}
                  onSelect={(e) => { const p = e.currentTarget.selectionStart ?? tmpl.length; setCursorPositions((prev) => ({ ...prev, [variable]: p })); }}
                />
                {suggestions.length > 0 && tokenCtx && (
                  <SuggestionDropdown>
                    {suggestions.map((v) => (
                      <SuggestionItem
                        key={`${variable}-${v}`}
                        variant="plain"
                        onMouseDown={(e) => { e.preventDefault(); insertVariable(v, variable); }}
                      >
                        {`{${v}}`}
                      </SuggestionItem>
                    ))}
                  </SuggestionDropdown>
                )}
              </div>
              <Checkbox
                id={`${provider}_disable_${variable}`}
                label={t('Disable')}
                isChecked={disabledSet.has(variable)}
                onChange={(_e, checked) => {
                  const next = new Set(disabledSet);
                  if (checked) next.add(variable); else next.delete(variable);
                  saveConfig({ disabled_fields: [...next] });
                }}
              />
              <Checkbox
                id={`${provider}_hide_${variable}`}
                label={t('Hide')}
                isChecked={hiddenSet.has(variable)}
                onChange={(_e, checked) => {
                  const next = new Set(hiddenSet);
                  if (checked) next.add(variable); else next.delete(variable);
                  saveConfig({ hidden_fields: [...next] });
                }}
              />
              {(PROVIDER_SOURCE_OPTIONS[provider]?.length ?? 0) > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 200 }}>
                  <span style={{ fontSize: '0.8rem', whiteSpace: 'nowrap', color: 'var(--pf-v5-global--Color--200)' }}>
                    {t('Source:')}
                  </span>
                  <FormSelect
                    id={`${provider}_src_${variable}`}
                    value={cfg.dynamic_field_sources?.[variable] ?? ''}
                    onChange={(_e, val) => {
                      const next = { ...(cfg.dynamic_field_sources ?? {}) };
                      if (val) {
                        next[variable] = val;
                      } else {
                        delete next[variable];
                      }
                      saveConfig({ dynamic_field_sources: next });
                    }}
                    style={{ minWidth: 180 }}
                    aria-label={t('Dynamic source for {{variable}}', { variable })}
                  >
                    <FormSelectOption value="" label={t('— none —')} />
                    {PROVIDER_SOURCE_OPTIONS[provider].map((opt) => (
                      <FormSelectOption key={opt.value} value={opt.value} label={opt.label} />
                    ))}
                  </FormSelect>
                </div>
              )}
            </DynamicFieldRow>
          );
        })}
      </div>

      {/* ── VM Size Settings ─────────────────────────────────────────────── */}
      <div
        style={{
          marginTop: 24,
          padding: '16px',
          background: '#1b1d21',
          border: '1px solid var(--pf-v5-global--BorderColor--100)',
          borderRadius: 6,
        }}
      >
        <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: 12 }}>
          {t('VM Size Settings')}
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--pf-v5-global--Color--200)', marginBottom: 14 }}>
          {t('Control how VM size presets are shown in the deploy form and set limits that trigger admin approval.')}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Switch
            id={`${provider}_vms_enabled`}
            label={t('Show VM size selector')}
            labelOff={t('Show VM size selector')}
            isChecked={cfg.vm_size_settings?.enabled !== false}
            onChange={(_e, checked) => saveConfig({ vm_size_settings: { ...defaultVmSizeSettings(cfg), enabled: checked } })}
          />
          <Switch
            id={`${provider}_vms_allow_manual`}
            label={t('Allow users to manually enter CPU / RAM')}
            labelOff={t('Allow users to manually enter CPU / RAM')}
            isChecked={cfg.vm_size_settings?.allow_manual === true}
            onChange={(_e, checked) => saveConfig({ vm_size_settings: { ...defaultVmSizeSettings(cfg), allow_manual: checked } })}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>
            <div>
              <label
                htmlFor={`${provider}_vms_cpu_var`}
                style={{ display: 'block', fontSize: '0.8rem', color: 'var(--pf-v5-global--Color--200)', marginBottom: 4 }}
              >
                {t('CPU survey variable name')}
              </label>
              <TextInput
                id={`${provider}_vms_cpu_var`}
                value={cfg.vm_size_settings?.cpu_variable ?? ''}
                placeholder="num_cpus"
                onChange={(_e, val) => saveConfig({ vm_size_settings: { ...defaultVmSizeSettings(cfg), cpu_variable: val } })}
              />
            </div>
            <div>
              <label
                htmlFor={`${provider}_vms_ram_var`}
                style={{ display: 'block', fontSize: '0.8rem', color: 'var(--pf-v5-global--Color--200)', marginBottom: 4 }}
              >
                {t('RAM survey variable name')}
              </label>
              <TextInput
                id={`${provider}_vms_ram_var`}
                value={cfg.vm_size_settings?.ram_variable ?? ''}
                placeholder="ram_gb"
                onChange={(_e, val) => saveConfig({ vm_size_settings: { ...defaultVmSizeSettings(cfg), ram_variable: val } })}
              />
            </div>
            <div>
              <label
                htmlFor={`${provider}_vms_cpu_limit`}
                style={{ display: 'block', fontSize: '0.8rem', color: 'var(--pf-v5-global--Color--200)', marginBottom: 4 }}
              >
                {t('CPU limit (cores, blank = unlimited)')}
              </label>
              <TextInput
                id={`${provider}_vms_cpu_limit`}
                type="number"
                value={cfg.vm_size_settings?.cpu_limit !== null && cfg.vm_size_settings?.cpu_limit !== undefined ? String(cfg.vm_size_settings.cpu_limit) : ''}
                placeholder={t('e.g. 8')}
                onChange={(_e, val) => saveConfig({ vm_size_settings: { ...defaultVmSizeSettings(cfg), cpu_limit: val === '' ? null : Number(val) } })}
              />
            </div>
            <div>
              <label
                htmlFor={`${provider}_vms_ram_limit`}
                style={{ display: 'block', fontSize: '0.8rem', color: 'var(--pf-v5-global--Color--200)', marginBottom: 4 }}
              >
                {t('RAM limit (GB, blank = unlimited)')}
              </label>
              <TextInput
                id={`${provider}_vms_ram_limit`}
                type="number"
                value={cfg.vm_size_settings?.ram_limit !== null && cfg.vm_size_settings?.ram_limit !== undefined ? String(cfg.vm_size_settings.ram_limit) : ''}
                placeholder={t('e.g. 32')}
                onChange={(_e, val) => saveConfig({ vm_size_settings: { ...defaultVmSizeSettings(cfg), ram_limit: val === '' ? null : Number(val) } })}
              />
            </div>
          </div>
          <Switch
            id={`${provider}_vms_require_approval`}
            label={t('Require admin approval when limits are exceeded')}
            labelOff={t('Require admin approval when limits are exceeded')}
            isChecked={cfg.vm_size_settings?.require_approval === true}
            onChange={(_e, checked) => saveConfig({ vm_size_settings: { ...defaultVmSizeSettings(cfg), require_approval: checked } })}
          />
        </div>
      </div>
    </div>
  );
}

function defaultVmSizeSettings(cfg: {
  vm_size_settings?: {
    enabled: boolean;
    allow_manual: boolean;
    cpu_variable: string;
    ram_variable: string;
    cpu_limit: number | null;
    ram_limit: number | null;
    require_approval: boolean;
  };
}) {
  return {
    enabled: cfg.vm_size_settings?.enabled !== false,
    allow_manual: cfg.vm_size_settings?.allow_manual ?? false,
    cpu_variable: cfg.vm_size_settings?.cpu_variable ?? '',
    ram_variable: cfg.vm_size_settings?.ram_variable ?? '',
    cpu_limit: cfg.vm_size_settings?.cpu_limit ?? null,
    ram_limit: cfg.vm_size_settings?.ram_limit ?? null,
    require_approval: cfg.vm_size_settings?.require_approval ?? false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

function CatalogNameTemplateInput() {
  const { t } = useTranslation();
  const { control, watch } = useFormContext<CatalogItemFormValues>();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [cursorPosition, setCursorPosition] = useState(0);

  const selectedProvisionWorkflowId = watch('provision_workflow');
  const extraVarsSchema = watch('extra_vars_schema');
  const { data: survey } = useGet<Survey>(
    selectedProvisionWorkflowId
      ? awxAPI`/workflow_job_templates/${selectedProvisionWorkflowId.toString()}/survey_spec/`
      : undefined
  );

  const surveyVariables = useMemo(() => {
    const names = new Set<string>();
    for (const variable of survey?.spec?.map((question) => question.variable) ?? []) {
      if (templateVariablePattern.test(variable)) {
        names.add(variable);
      }
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [survey?.spec]);

  const availableVariables = useMemo(() => {
    const variableNames = new Set<string>();
    variableNames.add('user_org_name');

    for (const variable of parseSchemaVariableNames(extraVarsSchema)) {
      variableNames.add(variable);
    }

    for (const variable of surveyVariables) {
      variableNames.add(variable);
    }

    return [...variableNames].sort((a, b) => a.localeCompare(b));
  }, [extraVarsSchema, surveyVariables]);

  return (
    <Controller
      name="name_template"
      control={control}
      shouldUnregister
      render={({ field: { value, onChange }, fieldState: { error } }) => {
        const templateValue = typeof value === 'string' ? value : '';
        const templateVariables = getTemplateVariables(templateValue);
        const tokenContext = getTemplateTokenContext(templateValue, cursorPosition);
        const typedFragment = tokenContext?.typedFragment?.toLowerCase() ?? '';
        const filteredVariables = tokenContext
          ? availableVariables.filter((variable) =>
              variable.toLowerCase().startsWith(typedFragment)
            )
          : [];

        const insertVariable = (variable: string) => {
          const insertedToken = `{${variable}}`;
          let updatedTemplate = templateValue;
          let nextCursorPosition = templateValue.length + insertedToken.length;

          if (tokenContext) {
            const beforeToken = templateValue.slice(0, tokenContext.openBraceIndex);
            const afterToken = templateValue.slice(tokenContext.cursorPosition);
            updatedTemplate = `${beforeToken}${insertedToken}${afterToken}`;
            nextCursorPosition = beforeToken.length + insertedToken.length;
          } else {
            const needsSpacer = templateValue.length > 0 && !templateValue.endsWith(' ');
            updatedTemplate = `${templateValue}${needsSpacer ? ' ' : ''}${insertedToken}`;
            nextCursorPosition = updatedTemplate.length;
          }

          onChange(updatedTemplate);

          window.requestAnimationFrame(() => {
            inputRef.current?.focus();
            inputRef.current?.setSelectionRange(nextCursorPosition, nextCursorPosition);
            setCursorPosition(nextCursorPosition);
          });
        };

        return (
          <PageFormGroup
            fieldId="name_template"
            label={t('Name template')}
            labelHelpTitle={t('Name template')}
            labelHelp={t(
              'Type { to browse available variables. Use +1 at the end of the template to auto-increment deployment names.'
            )}
            helperTextInvalid={error?.message}
            helperText={t(
              'Type { to browse variables used by the name template. Dynamic deploy field is configured below in Dynamic deploy field.'
            )}
          >
            <div style={{ position: 'relative' }}>
              <TextInput
                id="name_template"
                ref={inputRef}
                value={templateValue}
                onChange={(_event, nextValue) => {
                  onChange(nextValue.trimStart());
                  setCursorPosition(nextValue.length);
                }}
                onClick={(event) => {
                  setCursorPosition(event.currentTarget.selectionStart ?? templateValue.length);
                }}
                onKeyUp={(event) => {
                  setCursorPosition(event.currentTarget.selectionStart ?? templateValue.length);
                }}
                onSelect={(event) => {
                  setCursorPosition(event.currentTarget.selectionStart ?? templateValue.length);
                }}
                placeholder={t('Enter deployment name template')}
                validated={error ? 'error' : 'default'}
                autoComplete="off"
              />
              {templateVariables.length > 0 && (
                <div
                  style={{
                    marginTop: 8,
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 8,
                    alignItems: 'center',
                  }}
                >
                  <span style={{ fontSize: '0.85rem' }}>{t('Template variables:')}</span>
                  {templateVariables.map((variable) => (
                    <span
                      key={variable}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '2px 6px',
                        border: '1px solid var(--pf-v5-global--BorderColor--100)',
                        borderRadius: 12,
                        fontSize: '0.8rem',
                      }}
                    >
                      {`{${variable}}`}
                      <Button
                        variant="plain"
                        onClick={() => onChange(removeTemplateVariable(templateValue, variable))}
                        style={{ padding: 0, minHeight: 'auto', lineHeight: 1 }}
                        aria-label={t('Remove {{variable}} from template', { variable })}
                      >
                        x
                      </Button>
                    </span>
                  ))}
                </div>
              )}
              {filteredVariables.length > 0 && tokenContext && (
                <SuggestionDropdown>
                  {filteredVariables.map((variable) => (
                    <SuggestionItem
                      key={variable}
                      variant="plain"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        insertVariable(variable);
                      }}
                    >
                      {`{${variable}}`}
                    </SuggestionItem>
                  ))}
                </SuggestionDropdown>
              )}
            </div>
          </PageFormGroup>
        );
      }}
    />
  );
}

function CatalogItemImageUpload() {
  const { t } = useTranslation();
  const { control } = useFormContext<CatalogItemFormValues>();
  const { field } = useController({ name: 'icon_data', control });

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => field.onChange(reader.result as string);
    reader.readAsDataURL(file);
  };

  const hasImage = typeof field.value === 'string' && field.value.startsWith('data:image/');

  return (
    <FormGroup label={t('Icon upload')} fieldId="icon_data">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {hasImage && (
          <img
            src={field.value}
            alt={t('Catalog icon preview')}
            style={{
              width: 64,
              height: 64,
              objectFit: 'contain',
              border: '1px solid var(--pf-v5-global--BorderColor--100)',
              borderRadius: 4,
              backgroundColor: '#222428',
              padding: 4,
            }}
          />
        )}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <StyledUploadButton htmlFor="icon_data_input">{t('Choose file')}</StyledUploadButton>
          <input
            id="icon_data_input"
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            style={{ display: 'none' }}
            onChange={onFileChange}
          />
          {hasImage && (
            <Button
              variant="danger"
              onClick={() => field.onChange('')}
              style={{ width: 'fit-content' }}
            >
              {t('Remove icon')}
            </Button>
          )}
        </div>
      </div>
    </FormGroup>
  );
}
