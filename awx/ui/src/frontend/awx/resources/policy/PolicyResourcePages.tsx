import {
  Alert,
  Button,
  ButtonVariant,
  ClipboardCopy,
  CodeBlock,
  CodeBlockCode,
  FormSelect,
  FormSelectOption,
  Label,
  LabelGroup,
  Modal,
  ModalVariant,
  PageSection,
  Stack,
  StackItem,
  Tab,
  Tabs,
  TabTitleText,
  ToolbarItem,
} from '@patternfly/react-core';
import {
  CaretLeftIcon,
  CheckCircleIcon,
  DownloadIcon,
  MagicIcon,
  PencilAltIcon,
  PlusCircleIcon,
  SyncAltIcon,
  TimesCircleIcon,
  TrashIcon,
} from '@patternfly/react-icons';
import { DropdownPosition } from '@patternfly/react-core/deprecated';
import { Dispatch, SetStateAction, useEffect, useMemo, useRef, useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import styled from 'styled-components';
import {
  DateTimeCell,
  IFilterState,
  IPageAction,
  ITableColumn,
  IToolbarFilter,
  LoadingPage,
  PageActionSelection,
  PageActionType,
  PageActions,
  PageDetail,
  PageDetails,
  PageFormSubmitHandler,
  PageFormSelect,
  PageFormTextArea,
  PageFormTextInput,
  PageHeader,
  PageLayout,
  PageTable,
  ToolbarFilterType,
  useGetPageUrl,
  useInMemoryView,
} from '../../../../framework';
import { PageDetailCodeEditor } from '../../../../framework/PageDetails/PageDetailCodeEditor';
import { PageFormSection } from '../../../../framework/PageForm/Utils/PageFormSection';
import { AwxError } from '../../common/AwxError';
import { AwxPageForm } from '../../common/AwxPageForm';
import { awxAPI } from '../../common/api/awx-utils';
import { postRequest, requestDelete } from '../../../common/crud/Data';
import { useGet } from '../../../common/crud/useGet';
import { Project } from '../../interfaces/Project';
import { AwxRoute } from '../../main/AwxRoutes';
import { PageFormProjectSelect } from '../projects/components/PageFormProjectSelect';

interface OPAPolicyModuleSummary {
  id: string;
  package: string;
  rules: string[];
  decision_paths: string[];
  size: number;
  line_count: number;
  sha256: string;
  awx_managed: boolean;
  search_text?: string;
  source?: string;
}

interface OPAPolicyModulesResponse {
  enabled: boolean;
  server_url: string;
  count: number;
  modules: OPAPolicyModuleSummary[];
}

interface OPAPolicyModuleDetail extends OPAPolicyModuleSummary {
  raw: string;
  ast?: unknown;
  project_source?: OPAProjectSource | null;
}

interface OPAPolicyModuleFormValues {
  project: Project | null;
  rego_file: string;
  policy_id: string;
  policy_text: string;
}

interface OPAProjectSource {
  project_id: number;
  project_name: string;
  scm_type?: string;
  scm_url?: string;
  scm_branch?: string;
  scm_revision?: string;
  path?: string;
  file_path?: string;
}

interface OPAProjectFile {
  file_path: string;
  policy_id: string;
  policy_text: string;
  module: OPAPolicyModuleSummary;
}

interface OPAProjectFilesResponse {
  count: number;
  project: {
    id: number;
    name: string;
  };
  project_source: OPAProjectSource;
  results: OPAProjectFile[];
}

interface OPAPolicyModuleProjectApplyResponse {
  changed: boolean;
  persisted: boolean;
  results: {
    policy_id: string;
    file_path: string;
    changed: boolean;
    persisted: boolean;
    after: OPAPolicyModuleSummary;
  }[];
}

interface OPAPolicyModuleDeleteResponse {
  changed: boolean;
  policy_id: string;
}

interface OPAPolicyModuleVersion {
  activity_stream_id: number;
  operation: string;
  timestamp: string;
  actor?: { id: number; username: string } | null;
  before?: OPAPolicyModuleSummary | null;
  after?: OPAPolicyModuleSummary | null;
  can_restore_before: boolean;
  can_restore_after: boolean;
}

interface OPAPolicyModuleVersionsResponse {
  policy_id: string;
  count: number;
  versions: OPAPolicyModuleVersion[];
}

type OPAPolicyModuleVersionSide = 'before' | 'after';
type OPAPolicyModuleDetailTab = 'details' | 'versions' | 'decisions' | 'violations';

interface OPAPolicyModuleRollbackResponse {
  changed: boolean;
  policy_id: string;
  version: OPAPolicyModuleVersionSide;
  source_activity_stream_id: number;
  module: OPAPolicyModuleDetail;
  previous_sha256: string;
  restored_sha256: string;
}

interface OPAActivityEntry {
  activity_stream_id: number;
  operation: string;
  timestamp: string;
  actor?: { id: number; username: string } | null;
  object1: string;
  object2: string;
  source: string;
  summary: string;
  policy_id: string;
  opa_allowed?: boolean | null;
  is_denial: boolean;
  project_source?: { file_path?: string } | null;
  error?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  result?: string;
  search_text?: string;
}

interface OPAActivityResponse {
  count: number;
  denial_count: number;
  decisions: OPAActivityEntry[];
  denials: OPAActivityEntry[];
}

interface GatekeeperContextOption {
  name: string;
  selected: boolean;
  configured: boolean;
  server_url: string;
  verify_ssl: boolean;
  source: string;
}

interface GatekeeperConstraintTemplate {
  name: string;
  kind: string;
  api_version: string;
  created: boolean;
  observed_generation?: number;
  by_pod: unknown[];
  constraint_count: number;
  errors: unknown[];
  schema: unknown;
  targets: { target: string; rego: string; libs: unknown[] }[];
  constraints: { kind: string; name: string }[];
  search_text?: string;
}

interface GatekeeperConstraint {
  kind: string;
  name: string;
  api_version: string;
  resource?: string;
  version?: string;
  enforcement_action: string;
  match: Record<string, unknown>;
  parameters: Record<string, unknown>;
  total_violations: number;
  audit_timestamp: string;
  by_pod: unknown[];
  violations: unknown[];
  search_text?: string;
}

interface GatekeeperViolation {
  constraint_kind: string;
  constraint_name: string;
  enforcement_action: string;
  message: string;
  resource_kind: string;
  resource_namespace: string;
  resource_name: string;
  resource_api_version: string;
  resource_group: string;
  resource_version: string;
}

interface GatekeeperTarget {
  api_version: string;
  kind: string;
  name: string;
  namespace?: string;
  resource?: string;
  object_path?: string;
}

interface GatekeeperAuditRef {
  activity_stream_id?: number;
  activity_stream_url?: string;
}

interface GatekeeperRemediationPlan {
  summary: string;
  rationale: string;
  risk: string;
  target: GatekeeperTarget;
  patch_type: string;
  patch?: Record<string, unknown> | null;
  manual_steps: string[];
  can_apply: boolean;
}

interface GatekeeperRemediationResponse {
  changed: boolean;
  persisted: boolean;
  dry_run: boolean;
  mode: string;
  operation: string;
  target: GatekeeperTarget;
  plan: GatekeeperRemediationPlan;
  before_exists: boolean;
  before_sha256: string;
  after_sha256: string;
  diff: string;
  rollback_plan: unknown;
  opa_allowed?: boolean | null;
  kubernetes_response?: unknown;
  audit?: GatekeeperAuditRef | null;
  provider?: string;
  model?: string;
}

interface GatekeeperConfig {
  name: string;
  api_version: string;
  sync_only_count: number;
  sync_only: unknown[];
  match: unknown[];
  readiness?: unknown;
  readiness_stats_enabled?: boolean;
  status?: unknown;
  search_text?: string;
}

interface GatekeeperResponse {
  configured: boolean;
  message?: string;
  version?: string;
  contexts: GatekeeperContextOption[];
  cluster: { server_url: string; context: string; verify_ssl: boolean };
  counts: {
    constraint_templates: number;
    constraints: number;
    violations: number;
    filtered_violations: number;
    configs: number;
  };
  violation_query: {
    search: string;
    sort: string;
    limit: number;
    page: number;
    offset: number;
    total_pages: number;
    returned: number;
  };
  constraint_templates: GatekeeperConstraintTemplate[];
  constraints: GatekeeperConstraint[];
  violations: GatekeeperViolation[];
  configs: GatekeeperConfig[];
  errors: { resource: string; status_code?: number; detail: unknown; version?: string }[];
}

export type GatekeeperInventoryKind = 'templates' | 'constraints' | 'violations' | 'configs';

function toError(error: unknown, fallback: string) {
  if (!error) return undefined;
  return error instanceof Error ? error : new Error(fallback);
}

function violationKey(violation: GatekeeperViolation) {
  return [
    violation.constraint_kind,
    violation.constraint_name,
    violation.resource_kind,
    violation.resource_namespace,
    violation.resource_name,
    violation.message,
  ]
    .filter(Boolean)
    .join('/');
}

function detailUrl(path: string, values: Record<string, string>) {
  const params = new URLSearchParams(values);
  return `${path}?${params.toString()}`;
}

function gatekeeperTargetDisplay(target?: GatekeeperTarget) {
  if (!target) return '';
  const namespace = target.namespace ? `${target.namespace}/` : '';
  return `${target.kind}/${namespace}${target.name}`;
}

function SourceLabel(props: { managed: boolean }) {
  const { t } = useTranslation();
  return (
    <Label color={props.managed ? 'green' : 'grey'}>
      {props.managed ? t('Capstan') : t('External')}
    </Label>
  );
}

function EnforcementLabel(props: { action: string }) {
  const action = props.action || 'deny';
  return (
    <Label color={action === 'deny' ? 'red' : action === 'dryrun' ? 'orange' : 'grey'}>
      {action}
    </Label>
  );
}

const PolicyModuleEditor = styled.div`
  textarea {
    font-family: var(--pf-v5-global--FontFamily--monospace);
    min-height: 24rem;
    resize: vertical;
  }
`;

const PolicyModuleVersionControls = styled.div`
  display: grid;
  gap: var(--pf-v5-global--spacer--md);
  grid-template-columns: minmax(16rem, 28rem) auto;
  margin-top: var(--pf-v5-global--spacer--sm);
  width: fit-content;
  max-width: 100%;

  @media (max-width: 62rem) {
    grid-template-columns: minmax(14rem, 1fr);
    width: 100%;
  }
`;

const PolicyModuleVersionSelect = styled.div`
  width: min(100%, 38rem);
`;

function formatPolicyModuleVersion(version: OPAPolicyModuleVersion) {
  const timestamp = version.timestamp ? new Date(version.timestamp).toLocaleString() : '';
  return `#${version.activity_stream_id} - ${version.operation}${timestamp ? ` - ${timestamp}` : ''}`;
}

function validatePolicyId(value: string, requiredMessage: string, invalidMessage: string) {
  const policyId = value.trim().replace(/^\/+|\/+$/g, '');
  if (!policyId) return requiredMessage;
  if (policyId.includes('..') || !/^[A-Za-z0-9_.@/-]+$/.test(policyId)) {
    return invalidMessage;
  }
  return undefined;
}

function OPAPolicyModuleFormFields(props: { editing: boolean }) {
  const { t } = useTranslation();
  const { resetField, setValue } = useFormContext<OPAPolicyModuleFormValues>();
  const project = useWatch<OPAPolicyModuleFormValues, 'project'>({ name: 'project' });
  const regoFile = useWatch<OPAPolicyModuleFormValues, 'rego_file'>({ name: 'rego_file' });
  const projectId = project?.id;
  const previousProjectId = useRef(projectId);
  const projectFilesResponse = useGet<OPAProjectFilesResponse>(
    projectId ? awxAPI`/opa/policy-modules/project-sync/` : undefined,
    { project_id: projectId ?? '' }
  );
  const projectFiles = useMemo(
    () => projectFilesResponse.data?.results ?? [],
    [projectFilesResponse.data?.results]
  );
  const projectFileOptions = useMemo(
    () =>
      projectFiles.map((file) => ({
        value: file.file_path,
        label: file.file_path,
      })),
    [projectFiles]
  );

  useEffect(() => {
    if (previousProjectId.current === projectId) return;
    resetField('rego_file', { defaultValue: '' });
    resetField('policy_text', { defaultValue: '' });
    if (!props.editing) resetField('policy_id', { defaultValue: '' });
    previousProjectId.current = projectId;
  }, [projectId, props.editing, resetField]);

  useEffect(() => {
    const selectedFile = projectFiles.find((file) => file.file_path === regoFile);
    if (!selectedFile) return;
    setValue('policy_text', selectedFile.policy_text, { shouldValidate: true });
    if (!props.editing) {
      setValue('policy_id', selectedFile.policy_id, { shouldValidate: true });
    }
  }, [projectFiles, props.editing, regoFile, setValue]);

  return (
    <PageFormSection title={t('Policy module source')} singleColumn>
      <PageFormProjectSelect<OPAPolicyModuleFormValues> name="project" isRequired />
      <PageFormSelect<OPAPolicyModuleFormValues>
        id="rego_file"
        name="rego_file"
        label={t('Rego file')}
        isRequired
        options={projectFileOptions}
        placeholderText={
          !projectId
            ? t('Select a project first')
            : projectFilesResponse.isLoading
              ? t('Loading Rego files...')
              : t('Select Rego file')
        }
        helperText={t(
          'Rego files are discovered from the selected synced Project. Projects remain the source of truth for policy code.'
        )}
        isDisabled={!projectId || projectFilesResponse.isLoading}
      />
      {projectFilesResponse.error ? (
        <Alert
          variant="danger"
          isInline
          title={t('Could not load Rego files from the selected Project.')}
        />
      ) : null}
      <PageFormTextInput<OPAPolicyModuleFormValues>
        id="opa-policy-id"
        name="policy_id"
        label={t('Policy ID')}
        helperText={t(
          'Unique OPA Policy API path, for example capstan/job_launch. The policy ID cannot be changed after creation.'
        )}
        isRequired
        isReadOnly={props.editing}
        validate={(value) =>
          validatePolicyId(
            value,
            t('Policy ID is required.'),
            t('Policy ID contains invalid characters.')
          )
        }
      />
      <PolicyModuleEditor>
        <PageFormTextArea<OPAPolicyModuleFormValues>
          id="opa-policy-text"
          name="policy_text"
          label={t('Rego preview')}
          helperText={t(
            'This read-only preview is loaded from the selected Project file. Update policy code in the Project, sync the Project, then save this module again.'
          )}
          isRequired
          isReadOnly
          disableAutoResize
        />
      </PolicyModuleEditor>
    </PageFormSection>
  );
}

export function OPAPolicyModuleList(props: { canManagePolicy: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const response = useGet<OPAPolicyModulesResponse>(awxAPI`/opa/policy-modules/`);
  const modules = useMemo(
    () =>
      (response.data?.modules ?? []).map((module) => ({
        ...module,
        source: module.awx_managed ? 'managed' : 'external',
        search_text: [module.id, module.package, ...module.rules, ...module.decision_paths].join(
          ' '
        ),
      })),
    [response.data?.modules]
  );
  const columns = useMemo<ITableColumn<OPAPolicyModuleSummary>[]>(
    () => [
      {
        header: t('Policy ID'),
        type: 'text',
        value: (module) => module.id,
        to: (module) => detailUrl('/policy-as-code/opa/modules/detail', { policy: module.id }),
        sort: 'id',
        defaultSort: true,
      },
      {
        header: t('Package'),
        type: 'text',
        value: (module) => module.package || t('Not detected'),
        sort: 'package',
      },
      {
        header: t('Rules'),
        type: 'count',
        value: (module) => module.rules.length,
        sort: 'rules.length',
      },
      {
        header: t('Decision paths'),
        type: 'count',
        value: (module) => module.decision_paths.length,
        sort: 'decision_paths.length',
      },
      {
        header: t('Source'),
        cell: (module) => <SourceLabel managed={module.awx_managed} />,
        sort: 'source',
      },
    ],
    [t]
  );
  const filters = useMemo<IToolbarFilter[]>(
    () => [
      {
        key: 'search',
        query: 'search_text',
        label: t('Search'),
        type: ToolbarFilterType.MultiText,
        comparison: 'contains',
      },
      {
        key: 'source',
        query: 'source',
        label: t('Source'),
        type: ToolbarFilterType.SingleSelect,
        placeholder: t('All sources'),
        options: [
          { value: 'managed', label: t('Capstan') },
          { value: 'external', label: t('External') },
        ],
      },
    ],
    [t]
  );
  const view = useInMemoryView<OPAPolicyModuleSummary>({
    items: response.isLoading ? undefined : modules,
    tableColumns: columns,
    toolbarFilters: filters,
    keyFn: (module) => module.id,
    error: toError(response.error, t('Could not load live OPA policy modules.')),
  });
  const actions = useMemo<IPageAction<OPAPolicyModuleSummary>[]>(
    () => [
      {
        type: PageActionType.Link,
        selection: PageActionSelection.None,
        variant: ButtonVariant.primary,
        isPinned: true,
        icon: PlusCircleIcon,
        label: t('Create module'),
        href: '/policy-as-code/opa/modules/new',
        isDisabled: props.canManagePolicy
          ? undefined
          : t('You do not have permission to create policy modules.'),
      },
      {
        type: PageActionType.Button,
        selection: PageActionSelection.None,
        variant: ButtonVariant.secondary,
        icon: SyncAltIcon,
        label: t('Refresh'),
        onClick: response.refresh,
      },
    ],
    [props.canManagePolicy, response.refresh, t]
  );
  const rowActions = useMemo<IPageAction<OPAPolicyModuleSummary>[]>(
    () => [
      {
        type: PageActionType.Link,
        selection: PageActionSelection.Single,
        isPinned: true,
        icon: PencilAltIcon,
        label: t('Edit policy module'),
        href: (module) =>
          detailUrl('/policy-as-code/opa/modules/edit', {
            policy: module.id,
          }),
        isHidden: () => !props.canManagePolicy,
      },
    ],
    [props.canManagePolicy, t]
  );

  return (
    <PageTable<OPAPolicyModuleSummary>
      id="opa-policy-modules-table"
      tableColumns={columns}
      toolbarFilters={filters}
      toolbarActions={actions}
      rowActions={rowActions}
      errorStateTitle={t('Error loading policy modules')}
      emptyStateTitle={t('No policy modules yet')}
      emptyStateDescription={t('Create a policy module or sync Rego files from a Capstan Project.')}
      emptyStateButtonIcon={<PlusCircleIcon />}
      emptyStateButtonText={props.canManagePolicy ? t('Create module') : undefined}
      emptyStateButtonClick={
        props.canManagePolicy ? () => navigate('/policy-as-code/opa/modules/new') : undefined
      }
      defaultSubtitle={t('OPA policy module')}
      {...view}
    />
  );
}

export function OPAActivityPage(props: { violationsOnly?: boolean; policyId?: string }) {
  const { t } = useTranslation();
  const response = useGet<OPAActivityResponse>(awxAPI`/opa/activity/?limit=200`);
  const detailPath = props.violationsOnly
    ? '/policy-as-code/opa/violations'
    : '/policy-as-code/opa/decisions';
  const entries = useMemo(() => {
    const activity = props.violationsOnly
      ? response.data?.denials ?? []
      : response.data?.decisions ?? [];
    return activity
      .filter((entry) => !props.policyId || entry.policy_id === props.policyId)
      .map((entry) => ({
        ...entry,
        result: entry.is_denial ? 'denied' : 'allowed',
        search_text: [
          entry.policy_id,
          entry.object1,
          entry.object2,
          entry.source,
          entry.summary,
          entry.error,
          entry.actor?.username,
          entry.project_source?.file_path,
        ]
          .filter(Boolean)
          .join(' '),
      }));
  }, [props.policyId, props.violationsOnly, response.data?.decisions, response.data?.denials]);
  const columns = useMemo<ITableColumn<OPAActivityEntry>[]>(
    () => [
      {
        header: t('Policy'),
        type: 'text',
        value: (entry) => entry.policy_id || entry.object2 || t('OPA decision'),
        to: (entry) => `${detailPath}/${entry.activity_stream_id}`,
        sort: 'policy_id',
        defaultSort: true,
      },
      {
        header: t('Result'),
        cell: (entry) => (
          <Label
            color={entry.is_denial ? 'red' : 'green'}
            icon={entry.is_denial ? <TimesCircleIcon /> : <CheckCircleIcon />}
          >
            {entry.is_denial ? t('Denied') : t('Allowed')}
          </Label>
        ),
        sort: 'result',
      },
      {
        header: t('Source'),
        type: 'text',
        value: (entry) => entry.source || entry.object1 || t('Unknown'),
        sort: 'source',
      },
      {
        header: t('Actor'),
        type: 'text',
        value: (entry) => entry.actor?.username ?? t('System'),
        sort: 'actor.username',
      },
      {
        header: t('Time'),
        type: 'datetime',
        value: (entry) => entry.timestamp,
        sort: 'timestamp',
        defaultSortDirection: 'desc',
      },
      { header: t('Summary'), type: 'description', value: (entry) => entry.error || entry.summary },
    ],
    [detailPath, t]
  );
  const filters = useMemo<IToolbarFilter[]>(
    () => [
      {
        key: 'search',
        query: 'search_text',
        label: t('Search'),
        type: ToolbarFilterType.MultiText,
        comparison: 'contains',
      },
      {
        key: 'result',
        query: 'result',
        label: t('Result'),
        type: ToolbarFilterType.SingleSelect,
        placeholder: t('All results'),
        options: [
          { value: 'allowed', label: t('Allowed') },
          { value: 'denied', label: t('Denied') },
        ],
      },
    ],
    [t]
  );
  const view = useInMemoryView<OPAActivityEntry>({
    items: response.isLoading ? undefined : entries,
    tableColumns: columns,
    toolbarFilters: filters,
    disableQueryString: Boolean(props.policyId),
    keyFn: (entry) => entry.activity_stream_id,
    error: toError(response.error, t('Could not load OPA activity.')),
  });
  return (
    <PageTable<OPAActivityEntry>
      id={props.violationsOnly ? 'opa-violations-table' : 'opa-decisions-table'}
      tableColumns={columns}
      toolbarFilters={filters}
      errorStateTitle={t('Error loading OPA activity')}
      emptyStateTitle={
        props.violationsOnly ? t('No OPA violations found') : t('No OPA decisions found')
      }
      emptyStateDescription={
        props.violationsOnly
          ? props.policyId
            ? t('Denied decisions for this policy module will appear here.')
            : t('Denied policy decisions will appear here.')
          : props.policyId
            ? t('Decisions for this policy module will appear here after protected actions run.')
            : t('Policy decisions will appear here after protected actions are evaluated.')
      }
      defaultSubtitle={t('OPA decision')}
      {...view}
    />
  );
}

export function OPAActivityDetailPage(props: { violationsOnly?: boolean }) {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const response = useGet<OPAActivityEntry>(awxAPI`/opa/activity/${id ?? ''}/`);
  const listPath = props.violationsOnly
    ? '/policy-as-code/opa/violations'
    : '/policy-as-code/opa/decisions';
  const listLabel = props.violationsOnly ? t('OPA Violations') : t('OPA Decisions');

  if (response.error) return <AwxError error={response.error} handleRefresh={response.refresh} />;
  if (response.isLoading || !response.data) return <LoadingPage breadcrumbs />;

  const entry = response.data;
  const title = entry.policy_id || entry.object2 || t('OPA decision');
  const sourceFile = entry.project_source?.file_path;
  const snapshots = entry.before || entry.after;

  return (
    <PageLayout>
      <PageHeader
        title={title}
        breadcrumbs={[{ label: listLabel, to: listPath }, { label: title }]}
      />
      <PageDetails>
        <PageDetail label={t('Result')}>
          <Label
            color={entry.is_denial ? 'red' : 'green'}
            icon={entry.is_denial ? <TimesCircleIcon /> : <CheckCircleIcon />}
          >
            {entry.is_denial ? t('Denied') : t('Allowed')}
          </Label>
        </PageDetail>
        <PageDetail label={t('Operation')}>{entry.operation || t('Not reported')}</PageDetail>
        <PageDetail label={t('Source')}>
          {entry.source || entry.object1 || t('Not reported')}
        </PageDetail>
        <PageDetail label={t('Actor')}>{entry.actor?.username ?? t('System')}</PageDetail>
        <PageDetail label={t('Time')}>
          {entry.timestamp ? <DateTimeCell value={entry.timestamp} /> : t('Not reported')}
        </PageDetail>
        <PageDetail label={t('Audit record')}>#{entry.activity_stream_id}</PageDetail>
        <PageDetail label={t('Primary object')}>{entry.object1 || t('Not reported')}</PageDetail>
        <PageDetail label={t('Secondary object')}>{entry.object2 || t('Not reported')}</PageDetail>
        <PageDetail label={t('Project file')}>{sourceFile || t('Not project-backed')}</PageDetail>
        <PageDetail label={t('Summary')} fullWidth>
          {entry.error || entry.summary || t('No summary was recorded.')}
        </PageDetail>
      </PageDetails>
      {snapshots ? (
        <PageSection>
          <CodeBlock>
            <CodeBlockCode>
              {JSON.stringify({ before: entry.before, after: entry.after }, null, 2)}
            </CodeBlockCode>
          </CodeBlock>
        </PageSection>
      ) : null}
    </PageLayout>
  );
}

function GatekeeperContextToolbar(props: {
  contexts: GatekeeperContextOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <ToolbarItem>
      <FormSelect
        aria-label={t('Gatekeeper context')}
        value={props.value}
        onChange={(_event, value) => props.onChange(String(value))}
      >
        {props.contexts.map((context) => (
          <FormSelectOption key={context.name} value={context.name} label={context.name} />
        ))}
      </FormSelect>
    </ToolbarItem>
  );
}

function gatekeeperActions<T extends object>(
  refresh: () => unknown,
  download: () => unknown,
  t: ReturnType<typeof useTranslation>['t']
): IPageAction<T>[] {
  return [
    {
      type: PageActionType.Button,
      selection: PageActionSelection.None,
      variant: ButtonVariant.secondary,
      icon: SyncAltIcon,
      label: t('Refresh'),
      onClick: refresh,
    },
    {
      type: PageActionType.Button,
      selection: PageActionSelection.None,
      variant: ButtonVariant.secondary,
      icon: DownloadIcon,
      label: t('Download report'),
      onClick: download,
    },
  ];
}

function downloadGatekeeperReport(data?: GatekeeperResponse) {
  if (!data) return;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'gatekeeper-policy-report.json';
  anchor.click();
  URL.revokeObjectURL(url);
}

function GatekeeperTemplateTable(props: {
  response: ReturnType<typeof useGet<GatekeeperResponse>>;
  context: string;
  toolbar: JSX.Element;
}) {
  const { t } = useTranslation();
  const items = useMemo(
    () =>
      (props.response.data?.constraint_templates ?? []).map((item) => ({
        ...item,
        search_text: [item.name, item.kind, item.api_version].join(' '),
      })),
    [props.response.data?.constraint_templates]
  );
  const columns = useMemo<ITableColumn<GatekeeperConstraintTemplate>[]>(
    () => [
      {
        header: t('Name'),
        type: 'text',
        value: (item) => item.name,
        to: (item) =>
          detailUrl('/policy-as-code/gatekeeper/templates/detail', {
            name: item.name,
            context: props.context,
          }),
        sort: 'name',
        defaultSort: true,
      },
      { header: t('Kind'), type: 'text', value: (item) => item.kind || t('Unknown'), sort: 'kind' },
      {
        header: t('Constraints'),
        type: 'count',
        value: (item) => item.constraint_count,
        sort: 'constraint_count',
      },
      {
        header: t('Targets'),
        type: 'count',
        value: (item) => item.targets.length,
        sort: 'targets.length',
      },
      {
        header: t('API version'),
        type: 'text',
        value: (item) => item.api_version,
        sort: 'api_version',
      },
    ],
    [props.context, t]
  );
  const filters = useMemo<IToolbarFilter[]>(
    () => [
      {
        key: 'search',
        query: 'search_text',
        label: t('Search'),
        type: ToolbarFilterType.MultiText,
        comparison: 'contains',
      },
    ],
    [t]
  );
  const view = useInMemoryView({
    items: props.response.isLoading ? undefined : items,
    tableColumns: columns,
    toolbarFilters: filters,
    keyFn: (item) => item.name,
    error: toError(props.response.error, t('Could not load Gatekeeper ConstraintTemplates.')),
  });
  return (
    <PageTable
      id="gatekeeper-constraint-templates-table"
      tableColumns={columns}
      toolbarFilters={filters}
      toolbarContent={props.toolbar}
      toolbarActions={gatekeeperActions(
        props.response.refresh,
        () => downloadGatekeeperReport(props.response.data),
        t
      )}
      errorStateTitle={t('Error loading ConstraintTemplates')}
      emptyStateTitle={t('No ConstraintTemplates found')}
      emptyStateDescription={t(
        'Sync or apply a ConstraintTemplate to make it available in this context.'
      )}
      defaultSubtitle={t('Gatekeeper ConstraintTemplate')}
      {...view}
    />
  );
}

function GatekeeperConstraintTable(props: {
  response: ReturnType<typeof useGet<GatekeeperResponse>>;
  context: string;
  toolbar: JSX.Element;
}) {
  const { t } = useTranslation();
  const items = useMemo(
    () =>
      (props.response.data?.constraints ?? []).map((item) => ({
        ...item,
        search_text: [item.name, item.kind, item.enforcement_action].join(' '),
      })),
    [props.response.data?.constraints]
  );
  const columns = useMemo<ITableColumn<GatekeeperConstraint>[]>(
    () => [
      {
        header: t('Name'),
        type: 'text',
        value: (item) => item.name,
        to: (item) =>
          detailUrl('/policy-as-code/gatekeeper/constraints/detail', {
            kind: item.kind,
            name: item.name,
            context: props.context,
          }),
        sort: 'name',
        defaultSort: true,
      },
      { header: t('Kind'), type: 'text', value: (item) => item.kind, sort: 'kind' },
      {
        header: t('Enforcement'),
        cell: (item) => <EnforcementLabel action={item.enforcement_action} />,
        sort: 'enforcement_action',
      },
      {
        header: t('Violations'),
        type: 'count',
        value: (item) => item.total_violations,
        sort: 'total_violations',
      },
      {
        header: t('Last audit'),
        type: 'datetime',
        value: (item) => item.audit_timestamp,
        sort: 'audit_timestamp',
        defaultSortDirection: 'desc',
      },
    ],
    [props.context, t]
  );
  const filters = useMemo<IToolbarFilter[]>(
    () => [
      {
        key: 'search',
        query: 'search_text',
        label: t('Search'),
        type: ToolbarFilterType.MultiText,
        comparison: 'contains',
      },
      {
        key: 'enforcement',
        query: 'enforcement_action',
        label: t('Enforcement'),
        type: ToolbarFilterType.SingleSelect,
        placeholder: t('All modes'),
        options: [
          { value: 'deny', label: t('deny') },
          { value: 'dryrun', label: t('dryrun') },
          { value: 'warn', label: t('warn') },
        ],
      },
    ],
    [t]
  );
  const view = useInMemoryView({
    items: props.response.isLoading ? undefined : items,
    tableColumns: columns,
    toolbarFilters: filters,
    keyFn: (item) => `${item.kind}/${item.name}`,
    error: toError(props.response.error, t('Could not load Gatekeeper constraints.')),
  });
  return (
    <PageTable
      id="gatekeeper-constraints-table"
      tableColumns={columns}
      toolbarFilters={filters}
      toolbarContent={props.toolbar}
      toolbarActions={gatekeeperActions(
        props.response.refresh,
        () => downloadGatekeeperReport(props.response.data),
        t
      )}
      errorStateTitle={t('Error loading constraints')}
      emptyStateTitle={t('No constraints found')}
      emptyStateDescription={t('Sync or apply a constraint to enforce a Gatekeeper policy.')}
      defaultSubtitle={t('Gatekeeper constraint')}
      {...view}
    />
  );
}

function GatekeeperConfigTable(props: {
  response: ReturnType<typeof useGet<GatekeeperResponse>>;
  context: string;
  toolbar: JSX.Element;
}) {
  const { t } = useTranslation();
  const items = useMemo(
    () =>
      (props.response.data?.configs ?? []).map((item) => ({
        ...item,
        search_text: [item.name, item.api_version].join(' '),
      })),
    [props.response.data?.configs]
  );
  const columns = useMemo<ITableColumn<GatekeeperConfig>[]>(
    () => [
      {
        header: t('Name'),
        type: 'text',
        value: (item) => item.name,
        to: (item) =>
          detailUrl('/policy-as-code/gatekeeper/configurations/detail', {
            name: item.name,
            context: props.context,
          }),
        sort: 'name',
        defaultSort: true,
      },
      {
        header: t('Synced kinds'),
        type: 'count',
        value: (item) => item.sync_only_count,
        sort: 'sync_only_count',
      },
      {
        header: t('Readiness stats'),
        cell: (item) => (
          <Label color={item.readiness_stats_enabled ? 'green' : 'grey'}>
            {item.readiness_stats_enabled ? t('Enabled') : t('Disabled')}
          </Label>
        ),
        sort: 'readiness_stats_enabled',
      },
      {
        header: t('API version'),
        type: 'text',
        value: (item) => item.api_version,
        sort: 'api_version',
      },
    ],
    [props.context, t]
  );
  const filters = useMemo<IToolbarFilter[]>(
    () => [
      {
        key: 'search',
        query: 'search_text',
        label: t('Search'),
        type: ToolbarFilterType.MultiText,
        comparison: 'contains',
      },
    ],
    [t]
  );
  const view = useInMemoryView({
    items: props.response.isLoading ? undefined : items,
    tableColumns: columns,
    toolbarFilters: filters,
    keyFn: (item) => item.name,
    error: toError(props.response.error, t('Could not load Gatekeeper configurations.')),
  });
  return (
    <PageTable
      id="gatekeeper-configurations-table"
      tableColumns={columns}
      toolbarFilters={filters}
      toolbarContent={props.toolbar}
      toolbarActions={gatekeeperActions(
        props.response.refresh,
        () => downloadGatekeeperReport(props.response.data),
        t
      )}
      errorStateTitle={t('Error loading configurations')}
      emptyStateTitle={t('No Gatekeeper configurations found')}
      emptyStateDescription={t(
        'Gatekeeper configuration resources for this context will appear here.'
      )}
      defaultSubtitle={t('Gatekeeper configuration')}
      {...view}
    />
  );
}

function GatekeeperViolationTable(props: {
  response: ReturnType<typeof useGet<GatekeeperResponse>>;
  context: string;
  toolbar: JSX.Element;
  filterState: IFilterState;
  setFilterState: Dispatch<SetStateAction<IFilterState>>;
  sort: string;
  setSort: (sort: string) => void;
  page: number;
  setPage: (page: number) => void;
  perPage: number;
  setPerPage: (perPage: number) => void;
}) {
  const { t } = useTranslation();
  const columns = useMemo<ITableColumn<GatekeeperViolation>[]>(
    () => [
      {
        header: t('Resource'),
        type: 'text',
        value: (item) =>
          item.resource_namespace
            ? `${item.resource_namespace}/${item.resource_name}`
            : item.resource_name || t('Unknown resource'),
        to: (item) =>
          detailUrl('/policy-as-code/gatekeeper/violations/detail', {
            key: violationKey(item),
            resource: item.resource_name,
            constraint_kind: item.constraint_kind,
            constraint_name: item.constraint_name,
            context: props.context,
          }),
        sort: 'resource',
        defaultSort: true,
      },
      { header: t('Kind'), type: 'text', value: (item) => item.resource_kind, sort: 'resource' },
      {
        header: t('Constraint'),
        type: 'text',
        value: (item) => `${item.constraint_kind}/${item.constraint_name}`,
        sort: 'constraint',
      },
      {
        header: t('Enforcement'),
        cell: (item) => <EnforcementLabel action={item.enforcement_action} />,
        sort: 'enforcement',
      },
      { header: t('Message'), type: 'description', value: (item) => item.message },
    ],
    [props.context, t]
  );
  const filters = useMemo<IToolbarFilter[]>(
    () => [
      {
        key: 'search',
        query: 'violation_search',
        label: t('Search'),
        type: ToolbarFilterType.SingleText,
        comparison: 'contains',
      },
    ],
    [t]
  );
  return (
    <PageTable
      id="gatekeeper-violations-table"
      keyFn={violationKey}
      itemCount={props.response.data?.counts.filtered_violations}
      pageItems={props.response.isLoading ? undefined : props.response.data?.violations ?? []}
      tableColumns={columns}
      toolbarFilters={filters}
      filterState={props.filterState}
      setFilterState={props.setFilterState}
      toolbarContent={props.toolbar}
      toolbarActions={gatekeeperActions(
        props.response.refresh,
        () => downloadGatekeeperReport(props.response.data),
        t
      )}
      page={props.page}
      perPage={props.perPage}
      setPage={props.setPage}
      setPerPage={props.setPerPage}
      perPageOptions={[25, 50, 100, 200].map((value) => ({ title: String(value), value }))}
      sort={props.sort}
      setSort={props.setSort}
      sortDirection="asc"
      error={toError(props.response.error, t('Could not load Gatekeeper violations.'))}
      errorStateTitle={t('Error loading violations')}
      emptyStateTitle={t('No violations found')}
      emptyStateDescription={t('Resources rejected or reported by Gatekeeper will appear here.')}
      defaultSubtitle={t('Gatekeeper violation')}
    />
  );
}

export function GatekeeperResourceList(props: { kind: GatekeeperInventoryKind }) {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [context, setContext] = useState(() => searchParams.get('context') || '');
  const [filterState, setFilterState] = useState<IFilterState>(() => {
    const search = searchParams.get('violation_search');
    return search ? { search: [search] } : {};
  });
  const [sort, setSort] = useState(() => searchParams.get('violation_sort') || 'constraint');
  const [page, setPage] = useState(() => Number(searchParams.get('violation_page') || '1') || 1);
  const [perPage, setPerPage] = useState(
    () => Number(searchParams.get('violation_limit') || '50') || 50
  );
  const search = filterState.search?.[0] || '';
  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (context) params.set('context', context);
    if (search) params.set('violation_search', search);
    params.set('violation_sort', sort);
    params.set('violation_page', String(page));
    params.set('violation_limit', String(perPage));
    return `${awxAPI`/opa/gatekeeper/`}?${params.toString()}`;
  }, [context, page, perPage, search, sort]);
  const response = useGet<GatekeeperResponse>(url);
  useEffect(() => {
    if (context || !response.data?.contexts.length) return;
    const active =
      response.data.contexts.find((item) => item.selected) || response.data.contexts[0];
    if (active?.name) setContext(active.name);
  }, [context, response.data?.contexts]);
  useEffect(() => {
    const params = new URLSearchParams();
    if (context) params.set('context', context);
    if (props.kind === 'violations') {
      if (search) params.set('violation_search', search);
      params.set('violation_sort', sort);
      params.set('violation_page', String(page));
      params.set('violation_limit', String(perPage));
    }
    setSearchParams(params, { replace: true });
  }, [context, page, perPage, props.kind, search, setSearchParams, sort]);
  const toolbar = (
    <GatekeeperContextToolbar
      contexts={response.data?.contexts ?? []}
      value={context}
      onChange={(value) => {
        setContext(value);
        setPage(1);
      }}
    />
  );
  if (response.data && !response.data.configured) {
    return (
      <PageSection>
        <Alert
          isInline
          variant="warning"
          title={response.data.message || t('Gatekeeper Kubernetes API is not configured.')}
        >
          <Link to="/settings/gatekeeper/edit">{t('Configure Gatekeeper settings')}</Link>
        </Alert>
      </PageSection>
    );
  }
  if (props.kind === 'templates')
    return <GatekeeperTemplateTable response={response} context={context} toolbar={toolbar} />;
  if (props.kind === 'constraints')
    return <GatekeeperConstraintTable response={response} context={context} toolbar={toolbar} />;
  if (props.kind === 'configs')
    return <GatekeeperConfigTable response={response} context={context} toolbar={toolbar} />;
  return (
    <GatekeeperViolationTable
      response={response}
      context={context}
      toolbar={toolbar}
      filterState={filterState}
      setFilterState={(next) => {
        setFilterState(next);
        setPage(1);
      }}
      sort={sort}
      setSort={(value) => {
        setSort(value);
        setPage(1);
      }}
      page={page}
      setPage={setPage}
      perPage={perPage}
      setPerPage={(value) => {
        setPerPage(value);
        setPage(1);
      }}
    />
  );
}

