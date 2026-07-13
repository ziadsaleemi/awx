import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Checkbox,
  CodeBlock,
  CodeBlockCode,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  FormGroup,
  FormSelect,
  FormSelectOption,
  Grid,
  GridItem,
  Label,
  Modal,
  ModalVariant,
  PageSection,
  SearchInput,
  Stack,
  StackItem,
  TextArea,
  TextInput,
} from '@patternfly/react-core';
import {
  CheckCircleIcon,
  DownloadIcon,
  ExclamationTriangleIcon,
  MagicIcon,
  SyncAltIcon,
  TimesCircleIcon,
} from '@patternfly/react-icons';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { LoadingPage, useGetPageUrl } from '../../../../framework';
import { postRequest } from '../../../common/crud/Data';
import { isRequestError } from '../../../common/crud/RequestError';
import { useGet } from '../../../common/crud/useGet';
import { AwxError } from '../../common/AwxError';
import { awxAPI } from '../../common/api/awx-utils';
import { AwxRoute } from '../../main/AwxRoutes';
import { PagePagination } from '../../../../framework/PageTable/PagePagination';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === 'object' && value !== null ? (value as UnknownRecord) : undefined;
}

function stringField(record: UnknownRecord | undefined, key: string) {
  const value = record?.[key];
  return typeof value === 'string' ? value : undefined;
}

function requestErrorMessage(error: unknown, fallback: string) {
  if (isRequestError(error)) {
    const body = asRecord(error.body);
    const topLevelDetail = stringField(body, 'detail');
    const nestedError = asRecord(body?.error);
    const nestedDetail = asRecord(nestedError?.detail);
    const nestedMessage =
      stringField(nestedDetail, 'message') ||
      stringField(nestedDetail, 'detail') ||
      stringField(nestedError, 'detail');
    if (topLevelDetail && nestedMessage) return `${topLevelDetail} ${nestedMessage}`;
    return topLevelDetail || nestedMessage || error.message || fallback;
  }
  return error instanceof Error ? error.message : fallback;
}

export type GatekeeperPolicyManagerView =
  | 'overview'
  | 'changes'
  | 'templates'
  | 'constraints'
  | 'violations'
  | 'configs';

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

interface GatekeeperPolicyManagerResponse {
  configured: boolean;
  message?: string;
  contexts: GatekeeperContextOption[];
  cluster: {
    server_url: string;
    context: string;
    verify_ssl: boolean;
  };
  api_versions?: {
    constraint_templates?: string;
    constraints?: string[];
    configs?: string;
  };
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
  errors: GatekeeperError[];
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
  targets: {
    target: string;
    rego: string;
    libs: unknown[];
  }[];
  constraints: {
    kind: string;
    name: string;
  }[];
}

