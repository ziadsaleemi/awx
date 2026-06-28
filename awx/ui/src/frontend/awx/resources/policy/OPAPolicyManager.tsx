import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Checkbox,
  ClipboardCopy,
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
  PageSection,
  Spinner,
  Stack,
  StackItem,
  TextInput,
} from '@patternfly/react-core';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  SyncAltIcon,
  TimesCircleIcon,
} from '@patternfly/react-icons';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useGetPageUrl } from '../../../../framework';
import { postRequest } from '../../../common/crud/Data';
import { useGet } from '../../../common/crud/useGet';
import { OPAPolicyManagementPanel } from '../../administration/settings/OPAPolicyManagementPanel';
import { awxAPI } from '../../common/api/awx-utils';
import { AwxRoute } from '../../main/AwxRoutes';

export type OPAPolicyManagerView =
  | 'overview'
  | 'modules'
  | 'decisions'
  | 'violations'
  | 'project-sync'
  | 'tester';

interface OPAPolicy {
  id: string;
  path: string;
  description: string;
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
  };
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
  allowed?: boolean | null;
  is_denial: boolean;
  project_source?: {
    project_id?: number;
    project_name?: string;
    file_path?: string;
  } | null;
  error?: string;
}

interface OPAActivityResponse {
  count: number;
  denial_count: number;
  decisions: OPAActivityEntry[];
  denials: OPAActivityEntry[];
}

interface ProjectSummary {
  id: number;
  name: string;
  scm_type?: string;
  scm_url?: string;
  scm_branch?: string;
  scm_revision?: string;
  status?: string;
}

interface ProjectListResponse {
  results: ProjectSummary[];
}

interface OPAProjectSyncResult {
  file_path: string;
  policy_id: string;
  mode: string;
  operation: string;
  changed: boolean;
  persisted: boolean;
  before_exists: boolean;
  after: OPAPolicyModuleSummary;
  audit?: { activity_stream_id?: number } | null;
}

interface OPAProjectSyncResponse {
  changed: boolean;
  persisted: boolean;
  dry_run: boolean;
  mode: string;
  policy_id_prefix: string;
  project: ProjectSummary;
  counts: {
    files: number;
    modules: number;
    created: number;
    updated: number;
    unchanged: number;
  };
  results: OPAProjectSyncResult[];
}

function dateLabel(value: string) {
  return value ? new Date(value).toLocaleString() : '';
}

function ActivityStreamLink(props: { id?: number | null; label?: string }) {
  const { t } = useTranslation();
  const getPageUrl = useGetPageUrl();
  if (!props.id) return null;
  return (
    <Link to={getPageUrl(AwxRoute.ActivityStream, { query: { id: props.id } })}>
      {props.label ?? t('Activity Stream #{{id}}', { id: props.id })}
    </Link>
  );
}

function StatusCard(props: {
  title: string;
  value: string | number;
  description: string;
  variant?: 'success' | 'warning' | 'danger' | 'default';
}) {
  const icon =
    props.variant === 'success' ? (
      <CheckCircleIcon />
    ) : props.variant === 'danger' || props.variant === 'warning' ? (
      <ExclamationTriangleIcon />
    ) : undefined;
  const color =
    props.variant === 'success'
      ? 'green'
      : props.variant === 'danger'
        ? 'red'
        : props.variant === 'warning'
          ? 'orange'
          : 'grey';
  return (
    <Card isFlat>
      <CardBody>
        <Stack>
          <StackItem>
            <Label color={color} icon={icon}>
              {props.title}
            </Label>
          </StackItem>
          <StackItem>
            <span style={{ display: 'block', fontSize: 28, fontWeight: 700, marginTop: 8 }}>
              {props.value}
            </span>
          </StackItem>
          <StackItem>
            <span>{props.description}</span>
          </StackItem>
        </Stack>
      </CardBody>
    </Card>
  );
}

