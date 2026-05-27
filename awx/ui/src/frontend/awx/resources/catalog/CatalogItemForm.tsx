import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { Button, Checkbox, FormGroup, TextInput } from '@patternfly/react-core';
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
import { PageFormWorkflowJobTemplateSelect } from '../templates/components/PageFormWorkflowJobTemplateSelect';
import { PageFormTerraformJobTemplateSelect } from '../templates/components/PageFormTerraformJobTemplateSelect';
import { Survey } from '../../interfaces/Survey';
import { PageFormGroup } from '../../../../framework/PageForm/Inputs/PageFormGroup';
import { Controller, useController, useFormContext } from 'react-hook-form';
import { parseCatalogDynamicFieldNames } from './catalogNaming';

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
  };
}

export function CreateCatalogItem() {
  const { t } = useTranslation();
  const pageNavigate = usePageNavigate();

  const onSubmit: PageFormSubmitHandler<CatalogItemFormValues> = async (values) => {
    let extra_vars_schema: Record<string, unknown> | null = null;
    if (values.extra_vars_schema.trim()) {
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
    if (values.extra_vars_schema.trim()) {
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
              <PageFormWorkflowJobTemplateSelect<CatalogItemFormValues> name="provision_workflow" />
              <PageFormTerraformJobTemplateSelect<CatalogItemFormValues> name="terraform_job_template" />
              <PageFormWorkflowJobTemplateSelect<CatalogItemFormValues>
                name="deprovision_workflow"
                workflowJobTemplatePath="deprovision_workflow"
              />
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
            </div>
          </div>
        </PageTab>
        <PageTab label={t('Form fields')}>
          <div style={{ marginTop: 16 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: 16,
                alignItems: 'start',
              }}
            >
              <PageFormTextArea<CatalogItemFormValues>
                name="extra_vars_schema"
                label={t('Extra variables schema')}
                labelHelpTitle={t('Extra variables schema')}
                labelHelp={t(
                  'Optional JSON Schema definition for additional deploy-time fields. Workflow survey questions are pulled live from the provision workflow and merged at launch.'
                )}
                placeholder={extraVarsSchemaPlaceholder}
              />
              <CatalogDynamicFieldSelector />
            </div>
          </div>
        </PageTab>
      </PageTabs>
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
