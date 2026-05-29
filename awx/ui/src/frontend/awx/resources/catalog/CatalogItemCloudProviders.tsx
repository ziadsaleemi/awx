import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { useState } from 'react';
import {
  Alert,
  Label,
  Switch,
  Title,
} from '@patternfly/react-core';
import { LoadingPage } from '../../../../framework';
import { useGetItem, useGet } from '../../../common/crud/useGet';
import { requestPatch } from '../../../common/crud/Data';
import { AwxError } from '../../common/AwxError';
import { awxAPI } from '../../common/api/awx-utils';
import { CatalogItem } from '../../interfaces/CatalogItem';

const PROVIDER_LABELS: Record<string, string> = {
  digitalocean: 'DigitalOcean',
  proxmox: 'Proxmox VE',
  vmware: 'VMware vSphere',
  azure: 'Microsoft Azure',
  aws: 'Amazon AWS',
};

const PROVIDER_COLORS: Record<string, { bg: string; fg: string; abbr: string }> = {
  digitalocean: { bg: '#0080FF', fg: '#fff', abbr: 'DO' },
  azure: { bg: '#0078D4', fg: '#fff', abbr: 'Az' },
  proxmox: { bg: '#E57000', fg: '#fff', abbr: 'PX' },
  aws: { bg: '#FF9900', fg: '#1a1a1a', abbr: 'AWS' },
  vmware: { bg: '#607078', fg: '#fff', abbr: 'VM' },
};

interface CloudConnectionApiResult {
  count: number;
  results: Array<{ id: number; provider_id: string; name: string; status: string }>;
}

interface WorkflowResult {
  count: number;
  results: Array<{ id: number; name: string }>;
}

function useWorkflowNames(ids: number[]) {
  const unique = [...new Set(ids)];
  const { data } = useGet<WorkflowResult>(
    unique.length > 0 ? awxAPI`/workflow_job_templates/` : undefined,
    unique.length > 0 ? { id__in: unique.join(',') } : undefined
  );
  const map: Record<number, string> = {};
  for (const wf of data?.results ?? []) {
    map[wf.id] = wf.name;
  }
  return map;
}