function OPAOverview() {
  const { t } = useTranslation();
  const status = useGet<OPAStatusResponse>(awxAPI`/opa/policies/`);
  const modules = useGet<OPAPolicyModulesResponse>(awxAPI`/opa/policy-modules/`);
  const activity = useGet<OPAActivityResponse>(awxAPI`/opa/activity/?limit=25`);
  const decisionPaths = status.data?.policies?.length ?? 0;
  const liveModules = modules.data?.count ?? 0;
  const denials = activity.data?.denial_count ?? 0;

  return (
    <PageSection data-cy="opa-overview">
      <Stack hasGutter>
        <StackItem>
          <Grid hasGutter>
            <GridItem sm={12} lg={3}>
              <StatusCard
                title={t('OPA server')}
                value={status.data?.enabled ? t('Enabled') : t('Disabled')}
                description={status.data?.server_url || t('No OPA endpoint configured')}
                variant={status.data?.enabled ? 'success' : 'warning'}
              />
            </GridItem>
            <GridItem sm={12} lg={3}>
              <StatusCard
                title={t('Live modules')}
                value={liveModules}
                description={t('Rego modules currently available through OPA')}
                variant={liveModules ? 'success' : 'default'}
              />
            </GridItem>
            <GridItem sm={12} lg={3}>
              <StatusCard
                title={t('Decision paths')}
                value={decisionPaths}
                description={t('AWX guardrail checks registered for OPA')}
                variant={decisionPaths ? 'success' : 'default'}
              />
            </GridItem>
            <GridItem sm={12} lg={3}>
              <StatusCard
                title={t('Recent denials')}
                value={denials}
                description={t('Denied OPA decisions found in recent Activity Stream')}
                variant={denials ? 'danger' : 'success'}
              />
            </GridItem>
          </Grid>
        </StackItem>
        <StackItem>
          <Card isFlat>
            <CardHeader>
              <CardTitle>{t('OPA status')}</CardTitle>
            </CardHeader>
            <CardBody>
              {status.isLoading ? (
                <Spinner size="md" />
              ) : status.error ? (
                <Alert variant="danger" isInline title={t('Could not load OPA status.')} />
              ) : (
                <DescriptionList isHorizontal isCompact>
                  <DescriptionListGroup>
                    <DescriptionListTerm>{t('Server URL')}</DescriptionListTerm>
                    <DescriptionListDescription>
                      {status.data?.server_url ? (
                        <ClipboardCopy isReadOnly hoverTip={t('Copy')} clickTip={t('Copied')}>
                          {status.data.server_url}
                        </ClipboardCopy>
                      ) : (
                        t('Not configured')
                      )}
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                  <DescriptionListGroup>
                    <DescriptionListTerm>{t('Managed bundle')}</DescriptionListTerm>
                    <DescriptionListDescription>
                      {status.data?.policy_bundle?.configured
                        ? t('{{bytes}} bytes / {{lines}} lines', {
                            bytes: status.data.policy_bundle.size,
                            lines: status.data.policy_bundle.line_count ?? 0,
                          })
                        : t('No managed bundle configured')}
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                  <DescriptionListGroup>
                    <DescriptionListTerm>{t('Live policy API')}</DescriptionListTerm>
                    <DescriptionListDescription>
                      {modules.error
                        ? t('Unable to read live modules')
                        : modules.data?.enabled
                          ? t('{{count}} module(s)', { count: modules.data.count })
                          : t('Not configured')}
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                </DescriptionList>
              )}
            </CardBody>
          </Card>
        </StackItem>
        <StackItem>
          <OPAActivityList
            title={t('Recent OPA decisions')}
            entries={activity.data?.decisions ?? []}
            isLoading={activity.isLoading}
            error={Boolean(activity.error)}
            emptyText={t('No recent OPA decisions were found.')}
          />
        </StackItem>
      </Stack>
    </PageSection>
  );
}