interface GatekeeperConstraint {
  kind: string;
  name: string;
  api_version: string;
  resource?: string;
  version?: string;
  enforcement_action: string;
  match: UnknownRecord;
  parameters: UnknownRecord;
  total_violations: number;
  audit_timestamp: string;
  by_pod: unknown[];
  violations: unknown[];
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

interface GatekeeperConfig {
  name: string;
  api_version: string;
  sync_only_count: number;
  sync_only: unknown[];
  match: unknown[];
  readiness?: unknown;
  readiness_stats_enabled?: boolean;
  status?: unknown;
}

interface GatekeeperError {
  resource: string;
  status_code?: number;
  detail: unknown;
  version?: string;
}

interface GatekeeperApplyResponse {
  changed: boolean;
  persisted: boolean;
  dry_run: boolean;
  mode: string;
  operation: string;
  target: GatekeeperTarget;
  apply_strategy?: string | null;
  field_manager?: string | null;
  force_conflicts?: boolean | null;
  before_exists: boolean;
  before_sha256: string;
  after_sha256: string;
  diff: string;
  rollback_plan: unknown;
  opa_allowed?: boolean | null;
  kubernetes_response?: unknown;
  audit?: GatekeeperAuditRef | null;
}

interface AwxProjectSummary {
  id: number;
  name: string;
  scm_type?: string;
  scm_url?: string;
  scm_branch?: string;
  scm_revision?: string;
  status?: string;
}

interface AwxProjectList {
  count: number;
  results: AwxProjectSummary[];
}

interface GatekeeperProjectSyncResult {
  file_path: string;
  document_index: number;
  manifest: UnknownRecord;
  manifest_yaml: string;
  mode: string;
  operation: string;
  target: GatekeeperTarget;
  before_exists: boolean;
  before_sha256: string;
  after_sha256: string;
  diff: string;
  rollback_plan: unknown;
  opa_allowed?: boolean | null;
  kubernetes_response?: unknown;
  audit?: GatekeeperAuditRef | null;
}

interface GatekeeperProjectSyncResponse {
  changed: boolean;
  persisted: boolean;
  dry_run: boolean;
  mode: string;
  project: AwxProjectSummary;
  project_source: UnknownRecord;
  apply_strategy: string;
  field_manager: string;
  force_conflicts: boolean;
  counts: {
    files: number;
    manifests: number;
    created: number;
    updated: number;
  };
  results: GatekeeperProjectSyncResult[];
}

interface GatekeeperRemediationPlan {
  summary: string;
  rationale: string;
  risk: string;
  target: GatekeeperTarget;
  patch_type: string;
  patch?: UnknownRecord | null;
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

type GatekeeperDeletePayload = {
  mode: string;
  human_approved: boolean;
  context_name: string;
  manifest?: string;
  target?: GatekeeperTarget;
};

type GatekeeperLiveAction = 'apply' | 'delete' | 'rollback' | 'remediation' | 'project_sync';

interface GatekeeperAuthorResponse {
  generated: boolean;
  prompt_summary: string;
  manifest: string;
  manifest_json: UnknownRecord;
  target?: UnknownRecord | null;
  provider: string;
  model: string;
  context: UnknownRecord;
  audit?: GatekeeperAuditRef | null;
}

const defaultGatekeeperManifest = `apiVersion: templates.gatekeeper.sh/v1
kind: ConstraintTemplate
metadata:
  name: k8srequiredlabels
spec:
  crd:
    spec:
      names:
        kind: K8sRequiredLabels
      validation:
        openAPIV3Schema:
          type: object
  targets:
    - target: admission.k8s.gatekeeper.sh
      rego: |
        package k8srequiredlabels
`;

const defaultRollbackPlan = JSON.stringify(
  {
    operation: 'delete',
    target: {
      api_version: 'templates.gatekeeper.sh/v1',
      kind: 'ConstraintTemplate',
      name: 'k8srequiredlabels',
      resource: 'constrainttemplates',
      object_path: '/apis/templates.gatekeeper.sh/v1/constrainttemplates/k8srequiredlabels',
    },
  },
  null,
  2
);

function EnforcementLabel(props: { action: string }) {
  const action = props.action || 'deny';
  const color = action === 'deny' ? 'red' : action === 'dryrun' ? 'orange' : 'grey';
  return <Label color={color}>{action}</Label>;
}

function StatusLabel(props: { ok: boolean; okText: string; failText: string }) {
  return props.ok ? (
    <Label color="green" icon={<CheckCircleIcon />}>
      {props.okText}
    </Label>
  ) : (
    <Label color="red" icon={<TimesCircleIcon />}>
      {props.failText}
    </Label>
  );
}

function GatekeeperMetricTile(props: {
  label: string;
  value: string | number;
  detail: string;
  attention?: boolean;
}) {
  return (
    <div
      data-cy="gatekeeper-metric-tile"
      style={{
        border: '1px solid var(--pf-v5-global--BorderColor--100)',
        minHeight: 112,
        minWidth: 0,
        padding: 16,
        width: '100%',
      }}
    >
      <Stack hasGutter>
        <StackItem>
          <strong
            style={{
              color: props.attention ? 'var(--pf-v5-global--danger-color--100)' : undefined,
              fontSize: 24,
              lineHeight: 1.2,
              overflowWrap: 'anywhere',
            }}
          >
            {props.value}
          </strong>
        </StackItem>
        <StackItem>
          <div>{props.label}</div>
          <div style={{ marginTop: 4, opacity: 0.75, overflowWrap: 'anywhere' }}>
            {props.detail}
          </div>
        </StackItem>
      </Stack>
    </div>
  );
}

function jsonPreview(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

function downloadReport(data: GatekeeperPolicyManagerResponse) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'gatekeeper-policy-report.json';
  anchor.click();
  URL.revokeObjectURL(url);
}

type GatekeeperDetail =
  | { type: 'template'; name: string }
  | { type: 'constraint'; kind: string; name: string }
  | { type: 'violation'; key: string }
  | { type: 'config'; name: string };

function gatekeeperDetailFromSearchParams(params: URLSearchParams): GatekeeperDetail | undefined {
  const type = params.get('detail') || '';
  if (type === 'template' && params.get('name')) {
    return { type, name: params.get('name') || '' };
  }
  if (type === 'constraint' && params.get('kind') && params.get('name')) {
    return { type, kind: params.get('kind') || '', name: params.get('name') || '' };
  }
  if (type === 'violation' && params.get('key')) {
    return { type, key: params.get('key') || '' };
  }
  if (type === 'config' && params.get('name')) {
    return { type, name: params.get('name') || '' };
  }
  return undefined;
}

function gatekeeperDetailKey(detail?: GatekeeperDetail) {
  if (!detail) return '';
  if (detail.type === 'constraint') return `${detail.type}/${detail.kind}/${detail.name}`;
  if (detail.type === 'violation') return `${detail.type}/${detail.key}`;
  return `${detail.type}/${detail.name}`;
}

function setGatekeeperDetailSearchParams(
  params: URLSearchParams,
  detail: GatekeeperDetail | undefined
) {
  params.delete('detail');
  params.delete('kind');
  params.delete('name');
  params.delete('key');
  if (!detail) return;
  params.set('detail', detail.type);
  if (detail.type === 'constraint') {
    params.set('kind', detail.kind);
    params.set('name', detail.name);
  } else if (detail.type === 'violation') {
    params.set('key', detail.key);
  } else {
    params.set('name', detail.name);
  }
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

function gatekeeperTargetDisplay(target?: GatekeeperTarget) {
  if (!target) return '';
  const namespace = target.namespace ? `${target.namespace}/` : '';
  return `${target.kind}/${namespace}${target.name}`;
}

function selectedGatekeeperTarget(
  data: GatekeeperPolicyManagerResponse | undefined,
  selectedDetail: GatekeeperDetail | undefined
): GatekeeperTarget | undefined {
  if (!data || !selectedDetail) return undefined;
  if (selectedDetail.type === 'template') {
    const template = data.constraint_templates.find((item) => item.name === selectedDetail.name);
    if (!template) return undefined;
    return {
      api_version: template.api_version,
      kind: 'ConstraintTemplate',
      name: template.name,
      resource: 'constrainttemplates',
    };
  }
  if (selectedDetail.type === 'constraint') {
    const constraint = data.constraints.find(
      (item) => item.kind === selectedDetail.kind && item.name === selectedDetail.name
    );
    if (!constraint) return undefined;
    return {
      api_version: constraint.api_version,
      kind: constraint.kind,
      name: constraint.name,
      resource: constraint.resource,
    };
  }
  if (selectedDetail.type === 'config') {
    const config = data.configs.find((item) => item.name === selectedDetail.name);
    if (!config) return undefined;
    return {
      api_version: config.api_version,
      kind: 'Config',
      name: config.name,
      resource: 'configs',
    };
  }
  return undefined;
}

function gatekeeperLiveActionTitle(t: (value: string) => string, action: GatekeeperLiveAction) {
  if (action === 'delete') return t('Delete Gatekeeper resource');
  if (action === 'rollback') return t('Apply Gatekeeper rollback');
  if (action === 'remediation') return t('Apply Gatekeeper remediation');
  if (action === 'project_sync') return t('Apply project manifests');
  return t('Apply Gatekeeper manifest');
}

function gatekeeperLiveActionDescription(
  t: (value: string) => string,
  action: GatekeeperLiveAction
) {
  if (action === 'delete') {
    return t('This sends a live delete request to the Kubernetes API after RBAC and OPA checks.');
  }
  if (action === 'rollback') {
    return t('This applies the rollback plan to the Kubernetes API after RBAC and OPA checks.');
  }
  if (action === 'remediation') {
    return t(
      'This applies the selected AI remediation patch to the Kubernetes API after RBAC and OPA checks.'
    );
  }
  if (action === 'project_sync') {
    return t(
      'This reads manifests from the selected Capstan Project checkout and applies them to the Kubernetes API after RBAC and OPA checks.'
    );
  }
  return t('This applies the manifest to the Kubernetes API after RBAC and OPA checks.');
}

function GatekeeperAuditLink(props: {
  audit?: GatekeeperAuditRef | null;
  dataCy: string;
  getPageUrl: ReturnType<typeof useGetPageUrl>;
}) {
  const { t } = useTranslation();
  if (!props.audit?.activity_stream_id) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <Link
        to={props.getPageUrl(AwxRoute.ActivityStream, {
          query: { id: props.audit.activity_stream_id },
        })}
        data-cy={props.dataCy}
      >
        {t('View Activity Stream #{{id}}', { id: props.audit.activity_stream_id })}
      </Link>
    </div>
  );
}

function GatekeeperTemplateDetail(props: {
  template: GatekeeperConstraintTemplate;
  onSelectConstraint: (kind: string, name: string) => void;
}) {
  const { t } = useTranslation();
  const { template } = props;
  return (
    <Card isFlat>
      <CardHeader>
        <CardTitle>{t('ConstraintTemplate detail')}</CardTitle>
      </CardHeader>
      <CardBody>
        <Stack hasGutter>
          <StackItem>
            <DescriptionList isHorizontal isCompact>
              <DescriptionListGroup>
                <DescriptionListTerm>{t('Name')}</DescriptionListTerm>
                <DescriptionListDescription>{template.name}</DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>{t('Kind')}</DescriptionListTerm>
                <DescriptionListDescription>
                  {template.kind || t('Unknown')}
                </DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>{t('Observed generation')}</DescriptionListTerm>
                <DescriptionListDescription>
                  {template.observed_generation ?? t('Not reported')}
                </DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>{t('Constraints')}</DescriptionListTerm>
                <DescriptionListDescription>
                  {template.constraints.length === 0 ? t('None') : null}
                  {template.constraints.map((constraint) => (
                    <Button
                      key={`${constraint.kind}/${constraint.name}`}
                      variant="link"
                      isInline
                      onClick={() => props.onSelectConstraint(constraint.kind, constraint.name)}
                    >
                      {constraint.kind}/{constraint.name}
                    </Button>
                  ))}
                </DescriptionListDescription>
              </DescriptionListGroup>
            </DescriptionList>
          </StackItem>
          <StackItem>
            <CodeBlock>
              <CodeBlockCode>
                {jsonPreview({
                  by_pod: template.by_pod,
                  errors: template.errors,
                  schema: template.schema,
                  targets: template.targets,
                })}
              </CodeBlockCode>
            </CodeBlock>
          </StackItem>
        </Stack>
      </CardBody>
    </Card>
  );
}

function GatekeeperConstraintDetail(props: { constraint: GatekeeperConstraint }) {
  const { t } = useTranslation();
  const { constraint } = props;
  return (
    <Card isFlat>
      <CardHeader>
        <CardTitle>{t('Constraint detail')}</CardTitle>
      </CardHeader>
      <CardBody>
        <Stack hasGutter>
          <StackItem>
            <DescriptionList isHorizontal isCompact>
              <DescriptionListGroup>
                <DescriptionListTerm>{t('Name')}</DescriptionListTerm>
                <DescriptionListDescription>
                  {constraint.kind}/{constraint.name}
                </DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>{t('Enforcement')}</DescriptionListTerm>
                <DescriptionListDescription>
                  <EnforcementLabel action={constraint.enforcement_action} />
                </DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>{t('Violations')}</DescriptionListTerm>
                <DescriptionListDescription>
                  {constraint.total_violations}
                </DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>{t('Audit')}</DescriptionListTerm>
                <DescriptionListDescription>
                  {constraint.audit_timestamp || t('Not reported')}
                </DescriptionListDescription>
              </DescriptionListGroup>
            </DescriptionList>
          </StackItem>
          <StackItem>
            <CodeBlock>
              <CodeBlockCode>
                {jsonPreview({
                  match: constraint.match,
                  parameters: constraint.parameters,
                  by_pod: constraint.by_pod,
                  violations: constraint.violations,
                })}
              </CodeBlockCode>
            </CodeBlock>
          </StackItem>
        </Stack>
      </CardBody>
    </Card>
  );
}

function GatekeeperViolationDetail(props: { violation: GatekeeperViolation }) {
  const { t } = useTranslation();
  const { violation } = props;
  return (
    <Card isFlat>
      <CardHeader>
        <CardTitle>{t('Violation detail')}</CardTitle>
      </CardHeader>
      <CardBody>
        <DescriptionList isHorizontal isCompact>
          <DescriptionListGroup>
            <DescriptionListTerm>{t('Resource')}</DescriptionListTerm>
            <DescriptionListDescription>
              {violation.resource_namespace
                ? `${violation.resource_namespace}/${violation.resource_name}`
                : violation.resource_name || t('Unknown resource')}
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>{t('Kind')}</DescriptionListTerm>
            <DescriptionListDescription>
              {violation.resource_kind || t('Unknown')}
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>{t('Constraint')}</DescriptionListTerm>
            <DescriptionListDescription>
              {violation.constraint_kind}/{violation.constraint_name}
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>{t('Enforcement')}</DescriptionListTerm>
            <DescriptionListDescription>
              <EnforcementLabel action={violation.enforcement_action} />
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>{t('API')}</DescriptionListTerm>
            <DescriptionListDescription>
              {violation.resource_api_version ||
                [violation.resource_group, violation.resource_version].filter(Boolean).join('/') ||
                t('Not reported')}
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>{t('Message')}</DescriptionListTerm>
            <DescriptionListDescription>{violation.message}</DescriptionListDescription>
          </DescriptionListGroup>
        </DescriptionList>
      </CardBody>
    </Card>
  );
}

function GatekeeperConfigDetail(props: { config: GatekeeperConfig }) {
  const { t } = useTranslation();
  const { config } = props;
  return (
    <Card isFlat>
      <CardHeader>
        <CardTitle>{t('Config detail')}</CardTitle>
      </CardHeader>
      <CardBody>
        <Stack hasGutter>
          <StackItem>
            <DescriptionList isHorizontal isCompact>
              <DescriptionListGroup>
                <DescriptionListTerm>{t('Name')}</DescriptionListTerm>
                <DescriptionListDescription>{config.name}</DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>{t('Synced kinds')}</DescriptionListTerm>
                <DescriptionListDescription>{config.sync_only_count}</DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>{t('Readiness stats')}</DescriptionListTerm>
                <DescriptionListDescription>
                  {config.readiness_stats_enabled ? t('Enabled') : t('Disabled')}
                </DescriptionListDescription>
              </DescriptionListGroup>
            </DescriptionList>
          </StackItem>
          <StackItem>
            <CodeBlock>
              <CodeBlockCode>
                {jsonPreview({
                  match: config.match,
                  sync_only: config.sync_only,
                  readiness: config.readiness,
                  status: config.status,
                })}
              </CodeBlockCode>
            </CodeBlock>
          </StackItem>
        </Stack>
      </CardBody>
    </Card>
  );
}

export function GatekeeperPolicyManager(props?: {
  canManagePolicy?: boolean;
  view?: GatekeeperPolicyManagerView;
}) {
  const { t } = useTranslation();
  const canManagePolicy = props?.canManagePolicy ?? true;
  const view = props?.view ?? 'overview';
  const getPageUrl = useGetPageUrl();
  const [searchParams, setSearchParams] = useSearchParams();
  const searchParamString = searchParams.toString();
  const [violationFilter, setViolationFilter] = useState(
    () => searchParams.get('violation_search') || ''
  );
  const [violationSort, setViolationSort] = useState(
    () => searchParams.get('violation_sort') || 'constraint'
  );
  const [violationLimit, setViolationLimit] = useState(
    () => searchParams.get('violation_limit') || '50'
  );
  const [violationPage, setViolationPage] = useState(
    () => Number(searchParams.get('violation_page') || '1') || 1
  );
  const [selectedContext, setSelectedContext] = useState(() => searchParams.get('context') || '');
  const [selectedDetail, setSelectedDetail] = useState<GatekeeperDetail | undefined>(() =>
    gatekeeperDetailFromSearchParams(searchParams)
  );
  const [applyMode, setApplyMode] = useState('preview');
  const [applyStrategy, setApplyStrategy] = useState('update');
  const [fieldManager, setFieldManager] = useState('awx');
  const [forceConflicts, setForceConflicts] = useState(false);
  const [applyManifest, setApplyManifest] = useState(defaultGatekeeperManifest);
  const [applyLoading, setApplyLoading] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<GatekeeperApplyResponse | null>(null);
  const [deleteMode, setDeleteMode] = useState('preview');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteResult, setDeleteResult] = useState<GatekeeperApplyResponse | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GatekeeperTarget | undefined>();
  const [rollbackMode, setRollbackMode] = useState('preview');
  const [rollbackPlan, setRollbackPlan] = useState(defaultRollbackPlan);
  const [rollbackLoading, setRollbackLoading] = useState(false);
  const [rollbackError, setRollbackError] = useState<string | null>(null);
  const [rollbackResult, setRollbackResult] = useState<GatekeeperApplyResponse | null>(null);
  const [confirmLiveAction, setConfirmLiveAction] = useState<GatekeeperLiveAction | null>(null);
  const [authorPrompt, setAuthorPrompt] = useState('');
  const [authorLoading, setAuthorLoading] = useState(false);
  const [authorError, setAuthorError] = useState<string | null>(null);
  const [authorResult, setAuthorResult] = useState<GatekeeperAuthorResponse | null>(null);
  const [projectSyncMode, setProjectSyncMode] = useState('preview');
  const [projectSyncProjectId, setProjectSyncProjectId] = useState('');
  const [projectSyncPath, setProjectSyncPath] = useState('gatekeeper/**/*.yaml');
  const [projectSyncLoading, setProjectSyncLoading] = useState(false);
  const [projectSyncError, setProjectSyncError] = useState<string | null>(null);
  const [projectSyncResult, setProjectSyncResult] = useState<GatekeeperProjectSyncResponse | null>(
    null
  );
  const [remediationLoading, setRemediationLoading] = useState(false);
  const [remediationError, setRemediationError] = useState<string | null>(null);
  const [remediationResult, setRemediationResult] = useState<GatekeeperRemediationResponse | null>(
    null
  );
  const projectsUrl = awxAPI`/projects/?page_size=200&order_by=name`;
  const gatekeeperUrl = useMemo(() => {
    const params = new URLSearchParams();
    const search = violationFilter.trim();
    if (selectedContext) params.set('context', selectedContext);
    if (search) params.set('violation_search', search);
    params.set('violation_sort', violationSort);
    params.set('violation_limit', violationLimit);
    params.set('violation_page', String(violationPage));
    return `${awxAPI`/opa/gatekeeper/`}?${params.toString()}`;
  }, [selectedContext, violationFilter, violationLimit, violationPage, violationSort]);
  const { data: projectsData, error: projectsError } = useGet<AwxProjectList>(projectsUrl);
  const { data, isLoading, error, refresh } =
    useGet<GatekeeperPolicyManagerResponse>(gatekeeperUrl);
  useEffect(() => {
    if (canManagePolicy) return;
    if (applyMode === 'apply') setApplyMode('preview');
    if (deleteMode === 'delete') setDeleteMode('preview');
    if (rollbackMode === 'apply') setRollbackMode('preview');
    if (projectSyncMode === 'apply') setProjectSyncMode('preview');
  }, [applyMode, canManagePolicy, deleteMode, projectSyncMode, rollbackMode]);
  const activeContext = selectedContext || data?.cluster.context || '';
  const syncGatekeeperRoute = (
    next: {
      context?: string;
      detail?: GatekeeperDetail;
      violationSearch?: string;
      violationSort?: string;
      violationLimit?: string;
      violationPage?: number;
    },
    replace = false
  ) => {
    const params = new URLSearchParams(searchParams);
    const context = next.context ?? selectedContext;
    const search = next.violationSearch ?? violationFilter;
    const sort = next.violationSort ?? violationSort;
    const limit = next.violationLimit ?? violationLimit;
    const page = next.violationPage ?? violationPage;
    if (context) params.set('context', context);
    else params.delete('context');
    if (search.trim()) params.set('violation_search', search.trim());
    else params.delete('violation_search');
    params.set('violation_sort', sort || 'constraint');
    params.set('violation_limit', limit || '50');
    params.set('violation_page', String(page || 1));
    setGatekeeperDetailSearchParams(params, next.detail);
    if (params.toString() !== searchParamString) {
      setSearchParams(params, { replace });
    }
  };
  const selectGatekeeperDetail = (detail: GatekeeperDetail | undefined) => {
    setSelectedDetail(detail);
    syncGatekeeperRoute({ context: activeContext, detail });
  };
  useEffect(() => {
    const params = new URLSearchParams(searchParamString);
    const nextSearch = params.get('violation_search') || '';
    const nextSort = params.get('violation_sort') || 'constraint';
    const nextLimit = params.get('violation_limit') || '50';
    const nextPage = Number(params.get('violation_page') || '1') || 1;
    const nextContext = params.get('context') || '';
    const nextDetail = gatekeeperDetailFromSearchParams(params);
    if (nextSearch !== violationFilter) setViolationFilter(nextSearch);
    if (nextSort !== violationSort) setViolationSort(nextSort);
    if (nextLimit !== violationLimit) setViolationLimit(nextLimit);
    if (nextPage !== violationPage) setViolationPage(nextPage);
    if (nextContext !== selectedContext) setSelectedContext(nextContext);
    if (gatekeeperDetailKey(nextDetail) !== gatekeeperDetailKey(selectedDetail)) {
      setSelectedDetail(nextDetail);
    }
  }, [
    searchParamString,
    selectedContext,
    selectedDetail,
    violationFilter,
    violationLimit,
    violationPage,
    violationSort,
  ]);
  useEffect(() => {
    if (selectedContext || !data?.contexts?.length) return;
    const active = data.contexts.find((context) => context.selected) || data.contexts[0];
    if (active?.name) {
      setSelectedContext(active.name);
      syncGatekeeperRoute({ context: active.name, detail: selectedDetail }, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.contexts, selectedContext]);
  const selectedTemplate = useMemo(() => {
    if (selectedDetail?.type !== 'template') return undefined;
    return data?.constraint_templates.find((template) => template.name === selectedDetail.name);
  }, [data?.constraint_templates, selectedDetail]);
  const selectedConstraint = useMemo(() => {
    if (selectedDetail?.type !== 'constraint') return undefined;
    return data?.constraints.find(
      (constraint) =>
        constraint.kind === selectedDetail.kind && constraint.name === selectedDetail.name
    );
  }, [data?.constraints, selectedDetail]);
  const selectedViolation = useMemo(() => {
    if (selectedDetail?.type !== 'violation') return undefined;
    return data?.violations.find((violation) => violationKey(violation) === selectedDetail.key);
  }, [data?.violations, selectedDetail]);
  const selectedViolationKey = selectedViolation ? violationKey(selectedViolation) : '';
  useEffect(() => {
    setRemediationError(null);
    setRemediationResult(null);
  }, [selectedViolationKey]);
  const selectedConfig = useMemo(() => {
    if (selectedDetail?.type !== 'config') return undefined;
    return data?.configs.find((config) => config.name === selectedDetail.name);
  }, [data?.configs, selectedDetail]);
  const selectedDeleteTarget = useMemo(
    () => selectedGatekeeperTarget(data, selectedDetail),
    [data, selectedDetail]
  );
  const authorContext = useMemo(
    () => ({
      context_name: activeContext,
      selected_detail: selectedDetail,
      counts: data?.counts,
      violation_query: data?.violation_query,
      constraint_templates: (data?.constraint_templates || []).map((template) => ({
        name: template.name,
        kind: template.kind,
        constraint_count: template.constraint_count,
      })),
      constraints: (data?.constraints || []).map((constraint) => ({
        kind: constraint.kind,
        name: constraint.name,
        enforcement_action: constraint.enforcement_action,
        total_violations: constraint.total_violations,
      })),
      violations: (data?.violations || []).map((violation) => ({
        constraint_kind: violation.constraint_kind,
        constraint_name: violation.constraint_name,
        resource_kind: violation.resource_kind,
        resource_namespace: violation.resource_namespace,
        resource_name: violation.resource_name,
        message: violation.message,
      })),
    }),
    [
      data?.constraint_templates,
      data?.constraints,
      data?.counts,
      data?.violation_query,
      data?.violations,
      activeContext,
      selectedDetail,
    ]
  );
  const selectedProject = useMemo(
    () =>
      (projectsData?.results || []).find(
        (project) => String(project.id) === String(projectSyncProjectId)
      ),
    [projectSyncProjectId, projectsData?.results]
  );

  const handleAuthorManifest = async () => {
    setAuthorLoading(true);
    setAuthorError(null);
    setAuthorResult(null);
    try {
      const response = await postRequest<
        GatekeeperAuthorResponse,
        { prompt: string; context: UnknownRecord; context_name: string }
      >(awxAPI`/opa/gatekeeper/author/`, {
        prompt: authorPrompt,
        context: authorContext,
        context_name: activeContext,
      });
      setAuthorResult(response);
      if (response.manifest) {
        setApplyManifest(response.manifest);
        setApplyMode('preview');
        setApplyResult(null);
        setDeleteResult(null);
      }
    } catch (err) {
      setAuthorError(
        err instanceof Error
          ? err.message
          : t('Gatekeeper AI authoring failed. Check AI settings and try again.')
      );
    } finally {
      setAuthorLoading(false);
    }
  };

  const handleProjectSync = async () => {
    if (!projectSyncProjectId) {
      setProjectSyncError(t('Select a Capstan Project before syncing Gatekeeper manifests.'));
      return;
    }
    setProjectSyncLoading(true);
    setProjectSyncError(null);
    setProjectSyncResult(null);
    try {
      const response = await postRequest<
        GatekeeperProjectSyncResponse,
        {
          mode: string;
          project: number;
          path: string;
          human_approved: boolean;
          apply_strategy: string;
          field_manager: string;
          force_conflicts: boolean;
          context_name: string;
        }
      >(awxAPI`/opa/gatekeeper/project-sync/`, {
        mode: projectSyncMode,
        project: Number(projectSyncProjectId),
        path: projectSyncPath,
        human_approved: projectSyncMode === 'apply',
        apply_strategy: applyStrategy,
        field_manager: fieldManager,
        force_conflicts: forceConflicts,
        context_name: activeContext,
      });
      setProjectSyncResult(response);
      const rollbackPlan = response.results.find((result) => result.rollback_plan)?.rollback_plan;
      if (rollbackPlan) {
        setRollbackPlan(JSON.stringify(rollbackPlan, null, 2));
      }
      if (response.persisted) void refresh();
    } catch (err) {
      setProjectSyncError(
        requestErrorMessage(
          err,
          t(
            'Gatekeeper project sync failed. Check project access, path, connection, and policy guardrails.'
          )
        )
      );
    } finally {
      setProjectSyncLoading(false);
    }
  };

  const handleApplyManifest = async () => {
    setApplyLoading(true);
    setApplyError(null);
    setApplyResult(null);
    try {
      const response = await postRequest<
        GatekeeperApplyResponse,
        {
          mode: string;
          manifest: string;
          human_approved: boolean;
          apply_strategy: string;
          field_manager: string;
          force_conflicts: boolean;
          context_name: string;
        }
      >(awxAPI`/opa/gatekeeper/apply/`, {
        mode: applyMode,
        manifest: applyManifest,
        human_approved: applyMode === 'apply',
        apply_strategy: applyStrategy,
        field_manager: fieldManager,
        force_conflicts: forceConflicts,
        context_name: activeContext,
      });
      setApplyResult(response);
      if (response.rollback_plan) {
        setRollbackPlan(JSON.stringify(response.rollback_plan, null, 2));
      }
      if (response.persisted) void refresh();
    } catch (err) {
      setApplyError(
        err instanceof Error
          ? err.message
          : t('Gatekeeper manifest operation failed. Check connection and policy guardrails.')
      );
    } finally {
      setApplyLoading(false);
    }
  };

  const handleDeleteManifest = async () => {
    setDeleteLoading(true);
    setDeleteError(null);
    setDeleteResult(null);
    try {
      const response = await postRequest<GatekeeperApplyResponse, GatekeeperDeletePayload>(
        awxAPI`/opa/gatekeeper/delete/`,
        {
          mode: deleteMode,
          human_approved: deleteMode === 'delete',
          context_name: activeContext,
          ...(deleteTarget ? { target: deleteTarget } : { manifest: applyManifest }),
        }
      );
      setDeleteResult(response);
      if (response.rollback_plan) {
        setRollbackPlan(JSON.stringify(response.rollback_plan, null, 2));
      }
      if (response.persisted) void refresh();
    } catch (err) {
      setDeleteError(
        err instanceof Error
          ? err.message
          : t('Gatekeeper delete failed. Check connection and policy guardrails.')
      );
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleRollback = async () => {
    setRollbackLoading(true);
    setRollbackError(null);
    setRollbackResult(null);
    try {
      let parsedPlan: unknown;
      try {
        parsedPlan = JSON.parse(rollbackPlan);
      } catch {
        setRollbackError(t('Rollback plan JSON is invalid.'));
        return;
      }
      const response = await postRequest<
        GatekeeperApplyResponse,
        {
          mode: string;
          rollback_plan: unknown;
          human_approved: boolean;
          apply_strategy: string;
          field_manager: string;
          force_conflicts: boolean;
          context_name: string;
        }
      >(awxAPI`/opa/gatekeeper/rollback/`, {
        mode: rollbackMode,
        rollback_plan: parsedPlan,
        human_approved: rollbackMode === 'apply',
        apply_strategy: applyStrategy,
        field_manager: fieldManager,
        force_conflicts: forceConflicts,
        context_name: activeContext,
      });
      setRollbackResult(response);
      if (response.persisted) void refresh();
    } catch (err) {
      setRollbackError(
        err instanceof Error
          ? err.message
          : t('Gatekeeper rollback failed. Check connection and policy guardrails.')
      );
    } finally {
      setRollbackLoading(false);
    }
  };

  const handleRemediateViolation = async (mode: 'preview' | 'dry_run' | 'apply') => {
    if (!selectedViolation) {
      setRemediationError(t('Select a Gatekeeper violation before requesting remediation.'));
      return;
    }
    if (mode !== 'preview' && !remediationResult?.plan) {
      setRemediationError(t('Generate an AI remediation plan before dry-run or apply.'));
      return;
    }
    setRemediationLoading(true);
    setRemediationError(null);
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
        violation: selectedViolation,
        remediation_plan: mode === 'preview' ? undefined : remediationResult?.plan,
        human_approved: mode === 'apply',
        context_name: activeContext,
      });
      setRemediationResult(response);
      if (response.rollback_plan) {
        setRollbackPlan(JSON.stringify(response.rollback_plan, null, 2));
      }
      if (response.persisted) void refresh();
    } catch (err) {
      setRemediationError(
        requestErrorMessage(
          err,
          t('Gatekeeper remediation failed. Check AI settings, connection, and policy guardrails.')
        )
      );
    } finally {
      setRemediationLoading(false);
    }
  };

  const handleConfirmLiveAction = async () => {
    const action = confirmLiveAction;
    setConfirmLiveAction(null);
    if (action === 'apply') {
      await handleApplyManifest();
    } else if (action === 'delete') {
      await handleDeleteManifest();
    } else if (action === 'rollback') {
      await handleRollback();
    } else if (action === 'remediation') {
      await handleRemediateViolation('apply');
    } else if (action === 'project_sync') {
      await handleProjectSync();
    }
  };

  const confirmLiveTarget =
    confirmLiveAction === 'delete'
      ? deleteTarget
        ? gatekeeperTargetDisplay(deleteTarget)
        : t('Manifest textarea resource')
      : confirmLiveAction === 'remediation' && selectedViolation
        ? selectedViolation.resource_namespace
          ? `${selectedViolation.resource_kind}/${selectedViolation.resource_namespace}/${selectedViolation.resource_name}`
          : `${selectedViolation.resource_kind}/${selectedViolation.resource_name}`
        : confirmLiveAction === 'project_sync'
          ? `${selectedProject?.name || t('Selected project')} / ${projectSyncPath || t('Default manifest paths')}`
          : confirmLiveAction === 'rollback'
            ? t('Rollback plan')
            : t('Manifest textarea resource');

  const showOverview = view === 'overview';
  const showChanges = view === 'changes';
  const showTemplates = view === 'templates';
  const showConstraints = view === 'constraints';
  const showViolations = view === 'violations';
  const showConfigs = view === 'configs';

  if (error) return <AwxError error={error} handleRefresh={refresh} />;

  return (
    <PageSection data-cy="gatekeeper-policy-manager">
      {isLoading || !data ? (
        <LoadingPage />
      ) : (
        <Stack hasGutter>
          {!data.configured ? (
            <StackItem>
              <Alert
                isInline
                variant="warning"
                title={t('Gatekeeper Kubernetes API is not configured.')}
              >
                <Stack hasGutter>
                  <StackItem>{data.message}</StackItem>
                  <StackItem>
                    <Link
                      to={getPageUrl(AwxRoute.SettingsGatekeeper)}
                      data-cy="gatekeeper-policy-settings-link"
                    >
                      {t('Open Gatekeeper settings')}
                    </Link>
                  </StackItem>
                </Stack>
              </Alert>
            </StackItem>
          ) : null}
          {data.errors.length > 0 ? (
            <StackItem>
              <Alert
                isInline
                variant="warning"
                title={t('{{count}} Gatekeeper resource reads returned errors.', {
                  count: data.errors.length,
                })}
              />
            </StackItem>
          ) : null}
          <StackItem>
            <Grid hasGutter>
              <GridItem sm={12} md={4} xl={3}>
                <FormGroup label={t('Context')} fieldId="gatekeeper-context">
                  <FormSelect
                    id="gatekeeper-context"
                    value={activeContext}
                    onChange={(_event, value) => {
                      const nextContext = String(value);
                      setSelectedContext(nextContext);
                      setSelectedDetail(undefined);
                      syncGatekeeperRoute({ context: nextContext, detail: undefined });
                      setApplyResult(null);
                      setDeleteResult(null);
                      setRollbackResult(null);
                    }}
                  >
                    {(data.contexts || []).map((context) => (
                      <FormSelectOption
                        key={context.name}
                        value={context.name}
                        label={`${context.name}${context.configured ? '' : ` (${t('not configured')})`}`}
                      />
                    ))}
                  </FormSelect>
                </FormGroup>
              </GridItem>
              <GridItem sm={12} md={8} xl={9} style={{ alignSelf: 'end' }}>
                <Button
                  variant="secondary"
                  icon={<SyncAltIcon />}
                  onClick={() => void refresh()}
                  isDisabled={isLoading}
                >
                  {t('Refresh')}
                </Button>{' '}
                <Button
                  variant="secondary"
                  icon={<DownloadIcon />}
                  onClick={() => downloadReport(data)}
                  isDisabled={!data.configured}
                >
                  {t('Download report')}
                </Button>
              </GridItem>
            </Grid>
          </StackItem>
          {showChanges ? (
            <StackItem>
              <Card isFlat>
                <CardHeader>
                  <CardTitle>{t('Governed changes')}</CardTitle>
                </CardHeader>
                <CardBody>
                  <Stack hasGutter>
                    {!data.configured ? (
                      <StackItem>
                        <Alert
                          isInline
                          variant="warning"
                          title={t('Configure Gatekeeper before dry-run or apply.')}
                        />
                      </StackItem>
                    ) : null}
                    {canManagePolicy ? (
                      <>
                        <StackItem>
                          <FormGroup
                            label={t('AI authoring prompt')}
                            fieldId="gatekeeper-author-prompt"
                          >
                            <TextArea
                              id="gatekeeper-author-prompt"
                              value={authorPrompt}
                              rows={3}
                              onChange={(_event, value) => setAuthorPrompt(value)}
                              aria-label={t('Gatekeeper AI authoring prompt')}
                            />
                          </FormGroup>
                        </StackItem>
                        <StackItem>
                          <Button
                            variant="secondary"
                            onClick={() => void handleAuthorManifest()}
                            isLoading={authorLoading}
                            isDisabled={authorLoading || !authorPrompt.trim()}
                          >
                            {t('Generate manifest')}
                          </Button>
                        </StackItem>
                      </>
                    ) : null}
                    {authorError ? (
                      <StackItem>
                        <Alert variant="danger" isInline title={authorError} />
                      </StackItem>
                    ) : null}
                    {authorResult ? (
                      <StackItem>
                        <Alert
                          variant="success"
                          isInline
                          title={t('Generated {{kind}}/{{name}} with {{provider}}.', {
                            kind: String(authorResult.manifest_json.kind ?? ''),
                            name: String(
                              (authorResult.manifest_json.metadata as UnknownRecord | undefined)
                                ?.name ?? ''
                            ),
                            provider: authorResult.provider,
                          })}
                          style={{ marginBottom: 12 }}
                        />
                        <GatekeeperAuditLink
                          audit={authorResult.audit}
                          dataCy="gatekeeper-author-audit-link"
                          getPageUrl={getPageUrl}
                        />
                      </StackItem>
                    ) : null}
                    <StackItem>
                      <div style={{ fontWeight: 600 }}>{t('Project manifests')}</div>
                      <div>
                        {t(
                          'Read Gatekeeper YAML or JSON from an already-synced Capstan Project checkout and run it through the same preview, dry-run, apply, OPA, and audit flow.'
                        )}
                      </div>
                    </StackItem>
                    {projectsError ? (
                      <StackItem>
                        <Alert
                          variant="warning"
                          isInline
                          title={t('Unable to load Capstan Projects.')}
                        />
                      </StackItem>
                    ) : null}
                    <StackItem>
                      <Grid hasGutter>
                        <GridItem sm={12} md={6} xl={3}>
                          <FormGroup label={t('Project')} fieldId="gatekeeper-project-sync-project">
                            <FormSelect
                              id="gatekeeper-project-sync-project"
                              value={projectSyncProjectId}
                              onChange={(_event, value) => {
                                setProjectSyncProjectId(String(value));
                                setProjectSyncResult(null);
                              }}
                              data-cy="gatekeeper-project-sync-project"
                            >
                              <FormSelectOption value="" label={t('Select project')} />
                              {(projectsData?.results || []).map((project) => (
                                <FormSelectOption
                                  key={project.id}
                                  value={String(project.id)}
                                  label={`${project.name}${project.scm_type ? ` (${project.scm_type})` : ''}`}
                                />
                              ))}
                            </FormSelect>
                          </FormGroup>
                        </GridItem>
                        <GridItem sm={12} md={6} xl={4}>
                          <FormGroup
                            label={t('Manifest path or glob')}
                            fieldId="gatekeeper-project-sync-path"
                          >
                            <TextInput
                              id="gatekeeper-project-sync-path"
                              value={projectSyncPath}
                              onChange={(_event, value) => {
                                setProjectSyncPath(value);
                                setProjectSyncResult(null);
                              }}
                              data-cy="gatekeeper-project-sync-path"
                            />
                          </FormGroup>
                        </GridItem>
                        <GridItem sm={12} md={6} xl={2}>
                          <FormGroup label={t('Sync mode')} fieldId="gatekeeper-project-sync-mode">
                            <FormSelect
                              id="gatekeeper-project-sync-mode"
                              value={projectSyncMode}
                              onChange={(_event, value) => setProjectSyncMode(String(value))}
                              data-cy="gatekeeper-project-sync-mode"
                            >
                              <FormSelectOption value="preview" label={t('Preview')} />
                              <FormSelectOption value="dry_run" label={t('Dry-run')} />
                              {canManagePolicy ? (
                                <FormSelectOption value="apply" label={t('Apply')} />
                              ) : null}
                            </FormSelect>
                          </FormGroup>
                        </GridItem>
                        <GridItem sm={12} md={6} xl={3} style={{ alignSelf: 'end' }}>
                          <Button
                            variant={projectSyncMode === 'apply' ? 'danger' : 'secondary'}
                            onClick={() =>
                              projectSyncMode === 'apply'
                                ? setConfirmLiveAction('project_sync')
                                : void handleProjectSync()
                            }
                            isLoading={projectSyncLoading}
                            isDisabled={
                              projectSyncLoading ||
                              !data.configured ||
                              !projectSyncProjectId ||
                              !projectSyncPath.trim()
                            }
                            data-cy="gatekeeper-project-sync-button"
                          >
                            {projectSyncMode === 'preview'
                              ? t('Preview project')
                              : projectSyncMode === 'dry_run'
                                ? t('Dry-run project')
                                : t('Apply project')}
                          </Button>
                        </GridItem>
                      </Grid>
                    </StackItem>
                    {projectSyncError ? (
                      <StackItem>
                        <Alert variant="danger" isInline title={projectSyncError} />
                      </StackItem>
                    ) : null}
                    {projectSyncResult ? (
                      <StackItem>
                        <Alert
                          variant={
                            projectSyncResult.persisted || projectSyncResult.dry_run
                              ? 'success'
                              : 'info'
                          }
                          isInline
                          title={t('{{mode}} {{count}} manifest(s) from {{project}}.', {
                            mode: projectSyncResult.mode,
                            count: projectSyncResult.counts.manifests,
                            project: projectSyncResult.project.name,
                          })}
                          style={{ marginBottom: 12 }}
                        />
                        <DescriptionList isHorizontal isCompact style={{ marginBottom: 12 }}>
                          <DescriptionListGroup>
                            <DescriptionListTerm>{t('Files')}</DescriptionListTerm>
                            <DescriptionListDescription>
                              {projectSyncResult.counts.files}
                            </DescriptionListDescription>
                          </DescriptionListGroup>
                          <DescriptionListGroup>
                            <DescriptionListTerm>{t('Creates')}</DescriptionListTerm>
                            <DescriptionListDescription>
                              {projectSyncResult.counts.created}
                            </DescriptionListDescription>
                          </DescriptionListGroup>
                          <DescriptionListGroup>
                            <DescriptionListTerm>{t('Updates')}</DescriptionListTerm>
                            <DescriptionListDescription>
                              {projectSyncResult.counts.updated}
                            </DescriptionListDescription>
                          </DescriptionListGroup>
                        </DescriptionList>
                        <CodeBlock>
                          <CodeBlockCode>{jsonPreview(projectSyncResult)}</CodeBlockCode>
                        </CodeBlock>
                      </StackItem>
                    ) : null}
                    <StackItem>
                      <Grid hasGutter>
                        <GridItem sm={12} md={6} xl={3}>
                          <FormGroup label={t('Apply mode')} fieldId="gatekeeper-apply-mode">
                            <FormSelect
                              id="gatekeeper-apply-mode"
                              value={applyMode}
                              onChange={(_event, value) => setApplyMode(String(value))}
                            >
                              <FormSelectOption value="preview" label={t('Preview')} />
                              <FormSelectOption value="dry_run" label={t('Dry-run')} />
                              {canManagePolicy ? (
                                <FormSelectOption value="apply" label={t('Apply')} />
                              ) : null}
                            </FormSelect>
                          </FormGroup>
                        </GridItem>
                        <GridItem sm={12} md={6} xl={3}>
                          <FormGroup label={t('Strategy')} fieldId="gatekeeper-apply-strategy">
                            <FormSelect
                              id="gatekeeper-apply-strategy"
                              value={applyStrategy}
                              onChange={(_event, value) => setApplyStrategy(String(value))}
                            >
                              <FormSelectOption value="update" label={t('Update')} />
                              <FormSelectOption
                                value="server_side"
                                label={t('Server-side apply')}
                              />
                            </FormSelect>
                          </FormGroup>
                        </GridItem>
                        <GridItem sm={12} md={6} xl={4}>
                          <FormGroup label={t('Field manager')} fieldId="gatekeeper-field-manager">
                            <TextInput
                              id="gatekeeper-field-manager"
                              value={fieldManager}
                              onChange={(_event, value) => setFieldManager(value)}
                              isDisabled={applyStrategy !== 'server_side'}
                            />
                          </FormGroup>
                        </GridItem>
                        <GridItem sm={12} md={6} xl={2}>
                          <FormGroup label={t('Conflicts')} fieldId="gatekeeper-force-conflicts">
                            <Checkbox
                              id="gatekeeper-force-conflicts"
                              label={t('Force')}
                              isChecked={forceConflicts}
                              onChange={(_event, checked) => setForceConflicts(checked)}
                              isDisabled={applyStrategy !== 'server_side'}
                            />
                          </FormGroup>
                        </GridItem>
                      </Grid>
                    </StackItem>
                    <StackItem>
                      <FormGroup label={t('Manifest')} fieldId="gatekeeper-apply-manifest">
                        <TextArea
                          id="gatekeeper-apply-manifest"
                          value={applyManifest}
                          rows={12}
                          onChange={(_event, value) => setApplyManifest(value)}
                          aria-label={t('Gatekeeper manifest')}
                          style={{ fontFamily: 'monospace' }}
                        />
                      </FormGroup>
                    </StackItem>
                    {applyMode === 'apply' ? (
                      <StackItem>
                        <Alert
                          isInline
                          variant="warning"
                          title={t(
                            'Apply persists the manifest if RBAC, OPA, and Kubernetes admission allow it.'
                          )}
                        />
                      </StackItem>
                    ) : null}
                    <StackItem>
                      <Button
                        variant={applyMode === 'apply' ? 'danger' : 'primary'}
                        onClick={() =>
                          applyMode === 'apply'
                            ? setConfirmLiveAction('apply')
                            : void handleApplyManifest()
                        }
                        isLoading={applyLoading}
                        isDisabled={applyLoading || !data.configured || !applyManifest.trim()}
                        data-cy="gatekeeper-apply-button"
                      >
                        {applyMode === 'preview'
                          ? t('Preview')
                          : applyMode === 'dry_run'
                            ? t('Dry-run')
                            : t('Apply')}
                      </Button>
                    </StackItem>
                    {applyError ? (
                      <StackItem>
                        <Alert variant="danger" isInline title={applyError} />
                      </StackItem>
                    ) : null}
                    {applyResult ? (
                      <StackItem>
                        <Alert
                          variant={
                            applyResult.persisted || applyResult.dry_run ? 'success' : 'info'
                          }
                          isInline
                          title={t('{{mode}} {{operation}} for {{kind}}/{{name}}.', {
                            mode: applyResult.mode,
                            operation: applyResult.operation,
                            kind: String(applyResult.target.kind ?? ''),
                            name: String(applyResult.target.name ?? ''),
                          })}
                          style={{ marginBottom: 12 }}
                        />
                        <GatekeeperAuditLink
                          audit={applyResult.audit}
                          dataCy="gatekeeper-apply-audit-link"
                          getPageUrl={getPageUrl}
                        />
                        <CodeBlock>
                          <CodeBlockCode>{jsonPreview(applyResult)}</CodeBlockCode>
                        </CodeBlock>
                      </StackItem>
                    ) : null}
                    <StackItem>
                      <Grid hasGutter>
                        <GridItem sm={12} md={4} xl={3}>
                          <FormGroup label={t('Delete mode')} fieldId="gatekeeper-delete-mode">
                            <FormSelect
                              id="gatekeeper-delete-mode"
                              value={deleteMode}
                              onChange={(_event, value) => setDeleteMode(String(value))}
                            >
                              <FormSelectOption value="preview" label={t('Preview')} />
                              <FormSelectOption value="dry_run" label={t('Dry-run')} />
                              {canManagePolicy ? (
                                <FormSelectOption value="delete" label={t('Delete')} />
                              ) : null}
                            </FormSelect>
                          </FormGroup>
                        </GridItem>
                        <GridItem sm={12} md={8} xl={9}>
                          <FormGroup label={t('Delete target')} fieldId="gatekeeper-delete-target">
                            <Stack hasGutter>
                              <StackItem>
                                {deleteTarget
                                  ? t('Selected resource: {{target}}', {
                                      target: gatekeeperTargetDisplay(deleteTarget),
                                    })
                                  : t('Manifest textarea resource')}
                              </StackItem>
                              <StackItem>
                                <Button
                                  variant="secondary"
                                  onClick={() => {
                                    setDeleteTarget(selectedDeleteTarget);
                                    setDeleteResult(null);
                                  }}
                                  isDisabled={!selectedDeleteTarget}
                                >
                                  {t('Use selected resource')}
                                </Button>{' '}
                                <Button
                                  variant="link"
                                  isInline
                                  onClick={() => {
                                    setDeleteTarget(undefined);
                                    setDeleteResult(null);
                                  }}
                                  isDisabled={!deleteTarget}
                                >
                                  {t('Use manifest instead')}
                                </Button>
                              </StackItem>
                            </Stack>
                          </FormGroup>
                        </GridItem>
                      </Grid>
                    </StackItem>
                    <StackItem>
                      <Button
                        variant={deleteMode === 'delete' ? 'danger' : 'secondary'}
                        onClick={() =>
                          deleteMode === 'delete'
                            ? setConfirmLiveAction('delete')
                            : void handleDeleteManifest()
                        }
                        isLoading={deleteLoading}
                        isDisabled={
                          deleteLoading ||
                          !data.configured ||
                          (!deleteTarget && !applyManifest.trim())
                        }
                        data-cy="gatekeeper-delete-button"
                      >
                        {deleteMode === 'preview'
                          ? t('Preview delete')
                          : deleteMode === 'dry_run'
                            ? t('Dry-run delete')
                            : t('Delete')}
                      </Button>
                    </StackItem>
                    {deleteError ? (
                      <StackItem>
                        <Alert variant="danger" isInline title={deleteError} />
                      </StackItem>
                    ) : null}
                    {deleteResult ? (
                      <StackItem>
                        <Alert
                          variant={
                            deleteResult.persisted || deleteResult.dry_run ? 'success' : 'info'
                          }
                          isInline
                          title={t('{{mode}} {{operation}} for {{kind}}/{{name}}.', {
                            mode: deleteResult.mode,
                            operation: deleteResult.operation,
                            kind: String(deleteResult.target.kind ?? ''),
                            name: String(deleteResult.target.name ?? ''),
                          })}
                          style={{ marginBottom: 12 }}
                        />
                        <GatekeeperAuditLink
                          audit={deleteResult.audit}
                          dataCy="gatekeeper-delete-audit-link"
                          getPageUrl={getPageUrl}
                        />
                        <CodeBlock>
                          <CodeBlockCode>{jsonPreview(deleteResult)}</CodeBlockCode>
                        </CodeBlock>
                      </StackItem>
                    ) : null}
                    <StackItem>
                      <Grid hasGutter>
                        <GridItem sm={12} md={4} xl={3}>
                          <FormGroup label={t('Rollback mode')} fieldId="gatekeeper-rollback-mode">
                            <FormSelect
                              id="gatekeeper-rollback-mode"
                              value={rollbackMode}
                              onChange={(_event, value) => setRollbackMode(String(value))}
                            >
                              <FormSelectOption value="preview" label={t('Preview')} />
                              <FormSelectOption value="dry_run" label={t('Dry-run')} />
                              {canManagePolicy ? (
                                <FormSelectOption value="apply" label={t('Apply')} />
                              ) : null}
                            </FormSelect>
                          </FormGroup>
                        </GridItem>
                      </Grid>
                    </StackItem>
                    <StackItem>
                      <FormGroup label={t('Rollback plan')} fieldId="gatekeeper-rollback-plan">
                        <TextArea
                          id="gatekeeper-rollback-plan"
                          value={rollbackPlan}
                          rows={8}
                          onChange={(_event, value) => setRollbackPlan(value)}
                          aria-label={t('Gatekeeper rollback plan')}
                          style={{ fontFamily: 'monospace' }}
                        />
                      </FormGroup>
                    </StackItem>
                    <StackItem>
                      <Button
                        variant={rollbackMode === 'apply' ? 'danger' : 'secondary'}
                        onClick={() =>
                          rollbackMode === 'apply'
                            ? setConfirmLiveAction('rollback')
                            : void handleRollback()
                        }
                        isLoading={rollbackLoading}
                        isDisabled={rollbackLoading || !data.configured || !rollbackPlan.trim()}
                        data-cy="gatekeeper-rollback-button"
                      >
                        {rollbackMode === 'preview'
                          ? t('Preview rollback')
                          : rollbackMode === 'dry_run'
                            ? t('Dry-run rollback')
                            : t('Apply rollback')}
                      </Button>
                    </StackItem>
                    {rollbackError ? (
                      <StackItem>
                        <Alert variant="danger" isInline title={rollbackError} />
                      </StackItem>
                    ) : null}
                    {rollbackResult ? (
                      <StackItem>
                        <Alert
                          variant={
                            rollbackResult.persisted || rollbackResult.dry_run ? 'success' : 'info'
                          }
                          isInline
                          title={t('{{mode}} {{operation}} for {{kind}}/{{name}}.', {
                            mode: rollbackResult.mode,
                            operation: rollbackResult.operation,
                            kind: String(rollbackResult.target.kind ?? ''),
                            name: String(rollbackResult.target.name ?? ''),
                          })}
                          style={{ marginBottom: 12 }}
                        />
                        <GatekeeperAuditLink
                          audit={rollbackResult.audit}
                          dataCy="gatekeeper-rollback-audit-link"
                          getPageUrl={getPageUrl}
                        />
                        <CodeBlock>
                          <CodeBlockCode>{jsonPreview(rollbackResult)}</CodeBlockCode>
                        </CodeBlock>
                      </StackItem>
                    ) : null}
                  </Stack>
                  {confirmLiveAction ? (
                    <Modal
                      titleIconVariant="danger"
                      title={gatekeeperLiveActionTitle(t, confirmLiveAction)}
                      variant={ModalVariant.small}
                      description={gatekeeperLiveActionDescription(t, confirmLiveAction)}
                      isOpen
                      onClose={() => setConfirmLiveAction(null)}
                      data-cy="gatekeeper-live-action-confirm-dialog"
                      actions={[
                        <Button
                          key="confirm"
                          variant="danger"
                          onClick={() => void handleConfirmLiveAction()}
                          data-cy="gatekeeper-live-action-confirm-button"
                          aria-label={t('Confirm Gatekeeper live action')}
                        >
                          {t('Confirm')}
                        </Button>,
                        <Button
                          key="cancel"
                          variant="link"
                          onClick={() => setConfirmLiveAction(null)}
                          data-cy="gatekeeper-live-action-cancel-button"
                        >
                          {t('Cancel')}
                        </Button>,
                      ]}
                    >
                      <DescriptionList isHorizontal isCompact>
                        <DescriptionListGroup>
                          <DescriptionListTerm>{t('Context')}</DescriptionListTerm>
                          <DescriptionListDescription>
                            {activeContext || t('Default')}
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                          <DescriptionListTerm>{t('Target')}</DescriptionListTerm>
                          <DescriptionListDescription>
                            {confirmLiveTarget}
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                      </DescriptionList>
                    </Modal>
                  ) : null}
                </CardBody>
              </Card>
            </StackItem>
          ) : null}
          {showOverview ? (
            <>
              <StackItem>
                <Card isFlat data-cy="gatekeeper-posture">
                  <CardHeader>
                    <CardTitle>{t('Admission policy posture')}</CardTitle>
                  </CardHeader>
                  <CardBody>
                    <Stack hasGutter>
                      <StackItem>
                        <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
                          <StatusLabel
                            ok={data.configured}
                            okText={t('Kubernetes API connected')}
                            failText={t('Kubernetes API unavailable')}
                          />
                          <StatusLabel
                            ok={data.errors.length === 0}
                            okText={t('Resource reads healthy')}
                            failText={t('{{count}} read errors', { count: data.errors.length })}
                          />
                        </span>
                      </StackItem>
                      <StackItem>
                        <div
                          style={{
                            display: 'grid',
                            gap: 16,
                            gridTemplateColumns: 'repeat(auto-fit, minmax(min(170px, 100%), 1fr))',
                          }}
                        >
                          <GatekeeperMetricTile
                            label={t('ConstraintTemplates')}
                            value={data.counts.constraint_templates}
                            detail={t('Available policy kinds')}
                          />
                          <GatekeeperMetricTile
                            label={t('Constraints')}
                            value={data.counts.constraints}
                            detail={t('Active admission policies')}
                          />
                          <GatekeeperMetricTile
                            label={t('Violations')}
                            value={data.counts.violations}
                            detail={t('{{count}} in the current filtered view', {
                              count: data.counts.filtered_violations,
                            })}
                            attention={data.counts.violations > 0}
                          />
                          <GatekeeperMetricTile
                            label={t('Configurations')}
                            value={data.counts.configs}
                            detail={t('Data sync and readiness resources')}
                          />
                        </div>
                      </StackItem>
                    </Stack>
                  </CardBody>
                </Card>
              </StackItem>
              <StackItem>
                <Grid hasGutter style={{ alignItems: 'stretch' }}>
                  <GridItem sm={12} xl={6}>
                    <Card isFlat style={{ height: '100%' }}>
                      <CardHeader>
                        <CardTitle>{t('Cluster connection')}</CardTitle>
                      </CardHeader>
                      <CardBody>
                        <DescriptionList isCompact>
                          <DescriptionListGroup>
                            <DescriptionListTerm>{t('Kubernetes API')}</DescriptionListTerm>
                            <DescriptionListDescription>
                              <span style={{ overflowWrap: 'anywhere' }}>
                                {data.cluster.server_url || t('Not configured')}
                              </span>
                            </DescriptionListDescription>
                          </DescriptionListGroup>
                          <DescriptionListGroup>
                            <DescriptionListTerm>{t('Context')}</DescriptionListTerm>
                            <DescriptionListDescription>
                              {data.cluster.context || t('Default')}
                            </DescriptionListDescription>
                          </DescriptionListGroup>
                          <DescriptionListGroup>
                            <DescriptionListTerm>{t('TLS verification')}</DescriptionListTerm>
                            <DescriptionListDescription>
                              {data.cluster.verify_ssl ? t('Enabled') : t('Disabled')}
                            </DescriptionListDescription>
                          </DescriptionListGroup>
                          <DescriptionListGroup>
                            <DescriptionListTerm>{t('Discovery errors')}</DescriptionListTerm>
                            <DescriptionListDescription>
                              {data.errors.length}
                            </DescriptionListDescription>
                          </DescriptionListGroup>
                        </DescriptionList>
                      </CardBody>
                    </Card>
                  </GridItem>
                  <GridItem sm={12} xl={6}>
                    <Card isFlat style={{ height: '100%' }}>
                      <CardHeader>
                        <CardTitle>{t('API coverage')}</CardTitle>
                      </CardHeader>
                      <CardBody>
                        <DescriptionList isCompact>
                          <DescriptionListGroup>
                            <DescriptionListTerm>{t('ConstraintTemplates')}</DescriptionListTerm>
                            <DescriptionListDescription>
                              {data.api_versions?.constraint_templates || t('Not discovered')}
                            </DescriptionListDescription>
                          </DescriptionListGroup>
                          <DescriptionListGroup>
                            <DescriptionListTerm>{t('Constraints')}</DescriptionListTerm>
                            <DescriptionListDescription>
                              {data.api_versions?.constraints?.join(', ') || t('Not discovered')}
                            </DescriptionListDescription>
                          </DescriptionListGroup>
                          <DescriptionListGroup>
                            <DescriptionListTerm>{t('Configurations')}</DescriptionListTerm>
                            <DescriptionListDescription>
                              {data.api_versions?.configs || t('Not discovered')}
                            </DescriptionListDescription>
                          </DescriptionListGroup>
                        </DescriptionList>
                      </CardBody>
                    </Card>
                  </GridItem>
                </Grid>
              </StackItem>
              <StackItem>
                <Card isFlat data-cy="gatekeeper-awx-workflow">
                  <CardHeader>
                    <CardTitle>{t('Operator work queues')}</CardTitle>
                  </CardHeader>
                  <CardBody>
                    <Table aria-label={t('Gatekeeper operator work queues')} variant="compact">
                      <Thead>
                        <Tr>
                          <Th width={25}>{t('Queue')}</Th>
                          <Th width={15}>{t('Items')}</Th>
                          <Th width={40}>{t('Purpose')}</Th>
                          <Th width={20}>{t('Action')}</Th>
                        </Tr>
                      </Thead>
                      <Tbody>
                        <Tr>
                          <Td dataLabel={t('Queue')}>{t('Violations')}</Td>
                          <Td dataLabel={t('Items')}>{data.counts.violations}</Td>
                          <Td dataLabel={t('Purpose')}>
                            {t('Triage out-of-policy resources and prepare governed remediation.')}
                          </Td>
                          <Td dataLabel={t('Action')}>
                            <Link to="/policy-as-code/gatekeeper/violations">
                              {t('Triage violations')}
                            </Link>
                          </Td>
                        </Tr>
                        <Tr>
                          <Td dataLabel={t('Queue')}>{t('Governed changes')}</Td>
                          <Td dataLabel={t('Items')}>{t('Preview first')}</Td>
                          <Td dataLabel={t('Purpose')}>
                            {t(
                              'Project-sync, preview, dry-run, apply, delete, or roll back manifests.'
                            )}
                          </Td>
                          <Td dataLabel={t('Action')}>
                            <Link to="/policy-as-code/gatekeeper/changes">
                              {t('Open governed changes')}
                            </Link>
                          </Td>
                        </Tr>
                        <Tr>
                          <Td dataLabel={t('Queue')}>{t('Policy inventory')}</Td>
                          <Td dataLabel={t('Items')}>
                            {data.counts.constraint_templates + data.counts.constraints}
                          </Td>
                          <Td dataLabel={t('Purpose')}>
                            {t('Inspect template schemas, constraints, enforcement, and status.')}
                          </Td>
                          <Td dataLabel={t('Action')}>
                            <Link to="/policy-as-code/gatekeeper/templates">
                              {t('Review templates')}
                            </Link>
                          </Td>
                        </Tr>
                        <Tr>
                          <Td dataLabel={t('Queue')}>{t('Audit evidence')}</Td>
                          <Td dataLabel={t('Items')}>{t('Activity Stream')}</Td>
                          <Td dataLabel={t('Purpose')}>
                            {t(
                              'Trace RBAC, OPA approval, Kubernetes admission, and rollback evidence.'
                            )}
                          </Td>
                          <Td dataLabel={t('Action')}>
                            <Link to={getPageUrl(AwxRoute.ActivityStream)}>
                              {t('Open Activity Stream')}
                            </Link>
                          </Td>
                        </Tr>
                      </Tbody>
                    </Table>
                  </CardBody>
                </Card>
              </StackItem>
            </>
          ) : null}
          {showTemplates ? (
            <StackItem>
              <Card isFlat>
                <CardHeader>
                  <CardTitle>{t('ConstraintTemplates')}</CardTitle>
                </CardHeader>
                <CardBody>
                  {data.constraint_templates.length === 0 ? (
                    t('No ConstraintTemplates found.')
                  ) : (
                    <Table aria-label={t('Gatekeeper ConstraintTemplates')} variant="compact">
                      <Thead>
                        <Tr>
                          <Th width={30}>{t('Name')}</Th>
                          <Th width={20}>{t('Status')}</Th>
                          <Th width={15}>{t('Constraints')}</Th>
                          <Th width={35}>{t('Targets')}</Th>
                        </Tr>
                      </Thead>
                      <Tbody>
                        {data.constraint_templates.map((template) => (
                          <Tr key={template.name}>
                            <Td dataLabel={t('Name')}>
                              <Button
                                variant="link"
                                isInline
                                onClick={() =>
                                  selectGatekeeperDetail({ type: 'template', name: template.name })
                                }
                              >
                                {template.name}
                              </Button>
                            </Td>
                            <Td dataLabel={t('Status')}>
                              <StatusLabel
                                ok={template.created}
                                okText={template.kind || t('Created')}
                                failText={t('Not created')}
                              />
                            </Td>
                            <Td dataLabel={t('Constraints')}>{template.constraint_count}</Td>
                            <Td dataLabel={t('Targets')}>
                              {template.targets
                                .map((target) => target.target || t('Unknown'))
                                .join(', ') || t('None')}
                            </Td>
                          </Tr>
                        ))}
                      </Tbody>
                    </Table>
                  )}
                </CardBody>
              </Card>
            </StackItem>
          ) : null}
          {showTemplates && selectedTemplate ? (
            <StackItem>
              <GatekeeperTemplateDetail
                template={selectedTemplate}
                onSelectConstraint={(kind, name) =>
                  selectGatekeeperDetail({ type: 'constraint', kind, name })
                }
              />
            </StackItem>
          ) : null}
          {showConstraints ? (
            <StackItem>
              <Card isFlat>
                <CardHeader>
                  <CardTitle>{t('Constraints')}</CardTitle>
                </CardHeader>
                <CardBody>
                  {data.constraints.length === 0 ? (
                    t('No Constraints found.')
                  ) : (
                    <Table aria-label={t('Gatekeeper constraints')} variant="compact">
                      <Thead>
                        <Tr>
                          <Th width={35}>{t('Policy')}</Th>
                          <Th width={20}>{t('Enforcement')}</Th>
                          <Th width={15}>{t('Violations')}</Th>
                          <Th width={30}>{t('Last audit')}</Th>
                        </Tr>
                      </Thead>
                      <Tbody>
                        {data.constraints.map((constraint) => (
                          <Tr key={`${constraint.kind}/${constraint.name}`}>
                            <Td dataLabel={t('Policy')}>
                              <Button
                                variant="link"
                                isInline
                                onClick={() =>
                                  selectGatekeeperDetail({
                                    type: 'constraint',
                                    kind: constraint.kind,
                                    name: constraint.name,
                                  })
                                }
                              >
                                {constraint.kind}/{constraint.name}
                              </Button>
                            </Td>
                            <Td dataLabel={t('Enforcement')}>
                              <EnforcementLabel action={constraint.enforcement_action} />
                            </Td>
                            <Td dataLabel={t('Violations')}>
                              <Label
                                color={constraint.total_violations > 0 ? 'red' : 'green'}
                                icon={
                                  constraint.total_violations > 0 ? (
                                    <ExclamationTriangleIcon />
                                  ) : (
                                    <CheckCircleIcon />
                                  )
                                }
                              >
                                {constraint.total_violations}
                              </Label>
                            </Td>
                            <Td dataLabel={t('Last audit')}>
                              {constraint.audit_timestamp || t('Not reported')}
                            </Td>
                          </Tr>
                        ))}
                      </Tbody>
                    </Table>
                  )}
                </CardBody>
              </Card>
            </StackItem>
          ) : null}
          {(showConstraints || showTemplates) && selectedConstraint ? (
            <StackItem>
              <GatekeeperConstraintDetail constraint={selectedConstraint} />
            </StackItem>
          ) : null}
          {showViolations ? (
            <StackItem>
              <Card isFlat>
                <CardHeader>
                  <CardTitle>{t('Violations')}</CardTitle>
                </CardHeader>
                <CardBody>
                  <Stack hasGutter>
                    <StackItem>
                      <Grid hasGutter>
                        <GridItem sm={12} lg={6}>
                          <FormGroup label={t('Search')} fieldId="gatekeeper-violation-search">
                            <SearchInput
                              id="gatekeeper-violation-search"
                              placeholder={t('Search violations')}
                              value={violationFilter}
                              onChange={(_event, value) => {
                                setViolationFilter(value);
                                setViolationPage(1);
                                syncGatekeeperRoute(
                                  {
                                    detail: selectedDetail,
                                    violationSearch: value,
                                    violationPage: 1,
                                  },
                                  true
                                );
                              }}
                              onClear={() => {
                                setViolationFilter('');
                                setViolationPage(1);
                                syncGatekeeperRoute(
                                  { detail: selectedDetail, violationSearch: '', violationPage: 1 },
                                  true
                                );
                              }}
                            />
                          </FormGroup>
                        </GridItem>
                        <GridItem sm={12} md={6} lg={3}>
                          <FormGroup label={t('Sort')} fieldId="gatekeeper-violation-sort">
                            <FormSelect
                              id="gatekeeper-violation-sort"
                              value={violationSort}
                              onChange={(_event, value) => {
                                const nextSort = String(value);
                                setViolationSort(nextSort);
                                setViolationPage(1);
                                syncGatekeeperRoute(
                                  {
                                    detail: selectedDetail,
                                    violationSort: nextSort,
                                    violationPage: 1,
                                  },
                                  true
                                );
                              }}
                            >
                              <FormSelectOption value="constraint" label={t('Constraint')} />
                              <FormSelectOption value="resource" label={t('Resource')} />
                              <FormSelectOption value="namespace" label={t('Namespace')} />
                              <FormSelectOption value="enforcement" label={t('Enforcement')} />
                            </FormSelect>
                          </FormGroup>
                        </GridItem>
                        <GridItem sm={12} md={6} lg={3}>
                          <FormGroup label={t('Per page')} fieldId="gatekeeper-violation-limit">
                            <FormSelect
                              id="gatekeeper-violation-limit"
                              value={violationLimit}
                              onChange={(_event, value) => {
                                const nextLimit = String(value);
                                setViolationLimit(nextLimit);
                                setViolationPage(1);
                                syncGatekeeperRoute(
                                  {
                                    detail: selectedDetail,
                                    violationLimit: nextLimit,
                                    violationPage: 1,
                                  },
                                  true
                                );
                              }}
                            >
                              {[25, 50, 100, 200].map((limit) => (
                                <FormSelectOption
                                  key={limit}
                                  value={String(limit)}
                                  label={String(limit)}
                                />
                              ))}
                            </FormSelect>
                          </FormGroup>
                        </GridItem>
                      </Grid>
                    </StackItem>
                    <StackItem>
                      {t(
                        'Page {{page}} of {{totalPages}} - {{returned}} of {{filtered}} matching violations shown.',
                        {
                          page: data.violation_query.page,
                          totalPages: data.violation_query.total_pages,
                          returned: data.violation_query.returned,
                          filtered: data.counts.filtered_violations,
                        }
                      )}
                    </StackItem>
                    <StackItem>
                      <PagePagination
                        itemCount={data.counts.filtered_violations}
                        page={data.violation_query.page}
                        perPage={data.violation_query.limit}
                        setPage={(page) => {
                          setViolationPage(page);
                          syncGatekeeperRoute({
                            detail: selectedDetail,
                            violationPage: page,
                          });
                        }}
                        setPerPage={(perPage) => {
                          const nextLimit = String(perPage);
                          setViolationLimit(nextLimit);
                          setViolationPage(1);
                          syncGatekeeperRoute(
                            {
                              detail: selectedDetail,
                              violationLimit: nextLimit,
                              violationPage: 1,
                            },
                            true
                          );
                        }}
                        perPageOptions={[25, 50, 100, 200].map((limit) => ({
                          title: String(limit),
                          value: limit,
                        }))}
                      />
                    </StackItem>
                    <StackItem>
                      {t('{{start}}-{{end}} of {{filtered}} matching violations.', {
                        start:
                          data.counts.filtered_violations === 0
                            ? 0
                            : data.violation_query.offset + 1,
                        end: data.violation_query.offset + data.violation_query.returned,
                        returned: data.violation_query.returned,
                        filtered: data.counts.filtered_violations,
                      })}
                    </StackItem>
                    <StackItem>
                      {data.violations.length === 0 ? (
                        t('No violations found.')
                      ) : (
                        <Table aria-label={t('Gatekeeper violations')} variant="compact">
                          <Thead>
                            <Tr>
                              <Th width={25}>{t('Resource')}</Th>
                              <Th width={25}>{t('Constraint')}</Th>
                              <Th width={15}>{t('Enforcement')}</Th>
                              <Th width={35}>{t('Message')}</Th>
                            </Tr>
                          </Thead>
                          <Tbody>
                            {data.violations.map((violation) => (
                              <Tr key={violationKey(violation)}>
                                <Td dataLabel={t('Resource')}>
                                  <Button
                                    variant="link"
                                    isInline
                                    onClick={() =>
                                      selectGatekeeperDetail({
                                        type: 'violation',
                                        key: violationKey(violation),
                                      })
                                    }
                                  >
                                    {violation.resource_namespace
                                      ? `${violation.resource_namespace}/${violation.resource_name}`
                                      : violation.resource_name || t('Unknown resource')}
                                  </Button>
                                  <div>{violation.resource_kind}</div>
                                </Td>
                                <Td dataLabel={t('Constraint')}>
                                  {violation.constraint_kind}/{violation.constraint_name}
                                </Td>
                                <Td dataLabel={t('Enforcement')}>
                                  <EnforcementLabel action={violation.enforcement_action} />
                                </Td>
                                <Td dataLabel={t('Message')}>{violation.message}</Td>
                              </Tr>
                            ))}
                          </Tbody>
                        </Table>
                      )}
                    </StackItem>
                  </Stack>
                </CardBody>
              </Card>
            </StackItem>
          ) : null}
          {showViolations && selectedViolation ? (
            <StackItem>
              <GatekeeperViolationDetail violation={selectedViolation} />
            </StackItem>
          ) : null}
          {showViolations && selectedViolation ? (
            <StackItem>
              <Card isFlat data-cy="gatekeeper-remediation-panel">
                <CardHeader>
                  <CardTitle>{t('AI remediation')}</CardTitle>
                </CardHeader>
                <CardBody>
                  <Stack hasGutter>
                    <StackItem>
                      {t(
                        'Ask AI to explain the selected violation and generate a safe metadata patch for the violating Kubernetes resource.'
                      )}
                    </StackItem>
                    <StackItem>
                      <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
                        <Button
                          variant="secondary"
                          icon={<MagicIcon />}
                          onClick={() => void handleRemediateViolation('preview')}
                          isLoading={remediationLoading}
                          isDisabled={remediationLoading || !data.configured}
                          data-cy="gatekeeper-remediation-suggest-button"
                        >
                          {t('Suggest remediation')}
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => void handleRemediateViolation('dry_run')}
                          isLoading={remediationLoading}
                          isDisabled={
                            remediationLoading ||
                            !data.configured ||
                            !remediationResult?.plan.can_apply
                          }
                          data-cy="gatekeeper-remediation-dry-run-button"
                        >
                          {t('Dry-run remediation')}
                        </Button>
                        {canManagePolicy ? (
                          <Button
                            variant="danger"
                            onClick={() => setConfirmLiveAction('remediation')}
                            isDisabled={
                              remediationLoading ||
                              !data.configured ||
                              !remediationResult?.plan.can_apply
                            }
                            data-cy="gatekeeper-remediation-apply-button"
                          >
                            {t('Apply remediation')}
                          </Button>
                        ) : null}
                      </span>
                    </StackItem>
                    {remediationError ? (
                      <StackItem>
                        <Alert variant="danger" isInline title={remediationError} />
                      </StackItem>
                    ) : null}
                    {remediationResult ? (
                      <>
                        <StackItem>
                          <Alert
                            variant={
                              remediationResult.persisted || remediationResult.dry_run
                                ? 'success'
                                : remediationResult.plan.can_apply
                                  ? 'info'
                                  : 'warning'
                            }
                            isInline
                            title={remediationResult.plan.summary}
                          >
                            {remediationResult.plan.rationale}
                          </Alert>
                        </StackItem>
                        <StackItem>
                          <DescriptionList isHorizontal isCompact>
                            <DescriptionListGroup>
                              <DescriptionListTerm>{t('Target')}</DescriptionListTerm>
                              <DescriptionListDescription>
                                {gatekeeperTargetDisplay(remediationResult.target)}
                              </DescriptionListDescription>
                            </DescriptionListGroup>
                            <DescriptionListGroup>
                              <DescriptionListTerm>{t('Risk')}</DescriptionListTerm>
                              <DescriptionListDescription>
                                {remediationResult.plan.risk}
                              </DescriptionListDescription>
                            </DescriptionListGroup>
                            <DescriptionListGroup>
                              <DescriptionListTerm>{t('Automatic patch')}</DescriptionListTerm>
                              <DescriptionListDescription>
                                {remediationResult.plan.can_apply
                                  ? t('Available')
                                  : t('Not available')}
                              </DescriptionListDescription>
                            </DescriptionListGroup>
                            <DescriptionListGroup>
                              <DescriptionListTerm>{t('Mode')}</DescriptionListTerm>
                              <DescriptionListDescription>
                                {remediationResult.mode}
                              </DescriptionListDescription>
                            </DescriptionListGroup>
                          </DescriptionList>
                        </StackItem>
                        <StackItem>
                          <GatekeeperAuditLink
                            audit={remediationResult.audit}
                            dataCy="gatekeeper-remediation-audit-link"
                            getPageUrl={getPageUrl}
                          />
                        </StackItem>
                        {remediationResult.plan.manual_steps.length > 0 ? (
                          <StackItem>
                            <CodeBlock>
                              <CodeBlockCode>
                                {remediationResult.plan.manual_steps.join('\n')}
                              </CodeBlockCode>
                            </CodeBlock>
                          </StackItem>
                        ) : null}
                        {remediationResult.plan.patch ? (
                          <StackItem>
                            <CodeBlock>
                              <CodeBlockCode>
                                {jsonPreview({
                                  patch_type: remediationResult.plan.patch_type,
                                  patch: remediationResult.plan.patch,
                                  diff: remediationResult.diff,
                                  opa_allowed: remediationResult.opa_allowed,
                                })}
                              </CodeBlockCode>
                            </CodeBlock>
                          </StackItem>
                        ) : null}
                      </>
                    ) : null}
                  </Stack>
                </CardBody>
              </Card>
            </StackItem>
          ) : null}
          {showConfigs ? (
            <StackItem>
              <Card isFlat>
                <CardHeader>
                  <CardTitle>{t('Config CRDs')}</CardTitle>
                </CardHeader>
                <CardBody>
                  {data.configs.length === 0 ? (
                    t('No Config CRDs found.')
                  ) : (
                    <Table aria-label={t('Gatekeeper configurations')} variant="compact">
                      <Thead>
                        <Tr>
                          <Th width={30}>{t('Name')}</Th>
                          <Th width={20}>{t('Synced kinds')}</Th>
                          <Th width={25}>{t('Readiness stats')}</Th>
                          <Th width={25}>{t('API version')}</Th>
                        </Tr>
                      </Thead>
                      <Tbody>
                        {data.configs.map((config) => (
                          <Tr key={config.name}>
                            <Td dataLabel={t('Name')}>
                              <Button
                                variant="link"
                                isInline
                                onClick={() =>
                                  selectGatekeeperDetail({ type: 'config', name: config.name })
                                }
                              >
                                {config.name}
                              </Button>
                            </Td>
                            <Td dataLabel={t('Synced kinds')}>{config.sync_only_count}</Td>
                            <Td dataLabel={t('Readiness stats')}>
                              <StatusLabel
                                ok={Boolean(config.readiness_stats_enabled)}
                                okText={t('Enabled')}
                                failText={t('Disabled')}
                              />
                            </Td>
                            <Td dataLabel={t('API version')}>{config.api_version}</Td>
                          </Tr>
                        ))}
                      </Tbody>
                    </Table>
                  )}
                </CardBody>
              </Card>
            </StackItem>
          ) : null}
          {showConfigs && selectedConfig ? (
            <StackItem>
              <GatekeeperConfigDetail config={selectedConfig} />
            </StackItem>
          ) : null}
          {confirmLiveAction && !showChanges ? (
            <Modal
              titleIconVariant="danger"
              title={gatekeeperLiveActionTitle(t, confirmLiveAction)}
              variant={ModalVariant.small}
              description={gatekeeperLiveActionDescription(t, confirmLiveAction)}
              isOpen
              onClose={() => setConfirmLiveAction(null)}
              data-cy="gatekeeper-live-action-confirm-dialog"
              actions={[
                <Button
                  key="confirm"
                  variant="danger"
                  onClick={() => void handleConfirmLiveAction()}
                  data-cy="gatekeeper-live-action-confirm-button"
                  aria-label={t('Confirm Gatekeeper live action')}
                >
                  {t('Confirm')}
                </Button>,
                <Button
                  key="cancel"
                  variant="link"
                  onClick={() => setConfirmLiveAction(null)}
                  data-cy="gatekeeper-live-action-cancel-button"
                >
                  {t('Cancel')}
                </Button>,
              ]}
            >
              <DescriptionList isHorizontal isCompact>
                <DescriptionListGroup>
                  <DescriptionListTerm>{t('Context')}</DescriptionListTerm>
                  <DescriptionListDescription>
                    {activeContext || t('Default')}
                  </DescriptionListDescription>
                </DescriptionListGroup>
                <DescriptionListGroup>
                  <DescriptionListTerm>{t('Target')}</DescriptionListTerm>
                  <DescriptionListDescription>{confirmLiveTarget}</DescriptionListDescription>
                </DescriptionListGroup>
              </DescriptionList>
            </Modal>
          ) : null}
        </Stack>
      )}
    </PageSection>
  );
}
