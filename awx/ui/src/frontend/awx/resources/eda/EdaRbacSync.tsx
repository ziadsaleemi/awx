import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  ButtonVariant,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Gallery,
  GalleryItem,
  Spinner,
} from '@patternfly/react-core';
import { SyncAltIcon } from '@patternfly/react-icons';
import { PageHeader, PageLayout, usePageAlertToaster } from '../../../../framework';
import { postRequest } from '../../../common/crud/Data';
import { useGet } from '../../../common/crud/useGet';
import { AwxError } from '../../common/AwxError';
import { awxAPI } from '../../common/api/awx-utils';
import { useAwxActiveUser } from '../../common/useAwxActiveUser';
import { useAwxNavigationCapabilities } from '../../main/awxNavigationCapabilities';

interface EdaRbacSummary {
  awx_organizations?: number;
  desired_assignments?: number;
  current_assignments?: number;
  missing_assignments?: number;
  extra_assignments?: number;
  missing_identities?: number;
  actions?: number;
  errors?: number;
}

interface EdaRbacAssignment {
  actor_type?: string;
  actor_name?: string;
  eda_actor_name?: string;
  awx_organization_name?: string;
  eda_organization_name?: string;
  awx_role_label?: string;
  eda_role_name?: string;
  content_type?: string;
}

interface EdaRbacIdentity {
  name?: string;
  awx_organization_name?: string;
  content_type?: string;
}

interface EdaRbacAction {
  action?: string;
  resource?: string;
  actor_type?: string;
  actor_name?: string;
  eda_role_name?: string;
  eda_organization_name?: string;
  id?: string | number;
}

interface EdaRbacError {
  action?: string;
  name?: string;
  username?: string;
  detail?: string;
}

interface EdaRbacSyncReport {
  source: 'eda_controller' | 'not_configured';
  mode: 'observe' | 'sync' | 'enforce';
  summary: EdaRbacSummary;
  missing_identities: {
    organizations?: EdaRbacIdentity[];
    users?: EdaRbacIdentity[];
    teams?: EdaRbacIdentity[];
    role_definitions?: EdaRbacIdentity[];
  };
  desired_assignments: EdaRbacAssignment[];
  missing_assignments: EdaRbacAssignment[];
  extra_assignments: EdaRbacAssignment[];
  actions: EdaRbacAction[];
  errors: EdaRbacError[];
}

export function EdaRbacSync() {
  const { t } = useTranslation();
  const alertToaster = usePageAlertToaster();
  const { activeAwxUser } = useAwxActiveUser();
  const capabilities = useAwxNavigationCapabilities(activeAwxUser);
  const canManageEda = Boolean(activeAwxUser?.is_superuser) || Boolean(capabilities.canManageEda);
  const [isApplying, setIsApplying] = useState(false);
  const {
    data: report,
    error,
    isLoading,
    refresh,
  } = useGet<EdaRbacSyncReport>(awxAPI`/eda/rbac-sync/`);

  const runSync = async (mode: 'sync' | 'enforce') => {
    setIsApplying(true);
    try {
      const result = await postRequest<EdaRbacSyncReport>(awxAPI`/eda/rbac-sync/`, {
        mode,
        create_missing_identities: true,
      });
      alertToaster.addAlert({
        variant: result.errors?.length ? 'warning' : 'success',
        title: mode === 'sync' ? t('EDA RBAC sync completed') : t('EDA RBAC enforce completed'),
        children: result.errors?.length
          ? t('{{count}} issue(s) need review.', { count: result.errors.length })
          : undefined,
        timeout: 5000,
      });
      await refresh();
    } catch (err) {
      alertToaster.addAlert({
        variant: 'danger',
        title: t('EDA RBAC sync failed'),
        children: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsApplying(false);
    }
  };

  if (error) return <AwxError error={error} handleRefresh={refresh} />;

  return (
    <PageLayout>
      <PageHeader
        title={t('Access Sync')}
        description={t(
          'Preview, sync, and enforce EDA role assignments from AWX organization RBAC.'
        )}
      />
      <div style={{ padding: '0 24px 24px' }}>
        {isLoading && <Spinner />}
        {report?.source === 'not_configured' && (
          <Alert isInline variant="warning" title={t('EDA Controller is not configured')}>
            {t('Configure Event-Driven Ansible settings before syncing access.')}
          </Alert>
        )}
        {report && (
          <>
            <div
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'center',
                justifyContent: 'flex-end',
                marginBottom: 16,
                flexWrap: 'wrap',
              }}
            >
              <Button variant={ButtonVariant.secondary} icon={<SyncAltIcon />} onClick={refresh}>
                {t('Refresh')}
              </Button>
              <Button
                variant={ButtonVariant.primary}
                isDisabled={!canManageEda || isApplying || report.source !== 'eda_controller'}
                onClick={() => void runSync('sync')}
              >
                {t('Sync missing')}
              </Button>
              <Button
                variant="danger"
                isDisabled={!canManageEda || isApplying || report.source !== 'eda_controller'}
                onClick={() => void runSync('enforce')}
              >
                {t('Enforce drift')}
              </Button>
            </div>
            <SummaryCards summary={report.summary} />
            <ReportSection
              title={t('Missing identities')}
              emptyText={t('No missing EDA identities.')}
              rows={identityRows(report.missing_identities)}
            />
            <ReportSection
              title={t('Missing assignments')}
              emptyText={t('No missing EDA assignments.')}
              rows={report.missing_assignments.map(formatAssignment)}
            />
            <ReportSection
              title={t('Extra assignments')}
              emptyText={t('No extra EDA assignments in AWX-managed scope.')}
              rows={report.extra_assignments.map(formatAssignment)}
            />
            <ReportSection
              title={t('Applied actions')}
              emptyText={t('No actions have been applied in this preview.')}
              rows={report.actions.map(formatAction)}
            />
            <ReportSection
              title={t('Errors')}
              emptyText={t('No sync errors.')}
              rows={report.errors.map(formatError)}
              variant="danger"
            />
          </>
        )}
      </div>
    </PageLayout>
  );
}

