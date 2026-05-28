import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { useState } from 'react';
import { Switch, Title } from '@patternfly/react-core';
import {
  LoadingPage,
  PageDetail,
  PageDetails,
  useGetPageUrl,
} from '../../../../framework';
import { useGetItem, useGet } from '../../../common/crud/useGet';
import { requestPatch } from '../../../common/crud/Data';
import { AwxError } from '../../common/AwxError';
import { awxAPI } from '../../common/api/awx-utils';
import { CatalogItem } from '../../interfaces/CatalogItem';
import { AwxRoute } from '../../main/AwxRoutes';

const PROVIDER_LABELS: Record<string, string> = {
  digitalocean: 'DigitalOcean',
  proxmox: 'Proxmox VE',
  vmware: 'VMware vSphere',
  azure: 'Microsoft Azure',
  aws: 'Amazon AWS',
};

const PROVIDER_COLORS: Record<string, { bg: string; fg: string; abbr: string }> = {
  digitalocean: { bg: '#0080FF', fg: '#fff', abbr: 'DO' },
  azure:        { bg: '#0078D4', fg: '#fff', abbr: 'Az' },
  proxmox:      { bg: '#E57000', fg: '#fff', abbr: 'PX' },
  aws:          { bg: '#FF9900', fg: '#1a1a1a', abbr: 'AWS' },
  vmware:       { bg: '#607078', fg: '#fff', abbr: 'VM' },
};

interface CloudConnectionApiResult {
  count: number;
  results: Array<{ id: number; provider_id: string; name: string; status: string }>;
}

function CloudProvidersSection({ item }: { item: CatalogItem }) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState<string | null>(null);
  const [availableProviders, setAvailableProviders] = useState<string[]>(
    item.available_providers ?? []
  );

  const { data: connectionsData } = useGet<CloudConnectionApiResult>(
    awxAPI`/catalog_cloud/connections/`
  );

  // Group by provider_id
  const groups: Record<string, Array<{ id: number; name: string; status: string }>> = {};
  for (const conn of connectionsData?.results ?? []) {
    if (!groups[conn.provider_id]) groups[conn.provider_id] = [];
    groups[conn.provider_id].push({ id: conn.id, name: conn.name, status: conn.status });
  }

  const providerIds = Object.keys(groups);

  if (providerIds.length === 0) return null;

  const handleToggle = async (providerId: string, enable: boolean) => {
    setSaving(providerId);
    const next = enable
      ? [...availableProviders.filter((p) => p !== providerId), providerId]
      : availableProviders.filter((p) => p !== providerId);
    try {
      await requestPatch(awxAPI`/catalog_items/${String(item.id)}/`, {
        available_providers: next.length > 0 ? next : null,
      });
      setAvailableProviders(next);
    } finally {
      setSaving(null);
    }
  };

  return (
    <div style={{ gridColumn: '1 / -1', marginTop: 8 }}>
      <Title headingLevel="h3" size="md" style={{ marginBottom: 12 }}>
        {t('Cloud providers')}
      </Title>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {providerIds.map((pid) => {
          const conns = groups[pid];
          const enabled = availableProviders.includes(pid);
          const hasConnected = conns.some((c) => c.status === 'connected');
          const color = PROVIDER_COLORS[pid] ?? { bg: '#888', fg: '#fff', abbr: pid.slice(0, 2).toUpperCase() };
          const label = PROVIDER_LABELS[pid] ?? pid;

          return (
            <div
              key={pid}
              style={{
                border: `1px solid ${enabled ? 'var(--pf-v5-global--primary-color--100)' : 'var(--pf-v5-global--BorderColor--100)'}`,
                borderRadius: 8,
                padding: '12px 16px',
                backgroundColor: '#1b1d21',
                opacity: hasConnected ? 1 : 0.6,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {/* Icon badge */}
                <span
                  style={{
                    width: 36,
                    height: 36,
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
                  {/* Connector list inline */}
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 6,
                      marginTop: 4,
                    }}
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
                </div>
                <Switch
                  id={`provider_toggle_${pid}`}
                  isChecked={enabled}
                  isDisabled={!hasConnected || saving === pid}
                  onChange={(_e, checked) => void handleToggle(pid, checked)}
                  aria-label={t('Enable {{label}}', { label })}
                  label={t('Enabled')}
                  labelOff={t('Disabled')}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CatalogItemDetails() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();

  const { data: item, error, isLoading, refresh } = useGetItem<CatalogItem>(
    awxAPI`/catalog_items`,
    params.id
  );

  if (error) return <AwxError error={error} handleRefresh={refresh} />;
  if (isLoading || !item) return <LoadingPage />;

  return (
    <PageDetails>
      <PageDetail label={t('Name')}>{item.name}</PageDetail>
      <PageDetail label={t('Description')}>{item.description || '-'}</PageDetail>
      <PageDetail label={t('Organization')}>
        {item.summary_fields?.organization?.name ?? '-'}
      </PageDetail>
      <PageDetail label={t('Name template')}>
        {item.name_template || t('None')}
      </PageDetail>
      <PageDetail label={t('Dynamic source field')}>
        {item.dynamic_name_field || t('None')}
      </PageDetail>
      <PageDetail label={t('Provision workflow')}>
        {item.summary_fields?.provision_workflow?.name ?? t('None')}
      </PageDetail>
      {item.summary_fields?.terraform_job_template && (
        <PageDetail label={t('Terraform template')}>
          {item.summary_fields.terraform_job_template.name}
        </PageDetail>
      )}
      <PageDetail label={t('Deprovision workflow')}>
        {item.summary_fields?.deprovision_workflow?.name ?? t('None')}
      </PageDetail>
      {item.icon_data && item.icon_data.startsWith('data:image/') && (
        <PageDetail label={t('Uploaded icon')}>
          <img
            src={item.icon_data}
            alt={t('Catalog icon')}
            style={{ width: 64, height: 64, objectFit: 'contain' }}
          />
        </PageDetail>
      )}
      <PageDetail label={t('Override downstream workflow limit')}>
        {item.override_workflow_limit ? t('Enabled') : t('Disabled')}
      </PageDetail>
      {item.icon_url && (
        <PageDetail label={t('Icon URL')}>{item.icon_url}</PageDetail>
      )}
      {item.extra_vars_schema && (
        <PageDetail label={t('Extra variables schema')}>
          <pre style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
            {JSON.stringify(item.extra_vars_schema, null, 2)}
          </pre>
        </PageDetail>
      )}
      <PageDetail label={t('Created')}>
        {new Date(item.created).toLocaleString()}
      </PageDetail>
      <PageDetail label={t('Modified')}>
        {new Date(item.modified).toLocaleString()}
      </PageDetail>
      {/* Cloud providers inline toggles */}
      <CloudProvidersSection item={item} />
    </PageDetails>
  );
}
