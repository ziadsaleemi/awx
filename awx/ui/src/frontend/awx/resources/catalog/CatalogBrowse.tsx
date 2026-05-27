import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Gallery,
  GalleryItem,
  EmptyState,
  EmptyStateBody,
  EmptyStateIcon,
  Spinner,
  Title,
} from '@patternfly/react-core';
import { CubesIcon } from '@patternfly/react-icons';
import {
  PageHeader,
  PageLayout,
  usePageNavigate,
} from '../../../../framework';
import { awxAPI } from '../../common/api/awx-utils';
import { useGet } from '../../../common/crud/useGet';
import { CatalogItem } from '../../interfaces/CatalogItem';
import { AwxRoute } from '../../main/AwxRoutes';

interface CatalogItemListResponse {
  count: number;
  results: CatalogItem[];
}

interface VmSizePreset {
  name: string;
  cpu: string;
  ram: string;
}

function extractSpecValue(
  schema: Record<string, unknown> | null,
  candidateKeys: string[]
): string | undefined {
  const properties =
    schema && typeof schema === 'object'
      ? (schema as { properties?: Record<string, unknown> }).properties ?? {}
      : {};

  const normalizedCandidates = candidateKeys.map((key) => key.toLowerCase());

  const matchingEntry = Object.entries(properties).find(([key]) =>
    normalizedCandidates.includes(key.toLowerCase())
  );

  if (!matchingEntry) {
    return undefined;
  }

  const [, value] = matchingEntry;
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const schemaField = value as {
    default?: unknown;
    minimum?: unknown;
    enum?: unknown[];
  };

  if (schemaField.default !== undefined && schemaField.default !== null) {
    return String(schemaField.default);
  }

  if (typeof schemaField.minimum === 'number') {
    return String(schemaField.minimum);
  }

  if (Array.isArray(schemaField.enum) && schemaField.enum.length > 0) {
    return String(schemaField.enum[0]);
  }

  return undefined;
}

function extractSpecFieldKey(
  schema: Record<string, unknown> | null,
  candidateKeys: string[]
): string | undefined {
  const properties =
    schema && typeof schema === 'object'
      ? (schema as { properties?: Record<string, unknown> }).properties ?? {}
      : {};

  const normalizedCandidates = candidateKeys.map((key) => key.toLowerCase());
  return Object.keys(properties).find((key) => normalizedCandidates.includes(key.toLowerCase()));
}

function getVmSizePresets(schema: Record<string, unknown> | null): VmSizePreset[] {
  if (!schema || typeof schema !== 'object') {
    return [];
  }

  const raw = (schema as { x_vm_sizes?: unknown }).x_vm_sizes;
  if (!raw || typeof raw !== 'object') {
    return [];
  }

  const presets: VmSizePreset[] = [];
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    const obj = value as { cpu?: unknown; ram?: unknown; memory?: unknown };
    const cpu = obj.cpu;
    const ram = obj.ram ?? obj.memory;
    if (cpu === undefined || ram === undefined) {
      continue;
    }
    presets.push({
      name,
      cpu: String(cpu),
      ram: String(ram),
    });
  }

  return presets;
}

export function CatalogBrowse() {
  const { t } = useTranslation();
  const pageNavigate = usePageNavigate();

  const { data, isLoading } = useGet<CatalogItemListResponse>(awxAPI`/catalog_items/`);
  const items = data?.results ?? [];

  const deployFromSize = (item: CatalogItem, size: VmSizePreset) => {
    const cpuField =
      extractSpecFieldKey(item.extra_vars_schema, ['cpu', 'cpus', 'cores', 'vcpus']) ?? 'cpu';
    const ramField =
      extractSpecFieldKey(item.extra_vars_schema, [
        'ram',
        'memory',
        'memory_mb',
        'memory_gb',
      ]) ?? 'ram';

    pageNavigate(AwxRoute.CatalogDeploy, {
      params: { id: String(item.id) },
      query: {
        cpu_field: cpuField,
        cpu: size.cpu,
        ram_field: ramField,
        ram: size.ram,
      },
    });
  };

  return (
    <PageLayout>
      <PageHeader
        title={t('Service Catalog')}
        description={t('Browse and deploy available catalog items.')}
      />
      {isLoading ? (
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <Spinner />
        </div>
      ) : !items || items.length === 0 ? (
        <EmptyState variant="full">
          <EmptyStateIcon icon={CubesIcon} />
          <Title headingLevel="h4" size="lg">
            {t('No catalog items')}
          </Title>
          <EmptyStateBody>
            {t('No catalog items are available. Contact your administrator to create items.')}
          </EmptyStateBody>
        </EmptyState>
      ) : (
        <div style={{ padding: '1.5rem' }}>
          <Gallery hasGutter minWidths={{ default: '280px' }}>
            {items.map((item) => (
              <GalleryItem key={item.id}>
                <CatalogItemCard
                  item={item}
                  onDeployFromSize={(size) => void deployFromSize(item, size)}
                />
              </GalleryItem>
            ))}
          </Gallery>
        </div>
      )}
    </PageLayout>
  );
}