function OPAActivityList(props: {
  title: string;
  entries: OPAActivityEntry[];
  isLoading: boolean;
  error: boolean;
  emptyText: string;
}) {
  const { t } = useTranslation();
  return (
    <Card isFlat data-cy="opa-activity-list">
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
      </CardHeader>
      <CardBody>
        {props.isLoading ? (
          <Spinner size="md" />
        ) : props.error ? (
          <Alert variant="danger" isInline title={t('Could not load OPA activity.')} />
        ) : props.entries.length === 0 ? (
          <span>{props.emptyText}</span>
        ) : (
          <Stack hasGutter>
            {props.entries.map((entry) => (
              <StackItem key={entry.activity_stream_id}>
                <Card isFlat isCompact>
                  <CardBody>
                    <Grid hasGutter>
                      <GridItem sm={12} lg={3}>
                        <Label
                          color={
                            entry.is_denial ? 'red' : entry.opa_allowed === true ? 'green' : 'blue'
                          }
                          icon={entry.is_denial ? <TimesCircleIcon /> : <CheckCircleIcon />}
                        >
                          {entry.is_denial
                            ? t('Denied')
                            : entry.opa_allowed === true
                              ? t('Allowed')
                              : entry.operation}
                        </Label>
                      </GridItem>
                      <GridItem sm={12} lg={3}>
                        <strong>{entry.policy_id || entry.object2 || t('OPA decision')}</strong>
                        <br />
                        <span>{entry.source || entry.object1}</span>
                      </GridItem>
                      <GridItem sm={12} lg={3}>
                        <span>{dateLabel(entry.timestamp)}</span>
                        <br />
                        <span>{entry.actor?.username ?? t('System')}</span>
                      </GridItem>
                      <GridItem sm={12} lg={3}>
                        <ActivityStreamLink id={entry.activity_stream_id} />
                      </GridItem>
                      {entry.project_source?.file_path ? (
                        <GridItem sm={12}>
                          <span>
                            {t('Project file')}: {entry.project_source.file_path}
                          </span>
                        </GridItem>
                      ) : null}
                      {entry.summary || entry.error ? (
                        <GridItem sm={12}>
                          <span>{entry.error || entry.summary}</span>
                        </GridItem>
                      ) : null}
                    </Grid>
                  </CardBody>
                </Card>
              </StackItem>
            ))}
          </Stack>
        )}
      </CardBody>
    </Card>
  );
}

function OPADecisions(props: { violationsOnly?: boolean }) {
  const { t } = useTranslation();
  const activity = useGet<OPAActivityResponse>(awxAPI`/opa/activity/?limit=100`);
  const entries = props.violationsOnly
    ? activity.data?.denials ?? []
    : activity.data?.decisions ?? [];
  return (
    <PageSection data-cy={props.violationsOnly ? 'opa-violations' : 'opa-decisions'}>
      <OPAActivityList
        title={props.violationsOnly ? t('OPA violations') : t('OPA decisions')}
        entries={entries}
        isLoading={activity.isLoading}
        error={Boolean(activity.error)}
        emptyText={
          props.violationsOnly
            ? t('No denied OPA decisions were found.')
            : t('No recent OPA decisions were found.')
        }
      />
    </PageSection>
  );
}

