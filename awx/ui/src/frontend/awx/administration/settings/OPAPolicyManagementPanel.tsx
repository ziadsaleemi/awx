import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  ClipboardCopy,
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
  TextInput,
  Spinner,
  Stack,
  StackItem,
  TextArea,
} from '@patternfly/react-core';
import {
  CheckCircleIcon,
  PlusCircleIcon,
  SyncAltIcon,
  TimesCircleIcon,
  TrashIcon,
} from '@patternfly/react-icons';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useGetPageUrl } from '../../../../framework';
import { postRequest, requestDelete, requestGet } from '../../../common/crud/Data';
import { useGet } from '../../../common/crud/useGet';
import { awxAPI } from '../../common/api/awx-utils';
import { AwxRoute } from '../../main/AwxRoutes';

interface OPAPolicy {
  id: string;
  path: string;
  description: string;
  input_example?: Record<string, unknown>;
}

interface OPAStatusResponse {
  enabled: boolean;
  server_url: string;
  policies: OPAPolicy[];
  policy_bundle: {
    configured: boolean;
    size: number;
    line_count?: number;
    sha256?: string;
    sync_endpoint?: string;
  };
}

interface OPAEvalResponse {
  result: unknown;
  allowed: boolean;
  opa_response: unknown;
  detail?: string;
}

interface OPASyncResponse {
  changed: boolean;
  policy_id: string;
  size: number;
  line_count: number;
  sha256: string;
  opa_response: unknown;
}

interface OPAPolicyModuleSummary {
  id: string;
  package: string;
  rules: string[];
  decision_paths: string[];
  size: number;
  line_count: number;
  sha256: string;
  awx_managed: boolean;
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
}

interface OPAPolicyModuleSaveResponse {
  changed: boolean;
  created: boolean;
  module: OPAPolicyModuleDetail;
  previous_sha256: string;
  opa_response: unknown;
  audit?: OPAAuditRef;
}

interface OPAPolicyModuleDeleteResponse {
  changed: boolean;
  policy_id: string;
  previous?: OPAPolicyModuleSummary;
  opa_response: unknown;
  audit?: OPAAuditRef;
}