export function OPAPolicyModulePage(props: {
  mode: 'create' | 'edit' | 'detail';
  canManagePolicy: boolean;
}) {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const getPageUrl = useGetPageUrl();
  const policyId = props.mode === 'create' ? undefined : searchParams.get('policy') || undefined;
  const moduleResponse = useGet<OPAPolicyModuleDetail>(
    props.mode !== 'create' && policyId ? awxAPI`/opa/policy-modules/${policyId}/` : undefined
  );
  const versionsResponse = useGet<OPAPolicyModuleVersionsResponse>(
    props.mode === 'detail' && policyId
      ? awxAPI`/opa/policy-modules/${policyId}/versions/`
      : undefined
  );
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [selectedVersionSide, setSelectedVersionSide] =
    useState<OPAPolicyModuleVersionSide>('before');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [mutationError, setMutationError] = useState<string>();
  const [mutationResult, setMutationResult] = useState<string>();
  const versions = useMemo(
    () => versionsResponse.data?.versions ?? [],
    [versionsResponse.data?.versions]
  );
  const selectedVersion = useMemo(
    () => versions.find((version) => String(version.activity_stream_id) === selectedVersionId),
    [selectedVersionId, versions]
  );
  const selectedVersionCanRestore =
    selectedVersionSide === 'before'
      ? Boolean(selectedVersion?.can_restore_before)
      : Boolean(selectedVersion?.can_restore_after);
  const requestedTab = searchParams.get('tab');
  const activeTab: OPAPolicyModuleDetailTab =
    requestedTab === 'versions' || requestedTab === 'decisions' || requestedTab === 'violations'
      ? requestedTab
      : 'details';
  const detailHref = policyId
    ? detailUrl('/policy-as-code/opa/modules/detail', { policy: policyId })
    : '/policy-as-code/opa/modules';
  const title =
    props.mode === 'create'
      ? t('Create OPA policy module')
      : props.mode === 'edit'
        ? t('Edit {{policyId}}', { policyId: policyId ?? t('OPA policy module') })
        : policyId || t('OPA policy module');

  useEffect(() => {
    if (props.mode !== 'detail' || !versions.length || selectedVersionId) return;
    const restorable = versions.find(
      (version) => version.can_restore_before || version.can_restore_after
    );
    const nextVersion = restorable ?? versions[0];
    setSelectedVersionId(String(nextVersion.activity_stream_id));
    setSelectedVersionSide(nextVersion.can_restore_before ? 'before' : 'after');
  }, [props.mode, selectedVersionId, versions]);

  const detailActions = useMemo<IPageAction<OPAPolicyModuleDetail>[]>(
    () => [
      {
        type: PageActionType.Link,
        selection: PageActionSelection.Single,
        isPinned: true,
        icon: PencilAltIcon,
        label: t('Edit policy module'),
        href: () =>
          detailUrl('/policy-as-code/opa/modules/edit', {
            policy: policyId ?? '',
          }),
        isHidden: () => !props.canManagePolicy,
      },
      { type: PageActionType.Seperator },
      {
        type: PageActionType.Button,
        selection: PageActionSelection.Single,
        icon: TrashIcon,
        label: t('Delete policy module'),
        isDanger: true,
        onClick: () => setShowDeleteConfirm(true),
        isHidden: () => !props.canManagePolicy,
      },
    ],
    [policyId, props.canManagePolicy, t]
  );

  if (props.mode !== 'create' && !policyId) {
    return <AwxError error={new Error(t('Policy module ID is required.'))} />;
  }
  if (props.mode !== 'create' && moduleResponse.error) {
    return (
      <AwxError
        error={toError(moduleResponse.error, t('Could not load the OPA policy module.'))!}
        handleRefresh={moduleResponse.refresh}
      />
    );
  }
  if (props.mode !== 'create' && (moduleResponse.isLoading || !moduleResponse.data)) {
    return <LoadingPage breadcrumbs />;
  }

  const onSubmit: PageFormSubmitHandler<OPAPolicyModuleFormValues> = async (values) => {
    const normalizedPolicyId = values.policy_id.trim().replace(/^\/+|\/+$/g, '');
    const response = await postRequest<
      OPAPolicyModuleProjectApplyResponse,
      { project: number; path: string; policy_id: string; mode: 'apply' }
    >(awxAPI`/opa/policy-modules/project-sync/`, {
      project: values.project!.id,
      path: values.rego_file,
      policy_id: normalizedPolicyId,
      mode: 'apply',
    });
    const savedModule = response.results[0];
    if (!savedModule) {
      throw new Error(t('The selected Project file did not produce a policy module.'));
    }
    navigate(
      detailUrl('/policy-as-code/opa/modules/detail', {
        policy: savedModule.policy_id,
      }),
      { replace: true }
    );
  };

  const deleteModule = async () => {
    if (!policyId) return;
    setIsDeleting(true);
    setMutationError(undefined);
    try {
      await requestDelete<OPAPolicyModuleDeleteResponse>(
        awxAPI`/opa/policy-modules/${policyId}/`,
        new AbortController().signal
      );
      navigate('/policy-as-code/opa/modules', { replace: true });
    } catch (error) {
      setMutationError(
        error instanceof Error ? error.message : t('Could not delete the OPA policy module.')
      );
      setShowDeleteConfirm(false);
    } finally {
      setIsDeleting(false);
    }
  };

  const rollbackModule = async () => {
    if (!policyId || !selectedVersion || !selectedVersionCanRestore) return;
    setIsRollingBack(true);
    setMutationError(undefined);
    setMutationResult(undefined);
    try {
      const response = await postRequest<
        OPAPolicyModuleRollbackResponse,
        { activity_stream_id: number; version: OPAPolicyModuleVersionSide }
      >(awxAPI`/opa/policy-modules/${policyId}/rollback/`, {
        activity_stream_id: selectedVersion.activity_stream_id,
        version: selectedVersionSide,
      });
      setMutationResult(
        t('Policy module restored from Activity Stream #{{id}}.', {
          id: response.source_activity_stream_id,
        })
      );
      moduleResponse.refresh();
      versionsResponse.refresh();
    } catch (error) {
      setMutationError(
        error instanceof Error ? error.message : t('Could not roll back the OPA policy module.')
      );
    } finally {
      setIsRollingBack(false);
    }
  };

  if (props.mode === 'create' || props.mode === 'edit') {
    const defaultValue: OPAPolicyModuleFormValues =
      props.mode === 'edit' && moduleResponse.data
        ? {
            project: moduleResponse.data.project_source
              ? ({
                  id: moduleResponse.data.project_source.project_id,
                  name: moduleResponse.data.project_source.project_name,
                } as Project)
              : null,
            rego_file: moduleResponse.data.project_source?.file_path ?? '',
            policy_id: moduleResponse.data.id,
            policy_text: moduleResponse.data.raw,
          }
        : {
            project: null,
            rego_file: '',
            policy_id: '',
            policy_text: '',
          };
    return (
      <PageLayout>
        <PageHeader
          title={title}
          breadcrumbs={[
            { label: t('Policy Modules'), to: '/policy-as-code/opa/modules' },
            { label: title },
          ]}
        />
        <AwxPageForm<OPAPolicyModuleFormValues>
          submitText={props.mode === 'create' ? t('Create policy module') : t('Save policy module')}
          onSubmit={onSubmit}
          onCancel={() =>
            props.mode === 'edit' ? navigate(detailHref) : navigate('/policy-as-code/opa/modules')
          }
          defaultValue={defaultValue}
        >
          <OPAPolicyModuleFormFields editing={props.mode === 'edit'} />
        </AwxPageForm>
      </PageLayout>
    );
  }

  const module = moduleResponse.data!;
  return (
    <PageLayout>
      <PageHeader
        title={title}
        breadcrumbs={[
          { label: t('Policy Modules'), to: '/policy-as-code/opa/modules' },
          { label: policyId || t('Details') },
        ]}
        headerActions={
          <PageActions<OPAPolicyModuleDetail>
            actions={detailActions}
            position={DropdownPosition.right}
            selectedItem={module}
          />
        }
      />
      <Tabs
        activeKey={activeTab}
        onSelect={(event, key) => {
          event.preventDefault();
          if (key === 'back') {
            navigate('/policy-as-code/opa/modules');
            return;
          }
          const nextTab = String(key) as OPAPolicyModuleDetailTab;
          const modulePath = `/policy-as-code/opa/modules/detail?policy=${encodeURIComponent(
            module.id
          )}`;
          navigate(nextTab === 'details' ? modulePath : `${modulePath}&tab=${nextTab}`, {
            replace: true,
          });
        }}
        inset={{ default: 'insetSm' }}
        isBox
        style={{
          backgroundColor: 'var(--pf-v5-c-tabs__link--BackgroundColor)',
          flexShrink: 0,
        }}
      >
        <Tab
          eventKey="back"
          title={
            <TabTitleText>
              <CaretLeftIcon />
              <span style={{ marginLeft: 6 }}>{t('Back to Policy Modules')}</span>
            </TabTitleText>
          }
        />
        <Tab eventKey="details" title={<TabTitleText>{t('Details')}</TabTitleText>} />
        <Tab eventKey="versions" title={<TabTitleText>{t('Version History')}</TabTitleText>} />
        <Tab eventKey="decisions" title={<TabTitleText>{t('Decisions')}</TabTitleText>} />
        <Tab eventKey="violations" title={<TabTitleText>{t('Violations')}</TabTitleText>} />
      </Tabs>
      {mutationError ? (
        <PageSection padding={{ default: 'padding' }}>
          <Alert variant="danger" isInline title={mutationError} />
        </PageSection>
      ) : null}
      {mutationResult ? (
        <PageSection padding={{ default: 'padding' }}>
          <Alert variant="success" isInline title={mutationResult} />
        </PageSection>
      ) : null}
      {activeTab === 'details' ? (
        <PageDetails>
          <PageDetail label={t('Policy ID')}>{module.id}</PageDetail>
          <PageDetail label={t('Package')}>{module.package || t('Not detected')}</PageDetail>
          <PageDetail label={t('Source')}>
            <SourceLabel managed={module.awx_managed} />
          </PageDetail>
          <PageDetail label={t('Rules')}>
            {module.rules.length ? module.rules.join(', ') : t('Not detected')}
          </PageDetail>
          <PageDetail label={t('Decision paths')}>
            {module.decision_paths.length ? module.decision_paths.join(', ') : t('Not detected')}
          </PageDetail>
          <PageDetail label={t('Module size')}>
            {t('{{bytes}} bytes', { bytes: module.size })}
          </PageDetail>
          <PageDetail label={t('Lines')}>{module.line_count}</PageDetail>
          <PageDetail label={t('Checksum')}>
            <ClipboardCopy isReadOnly hoverTip={t('Copy')} clickTip={t('Copied')}>
              {module.sha256}
            </ClipboardCopy>
          </PageDetail>
          <PageDetailCodeEditor
            label={t('Rego module')}
            value={module.raw}
            toggleLanguage={false}
          />
        </PageDetails>
      ) : null}
      {activeTab === 'versions' ? (
        <PageDetails>
          <PageDetail label={t('Policy ID')}>{module.id}</PageDetail>
          <PageDetail label={t('Audited versions')}>
            {versionsResponse.data?.count ?? versions.length}
          </PageDetail>
          <PageDetail label={t('Current checksum')}>
            <ClipboardCopy isReadOnly hoverTip={t('Copy')} clickTip={t('Copied')}>
              {module.sha256}
            </ClipboardCopy>
          </PageDetail>
          <PageDetail label={t('Version history')} fullWidth>
            {versionsResponse.isLoading ? (
              t('Loading audited versions...')
            ) : versionsResponse.error ? (
              <Alert variant="danger" isInline title={t('Could not load version history.')} />
            ) : versions.length ? (
              <PolicyModuleVersionSelect>
                <FormSelect
                  id="opa-module-version"
                  value={selectedVersionId}
                  aria-label={t('Version history')}
                  onChange={(_event, value) => {
                    const nextId = String(value);
                    const nextVersion = versions.find(
                      (version) => String(version.activity_stream_id) === nextId
                    );
                    setSelectedVersionId(nextId);
                    setSelectedVersionSide(nextVersion?.can_restore_before ? 'before' : 'after');
                  }}
                  isDisabled={isRollingBack}
                >
                  {versions.map((version) => (
                    <FormSelectOption
                      key={version.activity_stream_id}
                      value={String(version.activity_stream_id)}
                      label={formatPolicyModuleVersion(version)}
                    />
                  ))}
                </FormSelect>
              </PolicyModuleVersionSelect>
            ) : (
              t('No audited versions found.')
            )}
          </PageDetail>
          {selectedVersion ? (
            <>
              <PageDetail label={t('Changed by')}>
                {selectedVersion.actor?.username ?? t('System')}
              </PageDetail>
              <PageDetail label={t('Activity Stream')}>
                <Link
                  to={getPageUrl(AwxRoute.ActivityStream, {
                    query: { id: selectedVersion.activity_stream_id },
                  })}
                >
                  {t('View Activity Stream #{{id}}', {
                    id: selectedVersion.activity_stream_id,
                  })}
                </Link>
              </PageDetail>
              <PageDetail label={t('Changed')}>
                {selectedVersion.timestamp ? (
                  <DateTimeCell value={selectedVersion.timestamp} />
                ) : (
                  t('Not recorded')
                )}
              </PageDetail>
              <PageDetail label={t('Before checksum')}>
                {selectedVersion.before?.sha256 || t('None')}
              </PageDetail>
              <PageDetail label={t('After checksum')}>
                {selectedVersion.after?.sha256 || t('None')}
              </PageDetail>
              <PageDetail label={t('Restore snapshot')} fullWidth>
                <PolicyModuleVersionControls>
                  <FormSelect
                    id="opa-module-restore"
                    value={selectedVersionSide}
                    aria-label={t('Restore snapshot')}
                    onChange={(_event, value) =>
                      setSelectedVersionSide(String(value) as OPAPolicyModuleVersionSide)
                    }
                    isDisabled={isRollingBack}
                  >
                    <FormSelectOption
                      value="before"
                      label={t('Before change')}
                      isDisabled={!selectedVersion.can_restore_before}
                    />
                    <FormSelectOption
                      value="after"
                      label={t('After change')}
                      isDisabled={!selectedVersion.can_restore_after}
                    />
                  </FormSelect>
                  <Button
                    variant="secondary"
                    onClick={() => void rollbackModule()}
                    isLoading={isRollingBack}
                    isDisabled={isRollingBack || !selectedVersionCanRestore}
                  >
                    {t('Rollback version')}
                  </Button>
                </PolicyModuleVersionControls>
              </PageDetail>
            </>
          ) : null}
        </PageDetails>
      ) : null}
      {activeTab === 'decisions' ? <OPAActivityPage policyId={module.id} /> : null}
      {activeTab === 'violations' ? <OPAActivityPage policyId={module.id} violationsOnly /> : null}
      <Modal
        titleIconVariant="danger"
        title={t('Delete policy module')}
        variant={ModalVariant.small}
        description={t('This removes the policy module from the configured OPA server.')}
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        actions={[
          <Button
            key="delete"
            variant="danger"
            onClick={() => void deleteModule()}
            isLoading={isDeleting}
            data-cy="opa-module-delete-confirm"
          >
            {t('Delete')}
          </Button>,
          <Button
            key="cancel"
            variant="link"
            onClick={() => setShowDeleteConfirm(false)}
            isDisabled={isDeleting}
          >
            {t('Cancel')}
          </Button>,
        ]}
      >
        {t('Delete {{policyId}}?', { policyId: module.id })}
      </Modal>
    </PageLayout>
  );
}