function OPAProjectSync() {
  const { t } = useTranslation();
  const projectsResponse = useGet<ProjectListResponse>(
    awxAPI`/projects/?page_size=200&order_by=name`
  );
  const projects = useMemo(
    () => projectsResponse.data?.results ?? [],
    [projectsResponse.data?.results]
  );
  const [projectId, setProjectId] = useState('');
  const [path, setPath] = useState('opa/**/*.rego');
  const [policyIdPrefix, setPolicyIdPrefix] = useState('');
  const [mode, setMode] = useState('preview');
  const [approved, setApproved] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [syncResult, setSyncResult] = useState<OPAProjectSyncResponse | null>(null);

  async function syncProject() {
    setIsSyncing(true);
    setSyncError('');
    setSyncResult(null);
    try {
      const result = await postRequest<
        OPAProjectSyncResponse,
        { project: number; path: string; policy_id_prefix: string; mode: string }
      >(awxAPI`/opa/policy-modules/project-sync/`, {
        project: Number(projectId),
        path,
        policy_id_prefix: policyIdPrefix,
        mode,
      });
      setSyncResult(result);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : t('OPA project sync failed.'));
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <PageSection data-cy="opa-project-sync">
      <Stack hasGutter>
        <StackItem>
          <Card isFlat>
            <CardHeader>
              <CardTitle>{t('Sync Rego from AWX Project')}</CardTitle>
            </CardHeader>
            <CardBody>
              <Stack hasGutter>
                <StackItem>
                  <Grid hasGutter>
                    <GridItem sm={12} lg={4}>
                      <FormGroup label={t('Project')} fieldId="opa-project-sync-project">
                        <FormSelect
                          id="opa-project-sync-project"
                          data-cy="opa-project-sync-project"
                          value={projectId}
                          onChange={(_event, value) => setProjectId(String(value))}
                          isDisabled={projectsResponse.isLoading || projects.length === 0}
                        >
                          <FormSelectOption value="" label={t('Select a project')} />
                          {projects.map((project) => (
                            <FormSelectOption
                              key={project.id}
                              value={String(project.id)}
                              label={project.name}
                            />
                          ))}
                        </FormSelect>
                      </FormGroup>
                    </GridItem>
                    <GridItem sm={12} lg={4}>
                      <FormGroup label={t('Rego path or glob')} fieldId="opa-project-sync-path">
                        <TextInput
                          id="opa-project-sync-path"
                          data-cy="opa-project-sync-path"
                          value={path}
                          onChange={(_event, value) => setPath(String(value))}
                        />
                      </FormGroup>
                    </GridItem>
                    <GridItem sm={12} lg={4}>
                      <FormGroup label={t('Policy ID prefix')} fieldId="opa-project-sync-prefix">
                        <TextInput
                          id="opa-project-sync-prefix"
                          data-cy="opa-project-sync-prefix"
                          value={policyIdPrefix}
                          placeholder={t('awx/projects/<project id>')}
                          onChange={(_event, value) => setPolicyIdPrefix(String(value))}
                        />
                      </FormGroup>
                    </GridItem>
                    <GridItem sm={12} lg={4}>
                      <FormGroup label={t('Sync mode')} fieldId="opa-project-sync-mode">
                        <FormSelect
                          id="opa-project-sync-mode"
                          data-cy="opa-project-sync-mode"
                          value={mode}
                          onChange={(_event, value) => {
                            setMode(String(value));
                            setApproved(false);
                          }}
                        >
                          <FormSelectOption value="preview" label={t('Preview')} />
                          <FormSelectOption value="dry_run" label={t('Dry run')} />
                          <FormSelectOption value="apply" label={t('Apply')} />
                        </FormSelect>
                      </FormGroup>
                    </GridItem>
                    <GridItem sm={12} lg={5} style={{ alignSelf: 'end' }}>
                      {mode === 'apply' ? (
                        <Checkbox
                          id="opa-project-sync-approved"
                          data-cy="opa-project-sync-approved"
                          label={t('Apply writes these Rego modules to OPA')}
                          isChecked={approved}
                          onChange={(_event, checked) => setApproved(checked)}
                        />
                      ) : null}
                    </GridItem>
                    <GridItem sm={12} lg={3} style={{ alignSelf: 'end' }}>
                      <Button
                        variant="primary"
                        icon={<SyncAltIcon />}
                        data-cy="opa-project-sync-button"
                        onClick={() => void syncProject()}
                        isLoading={isSyncing}
                        isDisabled={
                          isSyncing || !projectId || !path.trim() || (mode === 'apply' && !approved)
                        }
                      >
                        {mode === 'apply' ? t('Apply sync') : t('Run sync')}
                      </Button>
                    </GridItem>
                  </Grid>
                </StackItem>
                {projectsResponse.error ? (
                  <StackItem>
                    <Alert variant="danger" isInline title={t('Could not load AWX projects.')} />
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
                      variant={syncResult.changed ? 'success' : 'info'}
                      isInline
                      title={
                        syncResult.changed
                          ? t('OPA project sync applied.')
                          : t('OPA project sync completed with no persisted changes.')
                      }
                    />
                  </StackItem>
                ) : null}
              </Stack>
            </CardBody>
          </Card>
        </StackItem>
        {syncResult ? (
          <StackItem>
            <Card isFlat>
              <CardHeader>
                <CardTitle>
                  {t('Sync results for {{project}}', { project: syncResult.project.name })}
                </CardTitle>
              </CardHeader>
              <CardBody>
                <Stack hasGutter>
                  <StackItem>
                    <DescriptionList isHorizontal isCompact>
                      <DescriptionListGroup>
                        <DescriptionListTerm>{t('Policy prefix')}</DescriptionListTerm>
                        <DescriptionListDescription>
                          {syncResult.policy_id_prefix}
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                      <DescriptionListGroup>
                        <DescriptionListTerm>{t('Modules')}</DescriptionListTerm>
                        <DescriptionListDescription>
                          {t(
                            '{{count}} module(s), {{created}} created, {{updated}} updated, {{unchanged}} unchanged',
                            {
                              count: syncResult.counts.modules,
                              created: syncResult.counts.created,
                              updated: syncResult.counts.updated,
                              unchanged: syncResult.counts.unchanged,
                            }
                          )}
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                    </DescriptionList>
                  </StackItem>
                  {syncResult.results.map((result) => (
                    <StackItem key={`${result.file_path}-${result.policy_id}`}>
                      <Card isFlat isCompact>
                        <CardBody>
                          <Grid hasGutter>
                            <GridItem sm={12} lg={4}>
                              <strong>{result.file_path}</strong>
                              <br />
                              <span>{result.policy_id}</span>
                            </GridItem>
                            <GridItem sm={12} lg={3}>
                              <Label
                                color={
                                  result.operation === 'noop'
                                    ? 'grey'
                                    : result.persisted
                                      ? 'green'
                                      : 'blue'
                                }
                              >
                                {result.operation}
                              </Label>
                            </GridItem>
                            <GridItem sm={12} lg={3}>
                              <span>{result.after.package || t('No package found')}</span>
                              <br />
                              <span>
                                {t('{{count}} rule(s)', { count: result.after.rules.length })}
                              </span>
                            </GridItem>
                            <GridItem sm={12} lg={2}>
                              <ActivityStreamLink id={result.audit?.activity_stream_id} />
                            </GridItem>
                          </Grid>
                        </CardBody>
                      </Card>
                    </StackItem>
                  ))}
                </Stack>
              </CardBody>
            </Card>
          </StackItem>
        ) : null}
      </Stack>
    </PageSection>
  );
}

export function OPAPolicyManager(props: { view: OPAPolicyManagerView; canManagePolicy?: boolean }) {
  if (props.view === 'modules') {
    return (
      <OPAPolicyManagementPanel sections={['modules']} canManagePolicy={props.canManagePolicy} />
    );
  }
  if (props.view === 'tester') {
    return (
      <OPAPolicyManagementPanel sections={['tester']} canManagePolicy={props.canManagePolicy} />
    );
  }
  if (props.view === 'decisions') {
    return <OPADecisions />;
  }
  if (props.view === 'violations') {
    return <OPADecisions violationsOnly />;
  }
  if (props.view === 'project-sync') {
    return <OPAProjectSync />;
  }
  return <OPAOverview />;
}