export function CatalogItemCloudProviders() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();

  const {
    data: item,
    error,
    isLoading,
    refresh,
  } = useGetItem<CatalogItem>(awxAPI`/catalog_items`, params.id);

  const { data: connectionsData } = useGet<CloudConnectionApiResult>(
    awxAPI`/catalog_cloud/connections/`
  );

  const [saving, setSaving] = useState<string | null>(null);
  const [availableProviders, setAvailableProviders] = useState<string[] | null>(null);

  // Resolve available providers: use local state after first edit, else item value
  const effectiveProviders = availableProviders ?? item?.available_providers ?? [];

  // Collect all workflow IDs we need names for
  const provisionMap = item?.provider_workflows ?? {};
  const deprovisionMap = item?.provider_deprovision_workflows ?? {};
  const allWfIds = [
    ...Object.values(provisionMap),
    ...Object.values(deprovisionMap),
  ].filter(Boolean) as number[];

  const wfNames = useWorkflowNames(allWfIds);

  if (error) return <AwxError error={error} handleRefresh={refresh} />;
  if (isLoading || !item) return <LoadingPage />;

  // Group connections by provider_id
  const groups: Record<string, Array<{ id: number; name: string; status: string }>> = {};
  for (const conn of connectionsData?.results ?? []) {
    if (!groups[conn.provider_id]) groups[conn.provider_id] = [];
    groups[conn.provider_id].push({ id: conn.id, name: conn.name, status: conn.status });
  }

  // Providers configured on the item (union of connections + any in provider_workflows)
  const configuredProviderIds = [
    ...new Set([
      ...Object.keys(groups),
      ...Object.keys(provisionMap),
    ]),
  ];

  const handleToggle = async (providerId: string, enable: boolean) => {
    setSaving(providerId);
    const current = availableProviders ?? item.available_providers ?? [];
    const next = enable
      ? [...current.filter((p) => p !== providerId), providerId]
      : current.filter((p) => p !== providerId);
    try {
      await requestPatch(awxAPI`/catalog_items/${String(item.id)}/`, {
        available_providers: next.length > 0 ? next : null,
      });
      setAvailableProviders(next);
    } finally {
      setSaving(null);
    }
  };

  if (configuredProviderIds.length === 0) {
    return (
      <div style={{ padding: '2rem 1.5rem' }}>
        <Alert
          isInline
          variant="info"
          title={t('No cloud providers configured')}
        >
          {t(
            'No cloud connections are configured. Add connections in the cloud provider settings pages, then re-open this catalog item.'
          )}
        </Alert>
      </div>
    );
  }

  return (
    <div style={{ padding: '1.5rem' }}>
      <Title headingLevel="h3" size="md" style={{ marginBottom: 16 }}>
        {t('Cloud providers')}
      </Title>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {configuredProviderIds.map((pid) => {
          const conns = groups[pid] ?? [];
          const enabled = effectiveProviders.includes(pid);
          const hasConnected = conns.some((c) => c.status === 'connected');
          const color =
            PROVIDER_COLORS[pid] ?? {
              bg: '#888',
              fg: '#fff',
              abbr: pid.slice(0, 2).toUpperCase(),
            };
          const label = PROVIDER_LABELS[pid] ?? pid;

          const provisionWfId = provisionMap[pid] ?? null;
          const deprovisionWfId = deprovisionMap[pid] ?? null;
          const provisionName = provisionWfId ? (wfNames[provisionWfId] ?? `#${provisionWfId}`) : '-';
          const deprovisionName = deprovisionWfId
            ? (wfNames[deprovisionWfId] ?? `#${deprovisionWfId}`)
            : '-';

          return (
            <div
              key={pid}
              style={{
                border: `1px solid ${
                  enabled
                    ? 'var(--pf-v5-global--primary-color--100)'
                    : 'var(--pf-v5-global--BorderColor--100)'
                }`,
                borderRadius: 8,
                padding: '14px 18px',
                backgroundColor: '#1b1d21',
                opacity: hasConnected || conns.length === 0 ? 1 : 0.6,
              }}
            >
              {/* Header row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: '50%',
                    background: color.bg,
                    color: color.fg,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: '0.75rem',
                    flexShrink: 0,
                  }}
                >
                  {color.abbr}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{label}</div>
                  {/* Connectors */}
                  {conns.length > 0 && (
                    <div
                      style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}
                    >
                      {conns.map((conn) => (
                        <span
                          key={conn.id}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            fontSize: '0.78rem',
                            padding: '1px 7px',
                            borderRadius: 99,
                            border: '1px solid var(--pf-v5-global--BorderColor--100)',
                            backgroundColor: '#222428',
                          }}
                        >
                          <span
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: '50%',
                              background:
                                conn.status === 'connected'
                                  ? 'var(--pf-v5-global--success-color--100)'
                                  : 'var(--pf-v5-global--danger-color--100)',
                            }}
                          />
                          {conn.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <Switch
                  id={`provider_toggle_${pid}`}
                  isChecked={enabled}
                  isDisabled={saving === pid}
                  onChange={(_e, checked) => void handleToggle(pid, checked)}
                  aria-label={t('Enable {{label}}', { label })}
                  label={t('Enabled')}
                  labelOff={t('Disabled')}
                />
              </div>

              {/* Workflow details */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '8px 16px',
                  marginTop: 12,
                  paddingTop: 10,
                  borderTop: '1px solid var(--pf-v5-global--BorderColor--100)',
                  fontSize: '0.85rem',
                }}
              >
                <div>
                  <span style={{ color: 'var(--pf-v5-global--Color--200)', marginRight: 6 }}>
                    {t('Provision workflow')}
                  </span>
                  {provisionWfId ? (
                    <Label color="blue" isCompact>
                      {provisionName}
                    </Label>
                  ) : (
                    <span style={{ color: 'var(--pf-v5-global--Color--200)' }}>-</span>
                  )}
                </div>
                <div>
                  <span style={{ color: 'var(--pf-v5-global--Color--200)', marginRight: 6 }}>
                    {t('Deprovision workflow')}
                  </span>
                  {deprovisionWfId ? (
                    <Label color="orange" isCompact>
                      {deprovisionName}
                    </Label>
                  ) : (
                    <span style={{ color: 'var(--pf-v5-global--Color--200)' }}>-</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