interface OPAAuditRef {
  activity_stream_id?: number;
  activity_stream_url?: string;
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

interface OPAPolicyModuleRollbackResponse {
  changed: boolean;
  policy_id: string;
  version: OPAPolicyModuleVersionSide;
  source_activity_stream_id: number;
  module: OPAPolicyModuleDetail;
  previous_sha256: string;
  restored_sha256: string;
  opa_response: unknown;
  audit?: OPAAuditRef;
}

const fallbackInput = {
  action: 'launch',
  source: 'api',
  user: { id: 1, username: 'admin', is_superuser: true },
  template: { id: 1, name: 'Deploy App', type: 'jobtemplate' },
};

const defaultModuleText = `package awx.job_launch

default allow := false

allow if {
  input.user.is_superuser
}
`;

function formatInput(policy?: OPAPolicy) {
  return JSON.stringify(policy?.input_example ?? fallbackInput, null, 2);
}

function formatVersionLabel(version: OPAPolicyModuleVersion) {
  const date = version.timestamp ? new Date(version.timestamp).toLocaleString() : '';
  return `#${version.activity_stream_id} - ${version.operation}${date ? ` - ${date}` : ''}`;
}

function OPAAuditLink(props: {
  audit?: OPAAuditRef | null;
  activityStreamId?: number | null;
  dataCy: string;
  getPageUrl: ReturnType<typeof useGetPageUrl>;
  label?: string;
}) {
  const { t } = useTranslation();
  const activityStreamId = props.audit?.activity_stream_id ?? props.activityStreamId;
  if (!activityStreamId) return null;
  return (
    <Link
      to={props.getPageUrl(AwxRoute.ActivityStream, {
        query: { id: activityStreamId },
      })}
      data-cy={props.dataCy}
    >
      {props.label ?? t('View Activity Stream #{{id}}', { id: activityStreamId })}
    </Link>
  );
}

type OPAPolicyManagementSection = 'status' | 'modules' | 'tester';

export function OPAPolicyManagementPanel(props?: {
  sections?: OPAPolicyManagementSection[];
  canManagePolicy?: boolean;
}) {
  const { t } = useTranslation();
  const getPageUrl = useGetPageUrl();
  const sections = props?.sections ?? ['status', 'modules', 'tester'];
  const canManagePolicy = props?.canManagePolicy ?? true;
  const showStatus = sections.includes('status');
  const showModules = sections.includes('modules');
  const showTester = sections.includes('tester');
  const { data, isLoading, error } = useGet<OPAStatusResponse>(awxAPI`/opa/policies/`);
  const modulesResponse = useGet<OPAPolicyModulesResponse>(
    showModules ? awxAPI`/opa/policy-modules/` : undefined
  );
  const policies = useMemo(() => data?.policies ?? [], [data?.policies]);
  const modules = useMemo(
    () => modulesResponse.data?.modules ?? [],
    [modulesResponse.data?.modules]
  );
  const [policyPath, setPolicyPath] = useState('awx/job_launch/allow');
  const [inputJson, setInputJson] = useState(() => JSON.stringify(fallbackInput, null, 2));
  const [evalResult, setEvalResult] = useState<OPAEvalResponse | null>(null);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [evalLoading, setEvalLoading] = useState(false);
  const [syncResult, setSyncResult] = useState<OPASyncResponse | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [selectedModuleId, setSelectedModuleId] = useState('');
  const [moduleAutoSelect, setModuleAutoSelect] = useState(true);
  const [moduleId, setModuleId] = useState('awx/managed');
  const [moduleText, setModuleText] = useState(defaultModuleText);
  const [moduleDetail, setModuleDetail] = useState<OPAPolicyModuleDetail | null>(null);
  const [moduleLoading, setModuleLoading] = useState(false);
  const [moduleSaving, setModuleSaving] = useState(false);
  const [moduleDeleting, setModuleDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [moduleError, setModuleError] = useState<string | null>(null);
  const [moduleResult, setModuleResult] = useState<string | null>(null);
  const [moduleAudit, setModuleAudit] = useState<OPAAuditRef | null>(null);
  const [moduleSourceAuditId, setModuleSourceAuditId] = useState<number | null>(null);
  const [moduleVersions, setModuleVersions] = useState<OPAPolicyModuleVersion[]>([]);
  const [moduleVersionsLoading, setModuleVersionsLoading] = useState(false);
  const [moduleVersionError, setModuleVersionError] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [selectedVersionSide, setSelectedVersionSide] =
    useState<OPAPolicyModuleVersionSide>('before');
  const [moduleRollbackLoading, setModuleRollbackLoading] = useState(false);
  const selectedVersion = useMemo(
    () =>
      moduleVersions.find((version) => String(version.activity_stream_id) === selectedVersionId),
    [moduleVersions, selectedVersionId]
  );
  const selectedVersionCanRestore =
    selectedVersionSide === 'before'
      ? Boolean(selectedVersion?.can_restore_before)
      : Boolean(selectedVersion?.can_restore_after);

  useEffect(() => {
    if (!policies.length) return;
    if (!policies.some((policy) => policy.path === policyPath)) {
      setPolicyPath(policies[0].path);
      setInputJson(formatInput(policies[0]));
    }
  }, [policies, policyPath]);

  useEffect(() => {
    if (!moduleAutoSelect || !modules.length || selectedModuleId) return;
    setSelectedModuleId(modules[0].id);
    setModuleAutoSelect(false);
  }, [moduleAutoSelect, modules, selectedModuleId]);

  useEffect(() => {
    if (!selectedModuleId) return;
    void loadModule(selectedModuleId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModuleId]);

  const selectPolicy = (path: string) => {
    const policy = policies.find((item) => item.path === path);
    setPolicyPath(path);
    setInputJson(formatInput(policy));
    setEvalResult(null);
    setEvalError(null);
  };

  async function loadModule(id: string) {
    setModuleLoading(true);
    setModuleError(null);
    setModuleResult(null);
    setModuleAudit(null);
    setModuleSourceAuditId(null);
    try {
      const detail = await requestGet<OPAPolicyModuleDetail>(awxAPI`/opa/policy-modules/${id}/`);
      setModuleDetail(detail);
      setModuleId(detail.id);
      setModuleText(detail.raw ?? '');
      void loadModuleVersions(detail.id);
    } catch (err) {
      setModuleError(
        err instanceof Error
          ? err.message
          : t('Policy module load failed. Check OPA settings and server connectivity.')
      );
    } finally {
      setModuleLoading(false);
    }
  }

  async function loadModuleVersions(id: string) {
    if (!id) return;
    setModuleVersionsLoading(true);
    setModuleVersionError(null);
    try {
      const response = await requestGet<OPAPolicyModuleVersionsResponse>(
        awxAPI`/opa/policy-modules/${id}/versions/`
      );
      const versions = response.versions ?? [];
      const restorable = versions.find(
        (version) => version.can_restore_before || version.can_restore_after
      );
      setModuleVersions(versions);
      if (restorable) {
        setSelectedVersionId(String(restorable.activity_stream_id));
        setSelectedVersionSide(restorable.can_restore_before ? 'before' : 'after');
      } else {
        setSelectedVersionId(versions[0] ? String(versions[0].activity_stream_id) : '');
        setSelectedVersionSide('before');
      }
    } catch (err) {
      setModuleVersions([]);
      setSelectedVersionId('');
      setModuleVersionError(
        err instanceof Error ? err.message : t('Policy module version history load failed.')
      );
    } finally {
      setModuleVersionsLoading(false);
    }
  }

  const newModule = () => {
    setModuleAutoSelect(false);
    setSelectedModuleId('');
    setModuleDetail(null);
    setModuleId('awx/new_policy');
    setModuleText(defaultModuleText);
    setModuleError(null);
    setModuleResult(null);
    setModuleAudit(null);
    setModuleSourceAuditId(null);
    setModuleVersions([]);
    setSelectedVersionId('');
    setModuleVersionError(null);
  };

  const handleSaveModule = async () => {
    setModuleSaving(true);
    setModuleError(null);
    setModuleResult(null);
    setModuleAudit(null);
    setModuleSourceAuditId(null);
    try {
      const response = await postRequest<
        OPAPolicyModuleSaveResponse,
        { policy_id: string; policy_text: string }
      >(awxAPI`/opa/policy-modules/`, {
        policy_id: moduleId,
        policy_text: moduleText,
      });
      setModuleDetail(response.module);
      setModuleAutoSelect(false);
      setSelectedModuleId(response.module.id);
      setModuleResult(
        response.created
          ? t('Policy module created and validated by OPA.')
          : t('Policy module updated and validated by OPA.')
      );
      setModuleAudit(response.audit ?? null);
      modulesResponse.refresh();
      void loadModuleVersions(response.module.id);
    } catch (err) {
      setModuleError(
        err instanceof Error
          ? err.message
          : t('Policy module save failed. OPA rejected the Rego or connection failed.')
      );
    } finally {
      setModuleSaving(false);
    }
  };

  const handleDeleteModule = async () => {
    if (!moduleId) return;
    setModuleDeleting(true);
    setModuleError(null);
    setModuleResult(null);
    setModuleAudit(null);
    setModuleSourceAuditId(null);
    try {
      const response = await requestDelete<OPAPolicyModuleDeleteResponse>(
        awxAPI`/opa/policy-modules/${moduleId}/`,
        new AbortController().signal
      );
      newModule();
      setModuleResult(
        t('Policy module {{policyId}} deleted from OPA.', { policyId: response.policy_id })
      );
      setModuleAudit(response.audit ?? null);
      setShowDeleteConfirm(false);
      modulesResponse.refresh();
    } catch (err) {
      setModuleError(
        err instanceof Error
          ? err.message
          : t('Policy module delete failed. Check OPA settings and server connectivity.')
      );
    } finally {
      setModuleDeleting(false);
    }
  };

  const handleRollbackModule = async () => {
    if (!moduleId || !selectedVersionId || !selectedVersionCanRestore) return;
    setModuleRollbackLoading(true);
    setModuleError(null);
    setModuleResult(null);
    setModuleAudit(null);
    setModuleSourceAuditId(null);
    try {
      const response = await postRequest<
        OPAPolicyModuleRollbackResponse,
        { activity_stream_id: number; version: OPAPolicyModuleVersionSide }
      >(awxAPI`/opa/policy-modules/${moduleId}/rollback/`, {
        activity_stream_id: Number(selectedVersionId),
        version: selectedVersionSide,
      });
      setModuleDetail(response.module);
      setModuleId(response.module.id);
      setModuleText(response.module.raw ?? '');
      setSelectedModuleId(response.module.id);
      setModuleResult(
        t('Policy module restored from Activity Stream #{{activityStreamId}}.', {
          activityStreamId: response.source_activity_stream_id,
        })
      );
      setModuleAudit(response.audit ?? null);
      setModuleSourceAuditId(response.source_activity_stream_id);
      modulesResponse.refresh();
      void loadModuleVersions(response.module.id);
    } catch (err) {
      setModuleError(
        err instanceof Error
          ? err.message
          : t('Policy module rollback failed. Check OPA settings and version history.')
      );
    } finally {
      setModuleRollbackLoading(false);
    }
  };

  const handleEvaluate = async () => {
    setEvalLoading(true);
    setEvalError(null);
    setEvalResult(null);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(inputJson);
      } catch {
        setEvalError(t('Input JSON is invalid.'));
        return;
      }
      const response = await postRequest<OPAEvalResponse, { policy_path: string; input: unknown }>(
        awxAPI`/opa/evaluate/`,
        { policy_path: policyPath, input: parsed }
      );
      setEvalResult(response);
    } catch {
      setEvalError(t('Policy evaluation failed. Check OPA settings and server connectivity.'));
    } finally {
      setEvalLoading(false);
    }
  };

  const handleSync = async () => {
    setSyncLoading(true);
    setSyncError(null);
    setSyncResult(null);
    try {
      const response = await postRequest<OPASyncResponse, { policy_id: string }>(
        awxAPI`/opa/policies/sync/`,
        { policy_id: 'awx/managed' }
      );
      setSyncResult(response);
    } catch {
      setSyncError(t('Policy bundle sync failed. Check OPA settings and server connectivity.'));
    } finally {
      setSyncLoading(false);
    }
  };

  return (
    <PageSection data-cy="opa-policy-management">
      <Stack hasGutter>
        {showStatus ? (
          <StackItem>
            <Card isFlat>
              <CardHeader>
                <CardTitle>{t('OPA Status')}</CardTitle>
              </CardHeader>
              <CardBody>
                {isLoading ? (
                  <Spinner size="md" />
                ) : error ? (
                  <Alert variant="danger" isInline title={t('Could not load OPA policy status.')} />
                ) : (
                  <Stack hasGutter>
                    <StackItem>
                      <DescriptionList isHorizontal isCompact>
                        <DescriptionListGroup>
                          <DescriptionListTerm>{t('Enforcement')}</DescriptionListTerm>
                          <DescriptionListDescription>
                            {data?.enabled ? (
                              <Label color="green" icon={<CheckCircleIcon />}>
                                {t('Enabled')}
                              </Label>
                            ) : (
                              <Label color="grey" icon={<TimesCircleIcon />}>
                                {t('Disabled')}
                              </Label>
                            )}
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                          <DescriptionListTerm>{t('OPA server')}</DescriptionListTerm>
                          <DescriptionListDescription>
                            {data?.server_url ? (
                              <ClipboardCopy isReadOnly hoverTip={t('Copy')} clickTip={t('Copied')}>
                                {data.server_url}
                              </ClipboardCopy>
                            ) : (
                              t('Not configured')
                            )}
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                          <DescriptionListTerm>{t('Managed policy bundle')}</DescriptionListTerm>
                          <DescriptionListDescription>
                            {data?.policy_bundle?.configured
                              ? t('{{bytes}} bytes / {{lines}} lines configured', {
                                  bytes: data.policy_bundle.size,
                                  lines: data.policy_bundle.line_count ?? 0,
                                })
                              : t('No bundle text configured')}
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                        {data?.policy_bundle?.sha256 ? (
                          <DescriptionListGroup>
                            <DescriptionListTerm>{t('Bundle checksum')}</DescriptionListTerm>
                            <DescriptionListDescription>
                              <ClipboardCopy isReadOnly hoverTip={t('Copy')} clickTip={t('Copied')}>
                                {data.policy_bundle.sha256}
                              </ClipboardCopy>
                            </DescriptionListDescription>
                          </DescriptionListGroup>
                        ) : null}
                        <DescriptionListGroup>
                          <DescriptionListTerm>{t('Decision paths')}</DescriptionListTerm>
                          <DescriptionListDescription>{policies.length}</DescriptionListDescription>
                        </DescriptionListGroup>
                      </DescriptionList>
                    </StackItem>
                    {canManagePolicy ? (
                      <StackItem>
                        <Button
                          variant="secondary"
                          icon={<SyncAltIcon />}
                          onClick={() => void handleSync()}
                          isLoading={syncLoading}
                          isDisabled={
                            syncLoading || !data?.enabled || !data?.policy_bundle?.configured
                          }
                        >
                          {t('Sync policy bundle to OPA')}
                        </Button>
                      </StackItem>
                    ) : null}
                    {syncError ? (
                      <StackItem>
                        <Alert variant="danger" isInline title={syncError} />
                      </StackItem>
                    ) : null}
                    {syncResult ? (
                      <StackItem>
                        <Alert
                          variant="success"
                          isInline
                          title={t('Policy bundle synced to {{policyId}}.', {
                            policyId: syncResult.policy_id,
                          })}
                        />
                      </StackItem>
                    ) : null}
                  </Stack>
                )}
              </CardBody>
            </Card>
          </StackItem>
        ) : null}
        {showModules ? (
          <StackItem>
            <Card isFlat>
              <CardHeader>
                <CardTitle>{t('Live OPA Policy Modules')}</CardTitle>
              </CardHeader>
              <CardBody>
                {modulesResponse.isLoading ? (
                  <Spinner size="md" />
                ) : modulesResponse.error ? (
                  <Alert
                    variant="danger"
                    isInline
                    title={t('Could not load live OPA policy modules.')}
                  />
                ) : !modulesResponse.data?.enabled ? (
                  <Alert variant="warning" isInline title={t('OPA server is not configured.')} />
                ) : (
                  <Stack hasGutter>
                    <StackItem>
                      <Grid hasGutter data-cy="opa-module-toolbar">
                        <GridItem sm={12} lg={8}>
                          <FormGroup label={t('Loaded module')} fieldId="opa-module-select">
                            <FormSelect
                              id="opa-module-select"
                              value={selectedModuleId}
                              onChange={(_event, value) => {
                                setModuleAutoSelect(false);
                                setSelectedModuleId(String(value));
                              }}
                              isDisabled={moduleLoading || modules.length === 0}
                            >
                              {modules.length === 0 ? (
                                <FormSelectOption value="" label={t('No live modules found')} />
                              ) : null}
                              {modules.map((module) => (
                                <FormSelectOption
                                  key={module.id}
                                  value={module.id}
                                  label={`${module.id}${module.package ? ` - ${module.package}` : ''}`}
                                />
                              ))}
                            </FormSelect>
                          </FormGroup>
                        </GridItem>
                        <GridItem sm={12} lg={4} style={{ alignSelf: 'end' }}>
                          <Button variant="secondary" icon={<PlusCircleIcon />} onClick={newModule}>
                            {t('New module')}
                          </Button>{' '}
                          <Button
                            variant="secondary"
                            icon={<SyncAltIcon />}
                            onClick={() => modulesResponse.refresh()}
                            isDisabled={modulesResponse.isLoading}
                          >
                            {t('Refresh modules')}
                          </Button>
                        </GridItem>
                      </Grid>
                    </StackItem>
                    <StackItem>
                      <FormGroup label={t('Policy ID')} fieldId="opa-module-id">
                        <TextInput
                          id="opa-module-id"
                          value={moduleId}
                          onChange={(_event, value) => setModuleId(value)}
                          aria-label={t('Policy ID')}
                        />
                      </FormGroup>
                    </StackItem>
                    <StackItem>
                      <FormGroup label={t('Rego module')} fieldId="opa-module-text">
                        <TextArea
                          id="opa-module-text"
                          value={moduleText}
                          rows={16}
                          onChange={(_event, value) => setModuleText(value)}
                          aria-label={t('Rego module')}
                          style={{ fontFamily: 'monospace' }}
                        />
                      </FormGroup>
                    </StackItem>
                    <StackItem>
                      <Button
                        variant="primary"
                        onClick={() => void handleSaveModule()}
                        isLoading={moduleSaving}
                        isDisabled={moduleSaving || !moduleId || !moduleText.trim()}
                      >
                        {t('Save to OPA')}
                      </Button>{' '}
                      <Button
                        variant="danger"
                        icon={<TrashIcon />}
                        onClick={() => setShowDeleteConfirm(true)}
                        isLoading={moduleDeleting}
                        isDisabled={moduleDeleting || !moduleDetail?.id}
                        data-cy="opa-module-delete-button"
                      >
                        {t('Delete from OPA')}
                      </Button>
                    </StackItem>
                    {moduleError ? (
                      <StackItem>
                        <Alert variant="danger" isInline title={moduleError} />
                      </StackItem>
                    ) : null}
                    {moduleResult ? (
                      <StackItem>
                        <Alert variant="success" isInline title={moduleResult} />
                        {moduleAudit?.activity_stream_id ? (
                          <div style={{ marginTop: 8 }}>
                            <OPAAuditLink
                              audit={moduleAudit}
                              dataCy="opa-module-action-audit-link"
                              getPageUrl={getPageUrl}
                            />
                          </div>
                        ) : null}
                        {moduleSourceAuditId ? (
                          <div style={{ marginTop: 8 }}>
                            <OPAAuditLink
                              activityStreamId={moduleSourceAuditId}
                              dataCy="opa-module-rollback-source-audit-link"
                              getPageUrl={getPageUrl}
                              label={t('View restored snapshot #{{id}}', {
                                id: moduleSourceAuditId,
                              })}
                            />
                          </div>
                        ) : null}
                      </StackItem>
                    ) : null}
                    {moduleDetail ? (
                      <StackItem>
                        <Grid hasGutter data-cy="opa-module-metadata-grid">
                          <GridItem sm={12} xl={6}>
                            <DescriptionList isHorizontal isCompact>
                              <DescriptionListGroup>
                                <DescriptionListTerm>{t('Package')}</DescriptionListTerm>
                                <DescriptionListDescription>
                                  {moduleDetail.package || t('Not detected')}
                                </DescriptionListDescription>
                              </DescriptionListGroup>
                              <DescriptionListGroup>
                                <DescriptionListTerm>{t('Rules')}</DescriptionListTerm>
                                <DescriptionListDescription>
                                  {moduleDetail.rules.length
                                    ? moduleDetail.rules.join(', ')
                                    : t('Not detected')}
                                </DescriptionListDescription>
                              </DescriptionListGroup>
                              <DescriptionListGroup>
                                <DescriptionListTerm>{t('Decision paths')}</DescriptionListTerm>
                                <DescriptionListDescription>
                                  {moduleDetail.decision_paths.length
                                    ? moduleDetail.decision_paths.join(', ')
                                    : t('Not detected')}
                                </DescriptionListDescription>
                              </DescriptionListGroup>
                              <DescriptionListGroup>
                                <DescriptionListTerm>{t('Checksum')}</DescriptionListTerm>
                                <DescriptionListDescription>
                                  <ClipboardCopy
                                    isReadOnly
                                    hoverTip={t('Copy')}
                                    clickTip={t('Copied')}
                                  >
                                    {moduleDetail.sha256}
                                  </ClipboardCopy>
                                </DescriptionListDescription>
                              </DescriptionListGroup>
                            </DescriptionList>
                          </GridItem>
                          <GridItem sm={12} xl={6}>
                            <Stack hasGutter>
                              <StackItem>
                                <FormGroup
                                  label={t('Version history')}
                                  fieldId="opa-module-version"
                                >
                                  {moduleVersionsLoading ? (
                                    <Spinner size="md" />
                                  ) : (
                                    <FormSelect
                                      id="opa-module-version"
                                      value={selectedVersionId}
                                      onChange={(_event, value) => {
                                        const nextId = String(value);
                                        const nextVersion = moduleVersions.find(
                                          (version) => String(version.activity_stream_id) === nextId
                                        );
                                        setSelectedVersionId(nextId);
                                        setSelectedVersionSide(
                                          nextVersion?.can_restore_before ? 'before' : 'after'
                                        );
                                      }}
                                      isDisabled={
                                        moduleVersions.length === 0 || moduleRollbackLoading
                                      }
                                    >
                                      {moduleVersions.length === 0 ? (
                                        <FormSelectOption
                                          value=""
                                          label={t('No audited versions found')}
                                        />
                                      ) : null}
                                      {moduleVersions.map((version) => (
                                        <FormSelectOption
                                          key={version.activity_stream_id}
                                          value={String(version.activity_stream_id)}
                                          label={formatVersionLabel(version)}
                                        />
                                      ))}
                                    </FormSelect>
                                  )}
                                </FormGroup>
                              </StackItem>
                              {moduleVersionError ? (
                                <StackItem>
                                  <Alert variant="danger" isInline title={moduleVersionError} />
                                </StackItem>
                              ) : null}
                              {selectedVersion ? (
                                <StackItem>
                                  <DescriptionList isHorizontal isCompact>
                                    <DescriptionListGroup>
                                      <DescriptionListTerm>
                                        {t('Activity Stream')}
                                      </DescriptionListTerm>
                                      <DescriptionListDescription>
                                        <OPAAuditLink
                                          activityStreamId={selectedVersion.activity_stream_id}
                                          dataCy="opa-module-selected-version-audit-link"
                                          getPageUrl={getPageUrl}
                                        />
                                      </DescriptionListDescription>
                                    </DescriptionListGroup>
                                    <DescriptionListGroup>
                                      <DescriptionListTerm>{t('Changed by')}</DescriptionListTerm>
                                      <DescriptionListDescription>
                                        {selectedVersion.actor?.username ?? t('Unknown')}
                                      </DescriptionListDescription>
                                    </DescriptionListGroup>
                                    <DescriptionListGroup>
                                      <DescriptionListTerm>
                                        {t('Before checksum')}
                                      </DescriptionListTerm>
                                      <DescriptionListDescription>
                                        {selectedVersion.before?.sha256 || t('None')}
                                      </DescriptionListDescription>
                                    </DescriptionListGroup>
                                    <DescriptionListGroup>
                                      <DescriptionListTerm>
                                        {t('After checksum')}
                                      </DescriptionListTerm>
                                      <DescriptionListDescription>
                                        {selectedVersion.after?.sha256 || t('None')}
                                      </DescriptionListDescription>
                                    </DescriptionListGroup>
                                  </DescriptionList>
                                </StackItem>
                              ) : null}
                              <StackItem>
                                <Grid hasGutter>
                                  <GridItem sm={12} lg={8}>
                                    <FormGroup
                                      label={t('Restore snapshot')}
                                      fieldId="opa-module-restore"
                                    >
                                      <FormSelect
                                        id="opa-module-restore"
                                        value={selectedVersionSide}
                                        onChange={(_event, value) =>
                                          setSelectedVersionSide(
                                            String(value) as OPAPolicyModuleVersionSide
                                          )
                                        }
                                        isDisabled={!selectedVersion || moduleRollbackLoading}
                                      >
                                        <FormSelectOption
                                          value="before"
                                          label={t('Before change')}
                                          isDisabled={!selectedVersion?.can_restore_before}
                                        />
                                        <FormSelectOption
                                          value="after"
                                          label={t('After change')}
                                          isDisabled={!selectedVersion?.can_restore_after}
                                        />
                                      </FormSelect>
                                    </FormGroup>
                                  </GridItem>
                                  <GridItem sm={12} lg={4} style={{ alignSelf: 'end' }}>
                                    <Button
                                      variant="secondary"
                                      onClick={() => void handleRollbackModule()}
                                      isLoading={moduleRollbackLoading}
                                      isDisabled={
                                        moduleRollbackLoading || !selectedVersionCanRestore
                                      }
                                    >
                                      {t('Rollback version')}
                                    </Button>
                                  </GridItem>
                                </Grid>
                              </StackItem>
                            </Stack>
                          </GridItem>
                        </Grid>
                      </StackItem>
                    ) : null}
                  </Stack>
                )}
              </CardBody>
            </Card>
          </StackItem>
        ) : null}
        {showTester ? (
          <StackItem>
            <Card isFlat>
              <CardHeader>
                <CardTitle>{t('Policy Tester')}</CardTitle>
              </CardHeader>
              <CardBody>
                <Grid hasGutter data-cy="opa-policy-tester-grid">
                  <GridItem sm={12} xl={5}>
                    <Stack hasGutter>
                      <StackItem>
                        <FormGroup label={t('Decision path')} fieldId="opa-policy-path">
                          <FormSelect
                            id="opa-policy-path"
                            value={policyPath}
                            onChange={(_event, value) => selectPolicy(String(value))}
                            isDisabled={isLoading || policies.length === 0}
                          >
                            {policies.map((policy) => (
                              <FormSelectOption
                                key={policy.path}
                                value={policy.path}
                                label={`${policy.id} - ${policy.path}`}
                              />
                            ))}
                          </FormSelect>
                        </FormGroup>
                      </StackItem>
                      <StackItem>
                        <FormGroup label={t('Input JSON')} fieldId="opa-input-json">
                          <TextArea
                            id="opa-input-json"
                            value={inputJson}
                            rows={10}
                            onChange={(_event, value) => setInputJson(value)}
                            aria-label={t('Input JSON')}
                            style={{ fontFamily: 'monospace' }}
                          />
                        </FormGroup>
                      </StackItem>
                      <StackItem>
                        <Button
                          variant="primary"
                          onClick={() => void handleEvaluate()}
                          isLoading={evalLoading}
                          isDisabled={evalLoading || !policyPath}
                        >
                          {t('Evaluate')}
                        </Button>
                      </StackItem>
                    </Stack>
                  </GridItem>
                  <GridItem sm={12} xl={7}>
                    <Stack hasGutter>
                      {evalError ? (
                        <StackItem>
                          <Alert variant="danger" isInline title={evalError} />
                        </StackItem>
                      ) : null}
                      {evalResult ? (
                        <StackItem>
                          <Alert
                            variant={evalResult.allowed ? 'success' : 'danger'}
                            isInline
                            title={evalResult.allowed ? t('Decision: Allow') : t('Decision: Deny')}
                            style={{ marginBottom: 12 }}
                          />
                          <CodeBlock>
                            <CodeBlockCode>
                              {JSON.stringify(evalResult.opa_response ?? evalResult, null, 2)}
                            </CodeBlockCode>
                          </CodeBlock>
                        </StackItem>
                      ) : null}
                    </Stack>
                  </GridItem>
                </Grid>
              </CardBody>
            </Card>
          </StackItem>
        ) : null}
      </Stack>
      {showDeleteConfirm ? (
        <Modal
          titleIconVariant="danger"
          title={t('Delete OPA policy module')}
          variant={ModalVariant.small}
          description={t(
            'This removes the live policy module from OPA. The current Rego snapshot is kept in Activity Stream version history for rollback.'
          )}
          isOpen
          onClose={() => setShowDeleteConfirm(false)}
          data-cy="opa-module-delete-confirm-dialog"
          actions={[
            <Button
              key="delete"
              variant="danger"
              onClick={() => void handleDeleteModule()}
              isLoading={moduleDeleting}
              isDisabled={moduleDeleting}
              data-cy="opa-module-delete-confirm-button"
              aria-label={t('Confirm delete')}
            >
              {t('Delete from OPA')}
            </Button>,
            <Button
              key="cancel"
              variant="link"
              onClick={() => setShowDeleteConfirm(false)}
              isDisabled={moduleDeleting}
              data-cy="opa-module-delete-cancel-button"
            >
              {t('Cancel')}
            </Button>,
          ]}
        >
          <ClipboardCopy isReadOnly hoverTip={t('Copy')} clickTip={t('Copied')}>
            {moduleId}
          </ClipboardCopy>
        </Modal>
      ) : null}
    </PageSection>
  );
}