const StyledCatalogCard = styled(Card)`
  background-color: #222428 !important;
  border: 1px solid var(--pf-v5-global--BorderColor--100) !important;
  box-shadow: var(--pf-v5-global--BoxShadow--sm) !important;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important;
  height: 100%;
  display: flex;
  flex-direction: column;

  &:hover {
    transform: translateY(-4px);
    border-color: var(--pf-v5-global--primary-color--100) !important;
    box-shadow: var(--pf-v5-global--BoxShadow--lg) !important;
  }
`;

function CatalogItemCard({
  item,
  onDeployFromSize,
}: {
  item: CatalogItem;
  onDeployFromSize: (size: VmSizePreset) => void;
}) {
  const { t } = useTranslation();
  const iconSrc =
    item.icon_data && item.icon_data.startsWith('data:image/') ? item.icon_data : item.icon_url;
  const cpuSpec = extractSpecValue(item.extra_vars_schema, ['cpu', 'cpus', 'cores', 'vcpus']);
  const ramSpec = extractSpecValue(item.extra_vars_schema, [
    'ram',
    'memory',
    'memory_mb',
    'memory_gb',
  ]);
  const vmSizes = getVmSizePresets(item.extra_vars_schema);

  return (
    <StyledCatalogCard>
      <CardHeader>
        <div
          style={{
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            gap: '0.75rem',
            paddingTop: '0.25rem',
          }}
        >
          {iconSrc ? (
            <img src={iconSrc} alt="" style={{ width: 72, height: 72, objectFit: 'contain' }} />
          ) : (
            <CubesIcon style={{ width: 72, height: 72 }} />
          )}
          <CardTitle>{item.name}</CardTitle>
        </div>
      </CardHeader>
      <CardBody style={{ flexGrow: 1, textAlign: 'center' }}>
        <div style={{ minHeight: '2.75rem' }}>
          {item.description || (
            <span style={{ color: 'var(--pf-global--Color--200)' }}>
              {t('No description provided.')}
            </span>
          )}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: '0.5rem',
            marginTop: '0.9rem',
          }}
        >
          <div
            style={{
              backgroundColor: '#1b1d22',
              borderRadius: 6,
              padding: '0.45rem 0.6rem',
            }}
          >
            <div style={{ fontSize: '0.72rem', color: 'var(--pf-global--Color--200)' }}>
              {t('CPU')}
            </div>
            <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{cpuSpec ?? '-'}</div>
          </div>
          <div
            style={{
              backgroundColor: '#1b1d22',
              borderRadius: 6,
              padding: '0.45rem 0.6rem',
            }}
          >
            <div style={{ fontSize: '0.72rem', color: 'var(--pf-global--Color--200)' }}>
              {t('RAM')}
            </div>
            <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{ramSpec ?? '-'}</div>
          </div>
        </div>

        {item.summary_fields?.organization && (
          <p
            style={{
              marginTop: '0.7rem',
              fontSize: '0.8rem',
              color: 'var(--pf-global--Color--200)',
            }}
          >
            {t('Org: {{name}}', { name: item.summary_fields.organization.name })}
          </p>
        )}
        {item.summary_fields?.terraform_job_template && (
          <p
            style={{
              marginTop: '0.25rem',
              fontSize: '0.8rem',
              color: 'var(--pf-global--Color--200)',
            }}
          >
            {t('Terraform: {{name}}', { name: item.summary_fields.terraform_job_template.name })}
          </p>
        )}
      </CardBody>

      {vmSizes.length > 0 && (
        <div
          style={{
            padding: '0 1rem 1rem',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.5rem',
            justifyContent: 'center',
          }}
        >
          {vmSizes.map((size) => (
            <button
              key={`${item.id}-${size.name}`}
              type="button"
              onClick={() => onDeployFromSize(size)}
              disabled={!item.summary_fields?.user_capabilities?.use}
              style={{
                border: '1px solid var(--pf-v5-global--BorderColor--100)',
                borderRadius: 999,
                padding: '0.2rem 0.7rem',
                background: 'var(--pf-v5-global--BackgroundColor--100)',
                cursor: 'pointer',
                fontSize: '0.78rem',
                lineHeight: 1.2,
              }}
            >
              {`${size.name}: ${size.cpu} CPU / ${size.ram} RAM`}
            </button>
          ))}
        </div>
      )}

      {vmSizes.length === 0 && (
        <div
          style={{
            padding: '0 1rem 1rem',
            textAlign: 'center',
            fontSize: '0.8rem',
            color: 'var(--pf-global--Color--200)',
          }}
        >
          {t('No VM sizes configured')}
        </div>
      )}
    </StyledCatalogCard>
  );
}