function SummaryCards(props: { summary: EdaRbacSummary }) {
  const { t } = useTranslation();
  const items = [
    { label: t('AWX organizations'), value: props.summary.awx_organizations ?? 0 },
    { label: t('Desired assignments'), value: props.summary.desired_assignments ?? 0 },
    { label: t('Current assignments'), value: props.summary.current_assignments ?? 0 },
    { label: t('Missing assignments'), value: props.summary.missing_assignments ?? 0 },
    { label: t('Extra assignments'), value: props.summary.extra_assignments ?? 0 },
    { label: t('Errors'), value: props.summary.errors ?? 0 },
  ];
  return (
    <Gallery hasGutter minWidths={{ default: '180px' }} style={{ marginBottom: 16 }}>
      {items.map((item) => (
        <GalleryItem key={item.label}>
          <Card isCompact style={{ height: '100%' }}>
            <CardBody>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{item.value}</div>
              <div>{item.label}</div>
            </CardBody>
          </Card>
        </GalleryItem>
      ))}
    </Gallery>
  );
}

function ReportSection(props: {
  title: string;
  emptyText: string;
  rows: string[];
  variant?: 'danger';
}) {
  return (
    <Card style={{ marginBottom: 16 }}>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
      </CardHeader>
      <CardBody>
        {props.rows.length === 0 ? (
          <div>{props.emptyText}</div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {props.rows.map((row, index) => (
              <li
                key={`${props.title}-${index}`}
                style={{ color: props.variant ? '#c9190b' : undefined }}
              >
                {row}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function identityRows(identities: EdaRbacSyncReport['missing_identities']) {
  return [
    ...(identities.organizations ?? []).map((item) => `Organization ${item.name}`),
    ...(identities.users ?? []).map((item) => `User ${item.name}`),
    ...(identities.teams ?? []).map(
      (item) =>
        `Team ${item.name}${item.awx_organization_name ? ` in ${item.awx_organization_name}` : ''}`
    ),
    ...(identities.role_definitions ?? []).map(
      (item) => `Role ${item.name}${item.content_type ? ` (${item.content_type})` : ''}`
    ),
  ];
}

function formatAssignment(assignment: EdaRbacAssignment) {
  const actor = assignment.actor_name || assignment.eda_actor_name || '-';
  const org = assignment.awx_organization_name || assignment.eda_organization_name || '-';
  const role = assignment.eda_role_name || assignment.awx_role_label || '-';
  return `${assignment.actor_type || 'actor'} ${actor} -> ${role} on ${org}`;
}

function formatAction(action: EdaRbacAction) {
  if (action.action === 'create_identity') {
    return `Created ${action.resource} ${action.id ?? ''}`;
  }
  if (action.action === 'create_assignment') {
    return `Created ${action.actor_type} assignment ${action.actor_name} -> ${
      action.eda_role_name
    } on ${action.eda_organization_name}`;
  }
  if (action.action === 'delete_assignment') {
    return `Deleted ${action.actor_type} assignment ${action.actor_name} -> ${
      action.eda_role_name
    } on ${action.eda_organization_name}`;
  }
  return `${action.action || 'Action'} ${action.resource || ''}`;
}

function formatError(error: EdaRbacError) {
  return `${error.action || 'sync'} ${error.name || error.username || ''}: ${error.detail || ''}`;
}