function GatekeeperViolationRemediation(props: {
  violation: GatekeeperViolation;
  context: string;
  canManagePolicy: boolean;
  onApplied: () => unknown;
}) {
  const { t } = useTranslation();
  const [result, setResult] = useState<GatekeeperRemediationResponse>();
  const [error, setError] = useState<string>();
  const [isLoading, setIsLoading] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);

  const remediate = async (mode: 'preview' | 'dry_run' | 'apply') => {
    if (mode !== 'preview' && !result?.plan) {
      setError(t('Generate an AI remediation plan before dry-run or apply.'));
      return;
    }
    setIsLoading(true);
    setError(undefined);
    try {
      const response = await postRequest<
        GatekeeperRemediationResponse,
        {
          mode: string;
          violation: GatekeeperViolation;
          remediation_plan?: GatekeeperRemediationPlan;
          human_approved: boolean;
          context_name: string;
        }
      >(awxAPI`/opa/gatekeeper/remediate/`, {
        mode,
        violation: props.violation,
        remediation_plan: mode === 'preview' ? undefined : result?.plan,
        human_approved: mode === 'apply',
        context_name: props.context,
      });
      setResult(response);
      if (response.persisted) await props.onApplied();
    } catch (remediationError) {
      setError(
        remediationError instanceof Error
          ? remediationError.message
          : t(
              'Gatekeeper remediation failed. Check AI settings, connection, and policy guardrails.'
            )
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <PageSection>
      <Stack hasGutter>
        <StackItem>
          <strong>{t('AI remediation')}</strong>
        </StackItem>
        <StackItem>
          {t(
            'Generate a governed metadata patch for this resource, validate it against the Kubernetes API, and apply it after approval.'
          )}
        </StackItem>
        <StackItem>
          <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
            <Button
              variant="secondary"
              icon={<MagicIcon />}
              onClick={() => void remediate('preview')}
              isLoading={isLoading}
              isDisabled={isLoading}
              data-cy="gatekeeper-remediation-suggest-button"
            >
              {t('Suggest remediation')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void remediate('dry_run')}
              isLoading={isLoading}
              isDisabled={isLoading || !result?.plan.can_apply}
              data-cy="gatekeeper-remediation-dry-run-button"
            >
              {t('Dry-run remediation')}
            </Button>
            {props.canManagePolicy ? (
              <Button
                variant="danger"
                onClick={() => setConfirmApply(true)}
                isDisabled={isLoading || !result?.plan.can_apply}
                data-cy="gatekeeper-remediation-apply-button"
              >
                {t('Apply remediation')}
              </Button>
            ) : null}
          </span>
        </StackItem>
        {error ? (
          <StackItem>
            <Alert isInline variant="danger" title={error} />
          </StackItem>
        ) : null}
        {result ? (
          <>
            <StackItem>
              <Alert
                isInline
                variant={
                  result.persisted || result.dry_run
                    ? 'success'
                    : result.plan.can_apply
                      ? 'info'
                      : 'warning'
                }
                title={result.plan.summary}
              >
                {result.plan.rationale}
              </Alert>
            </StackItem>
            <StackItem>
              <PageDetails>
                <PageDetail label={t('Target')}>
                  {gatekeeperTargetDisplay(result.target)}
                </PageDetail>
                <PageDetail label={t('Risk')}>{result.plan.risk}</PageDetail>
                <PageDetail label={t('Mode')}>{result.mode}</PageDetail>
                <PageDetail label={t('Automatic patch')}>
                  {result.plan.can_apply ? t('Available') : t('Not available')}
                </PageDetail>
                <PageDetail label={t('Policy decision')}>
                  {result.opa_allowed === false ? t('Denied') : t('Allowed')}
                </PageDetail>
                <PageDetail label={t('Audit')}>
                  {result.audit?.activity_stream_id ? (
                    <Link
                      to={`/administration/activity-stream?id=${result.audit.activity_stream_id}`}
                    >
                      {t('Activity Stream #{{id}}', {
                        id: result.audit.activity_stream_id,
                      })}
                    </Link>
                  ) : (
                    t('Not recorded')
                  )}
                </PageDetail>
              </PageDetails>
            </StackItem>
            {result.plan.manual_steps.length ? (
              <StackItem>
                <CodeBlock>
                  <CodeBlockCode>{result.plan.manual_steps.join('\n')}</CodeBlockCode>
                </CodeBlock>
              </StackItem>
            ) : null}
            {result.plan.patch ? (
              <StackItem>
                <CodeBlock>
                  <CodeBlockCode>
                    {JSON.stringify(
                      {
                        patch_type: result.plan.patch_type,
                        patch: result.plan.patch,
                        diff: result.diff,
                      },
                      null,
                      2
                    )}
                  </CodeBlockCode>
                </CodeBlock>
              </StackItem>
            ) : null}
          </>
        ) : null}
      </Stack>
      {confirmApply ? (
        <Modal
          titleIconVariant="danger"
          title={t('Apply Gatekeeper remediation')}
          variant={ModalVariant.small}
          description={t(
            'This applies the AI remediation patch to the Kubernetes API after RBAC and OPA checks.'
          )}
          isOpen
          onClose={() => setConfirmApply(false)}
          actions={[
            <Button
              key="confirm"
              variant="danger"
              onClick={() => {
                setConfirmApply(false);
                void remediate('apply');
              }}
              data-cy="gatekeeper-remediation-confirm-button"
            >
              {t('Confirm')}
            </Button>,
            <Button key="cancel" variant="link" onClick={() => setConfirmApply(false)}>
              {t('Cancel')}
            </Button>,
          ]}
        >
          {props.context
            ? t('Context: {{context}}', { context: props.context })
            : t('Default Kubernetes context')}
        </Modal>
      ) : null}
    </PageSection>
  );
}

function GatekeeperDetailsContent(props: {
  kind: GatekeeperInventoryKind;
  data: GatekeeperResponse;
  searchParams: URLSearchParams;
  canManagePolicy: boolean;
  onApplied: () => unknown;
}) {
  const { t } = useTranslation();
  if (props.kind === 'templates') {
    const item = props.data.constraint_templates.find(
      (value) => value.name === props.searchParams.get('name')
    );
    if (!item) return null;
    const relatedConstraints = props.data.constraints.filter(
      (constraint) => constraint.kind === item.kind && constraint.name
    );
    return (
      <>
        <PageDetails>
          <PageDetail label={t('Name')}>{item.name}</PageDetail>
          <PageDetail label={t('Kind')}>{item.kind}</PageDetail>
          <PageDetail label={t('API version')}>{item.api_version}</PageDetail>
          <PageDetail label={t('Observed generation')}>
            {item.observed_generation ?? t('Not reported')}
          </PageDetail>
          <PageDetail label={t('Constraints')}>
            {relatedConstraints.length > 0 ? (
              <LabelGroup>
                {relatedConstraints.map((constraint) => (
                  <Label key={`${constraint.kind}/${constraint.name}`}>
                    <Link
                      to={detailUrl('/policy-as-code/gatekeeper/constraints/detail', {
                        kind: constraint.kind,
                        name: constraint.name,
                        context: props.data.cluster.context,
                      })}
                    >
                      {constraint.kind}/{constraint.name}
                    </Link>
                  </Label>
                ))}
              </LabelGroup>
            ) : (
              t('No linked constraints')
            )}
          </PageDetail>
        </PageDetails>
        <PageSection>
          <CodeBlock>
            <CodeBlockCode>
              {JSON.stringify(
                {
                  schema: item.schema,
                  targets: item.targets,
                  by_pod: item.by_pod,
                  errors: item.errors,
                },
                null,
                2
              )}
            </CodeBlockCode>
          </CodeBlock>
        </PageSection>
      </>
    );
  }
  if (props.kind === 'constraints') {
    const item = props.data.constraints.find(
      (value) =>
        value.kind === props.searchParams.get('kind') &&
        value.name === props.searchParams.get('name')
    );
    if (!item) return null;
    return (
      <>
        <PageDetails>
          <PageDetail label={t('Name')}>{item.name}</PageDetail>
          <PageDetail label={t('Kind')}>{item.kind}</PageDetail>
          <PageDetail label={t('Enforcement')}>
            <EnforcementLabel action={item.enforcement_action} />
          </PageDetail>
          <PageDetail label={t('Violations')}>{item.total_violations}</PageDetail>
          <PageDetail label={t('Last audit')}>
            {item.audit_timestamp || t('Not reported')}
          </PageDetail>
          <PageDetail label={t('API version')}>{item.api_version}</PageDetail>
        </PageDetails>
        <PageSection>
          <CodeBlock>
            <CodeBlockCode>
              {JSON.stringify(
                {
                  match: item.match,
                  parameters: item.parameters,
                  by_pod: item.by_pod,
                  violations: item.violations,
                },
                null,
                2
              )}
            </CodeBlockCode>
          </CodeBlock>
        </PageSection>
      </>
    );
  }
  if (props.kind === 'configs') {
    const item = props.data.configs.find((value) => value.name === props.searchParams.get('name'));
    if (!item) return null;
    return (
      <>
        <PageDetails>
          <PageDetail label={t('Name')}>{item.name}</PageDetail>
          <PageDetail label={t('API version')}>{item.api_version}</PageDetail>
          <PageDetail label={t('Synced kinds')}>{item.sync_only_count}</PageDetail>
          <PageDetail label={t('Readiness stats')}>
            {item.readiness_stats_enabled ? t('Enabled') : t('Disabled')}
          </PageDetail>
        </PageDetails>
        <PageSection>
          <CodeBlock>
            <CodeBlockCode>
              {JSON.stringify(
                {
                  match: item.match,
                  sync_only: item.sync_only,
                  readiness: item.readiness,
                  status: item.status,
                },
                null,
                2
              )}
            </CodeBlockCode>
          </CodeBlock>
        </PageSection>
      </>
    );
  }
  const item = props.data.violations.find(
    (value) => violationKey(value) === props.searchParams.get('key')
  );
  if (!item) return null;
  return (
    <>
      <PageDetails>
        <PageDetail label={t('Resource')}>
          {item.resource_namespace
            ? `${item.resource_namespace}/${item.resource_name}`
            : item.resource_name}
        </PageDetail>
        <PageDetail label={t('Kind')}>{item.resource_kind}</PageDetail>
        <PageDetail label={t('Constraint')}>
          {item.constraint_kind}/{item.constraint_name}
        </PageDetail>
        <PageDetail label={t('Enforcement')}>
          <EnforcementLabel action={item.enforcement_action} />
        </PageDetail>
        <PageDetail label={t('API version')}>
          {item.resource_api_version ||
            [item.resource_group, item.resource_version].filter(Boolean).join('/')}
        </PageDetail>
        <PageDetail label={t('Message')} fullWidth>
          {item.message}
        </PageDetail>
      </PageDetails>
      <GatekeeperViolationRemediation
        violation={item}
        context={props.data.cluster.context}
        canManagePolicy={props.canManagePolicy}
        onApplied={props.onApplied}
      />
    </>
  );
}

export function GatekeeperResourceDetailPage(props: {
  kind: GatekeeperInventoryKind;
  canManagePolicy: boolean;
}) {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const context = searchParams.get('context') || '';
  const search = props.kind === 'violations' ? searchParams.get('resource') || '' : '';
  const params = new URLSearchParams();
  if (context) params.set('context', context);
  if (search) params.set('violation_search', search);
  params.set('violation_limit', '200');
  const response = useGet<GatekeeperResponse>(`${awxAPI`/opa/gatekeeper/`}?${params.toString()}`);
  const title =
    props.kind === 'templates'
      ? searchParams.get('name')
      : props.kind === 'constraints'
        ? `${searchParams.get('kind') || ''}/${searchParams.get('name') || ''}`
        : props.kind === 'configs'
          ? searchParams.get('name')
          : searchParams.get('key')?.split('/').slice(2, 5).filter(Boolean).join('/') ||
            t('Gatekeeper violation');
  const listPath =
    props.kind === 'configs'
      ? '/policy-as-code/gatekeeper/configurations'
      : `/policy-as-code/gatekeeper/${props.kind}`;
  if (response.error) return <AwxError error={response.error} handleRefresh={response.refresh} />;
  if (response.isLoading || !response.data) return <LoadingPage breadcrumbs />;
  const content = (
    <GatekeeperDetailsContent
      kind={props.kind}
      data={response.data}
      searchParams={searchParams}
      canManagePolicy={props.canManagePolicy}
      onApplied={response.refresh}
    />
  );
  return (
    <PageLayout>
      <PageHeader
        title={title || t('Gatekeeper resource')}
        breadcrumbs={[
          { label: t('Gatekeeper {{kind}}', { kind: props.kind }), to: listPath },
          { label: title || t('Details') },
        ]}
      />
      {content || (
        <PageSection>
          <Alert isInline variant="warning" title={t('Gatekeeper resource not found.')} />
        </PageSection>
      )}
    </PageLayout>
  );
}
