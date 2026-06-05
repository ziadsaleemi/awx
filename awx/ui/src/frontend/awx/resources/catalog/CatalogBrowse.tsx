import { useState } from 'react';
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
  Modal,
  ModalBoxBody,
  ModalVariant,
  PageSection,
  Spinner,
  Title,
} from '@patternfly/react-core';
import { CubesIcon } from '@patternfly/react-icons';
import { PageHeader, PageLayout } from '../../../../framework';
import { awxAPI } from '../../common/api/awx-utils';
import { useGet } from '../../../common/crud/useGet';
import { CatalogItem } from '../../interfaces/CatalogItem';
import { CatalogDeployContent } from './CatalogDeployWizard';

// Per-provider icon config: brand colours + abbreviation
import DigitalOceanLogo from '../../../assets/digitalocean.svg';
import AWSLogo from '../../../assets/aws.svg';
import AzureLogo from '../../../assets/azure.svg';
import GCPLogo from '../../../assets/gcp.svg';
import ProxmoxLogo from '../../../assets/proxmox.svg';
import VmwareLogo from '../../../assets/vmware.svg';

const PROVIDER_LOGOS: Record<string, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  digitalocean: DigitalOceanLogo,
  azure: AzureLogo,
  proxmox: ProxmoxLogo,
  aws: AWSLogo,
  vmware: VmwareLogo,
  gcp: GCPLogo,
};

const PROVIDER_ICON_CONFIG: Record<
  string,
  { bg: string; fg: string; abbr: string; label: string }
> = {
  digitalocean: { bg: '#0080FF', fg: '#fff', abbr: 'DO', label: 'DigitalOcean' },
  azure: { bg: '#0078D4', fg: '#fff', abbr: 'Az', label: 'Microsoft Azure' },
  proxmox: { bg: '#E57000', fg: '#fff', abbr: 'PX', label: 'Proxmox VE' },
  aws: { bg: '#FF9900', fg: '#1a1a1a', abbr: 'AWS', label: 'Amazon AWS' },
  vmware: { bg: '#607078', fg: '#fff', abbr: 'VM', label: 'VMware vSphere' },
  gcp: { bg: '#4285F4', fg: '#fff', abbr: 'GCP', label: 'Google Cloud' },
};

function providerConfig(slug: string) {
  return (
    PROVIDER_ICON_CONFIG[slug] ?? {
      bg: '#6a9955',
      fg: '#fff',
      abbr: slug.slice(0, 2).toUpperCase(),
      label: slug,
    }
  );
}

const ProviderLogoBtn = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  cursor: pointer;
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  flex-shrink: 0;
  padding: 0;
  margin: 0;

  &:hover {
    transform: scale(1.15);
  }

  &:focus-visible {
    outline: 2px solid var(--pf-v5-global--primary-color--100);
    outline-offset: 4px;
    border-radius: 2px;
  }
`;

const ProviderFallbackBtn = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px 8px;
  border-radius: 4px;
  background: #3a3d44;
  color: #fff;
  border: 1px solid var(--pf-v5-global--BorderColor--100);
  cursor: pointer;
  font-size: 0.75rem;
  font-weight: 600;
  transition:
    transform 0.2s ease,
    background 0.2s ease;

  &:hover {
    transform: scale(1.05);
    background: #474b54;
  }

  &:focus-visible {
    outline: 2px solid var(--pf-v5-global--primary-color--100);
    outline-offset: 2px;
  }
`;

const CatalogBrowseSection = styled(PageSection)`
  min-width: 0;
`;

const CatalogBrowseGallery = styled(Gallery)`
  width: 100%;

  .pf-v5-c-gallery__item {
    min-width: 0;
  }
`;

const CatalogCardDescription = styled.div`
  flex: 1 1 auto;
  min-height: 2.75rem;
  overflow-wrap: anywhere;
`;

function getProviderSlugs(item: CatalogItem): string[] {
  if (item.available_providers && item.available_providers.length > 0) {
    return item.available_providers;
  }
  const slugs = new Set<string>();
  if (item.cloud_backends) Object.keys(item.cloud_backends).forEach((k) => slugs.add(k));
  if (item.provider_workflows) Object.keys(item.provider_workflows).forEach((k) => slugs.add(k));
  return [...slugs];
}

interface CatalogItemListResponse {
  count: number;
  results: CatalogItem[];
}

// ─── Main Browse Page ─────────────────────────────────────────────────────────

type DeployTarget = { item: CatalogItem; provider: string };

export function CatalogBrowse() {
  const { t } = useTranslation();
  const [deployTarget, setDeployTarget] = useState<DeployTarget | null>(null);

  const { data, isLoading } = useGet<CatalogItemListResponse>(awxAPI`/catalog_items/`);
  const items = (data?.results ?? []).filter((item) => item.browse_enabled !== false);

  return (
    <PageLayout>
      <PageHeader
        title={t('Service Catalog')}
        description={t('Browse and deploy available catalog items.')}
      />
      {isLoading ? (
        <CatalogBrowseSection data-cy="catalog-browse-section">
          <Spinner />
        </CatalogBrowseSection>
      ) : !items || items.length === 0 ? (
        <CatalogBrowseSection data-cy="catalog-browse-section">
          <EmptyState variant="full">
            <EmptyStateIcon icon={CubesIcon} />
            <Title headingLevel="h4" size="lg">
              {t('No catalog items')}
            </Title>
            <EmptyStateBody>
              {t('No catalog items are available. Contact your administrator to create items.')}
            </EmptyStateBody>
          </EmptyState>
        </CatalogBrowseSection>
      ) : (
        <CatalogBrowseSection data-cy="catalog-browse-section">
          <CatalogBrowseGallery
            hasGutter
            minWidths={{ default: '260px', md: '300px', xl: '320px' }}
            data-cy="catalog-browse-gallery"
          >
            {items.map((item) => (
              <GalleryItem key={item.id}>
                <CatalogItemCard
                  item={item}
                  onDeployProvider={(provider) => setDeployTarget({ item, provider })}
                />
              </GalleryItem>
            ))}
          </CatalogBrowseGallery>
        </CatalogBrowseSection>
      )}

      {/* Per-provider deploy modal */}
      {deployTarget && (
        <Modal
          title={t('Deploy: {{name}}', { name: deployTarget.item.name })}
          aria-label={t('Deploy {{name}} via {{provider}}', {
            name: deployTarget.item.name,
            provider: providerConfig(deployTarget.provider).label,
          })}
          variant={ModalVariant.large}
          isOpen
          hasNoBodyWrapper
          onClose={() => setDeployTarget(null)}
        >
          <ModalBoxBody style={{ padding: '1.5rem 2rem' }}>
            <CatalogDeployContent
              item={deployTarget.item}
              initialProvider={deployTarget.provider}
              onDone={() => setDeployTarget(null)}
              onCancel={() => setDeployTarget(null)}
            />
          </ModalBoxBody>
        </Modal>
      )}
    </PageLayout>
  );
}

// ─── Catalog Item Card ────────────────────────────────────────────────────────

const StyledCatalogCard = styled(Card)`
  background-color: #222428 !important;
  border: 1px solid var(--pf-v5-global--BorderColor--100) !important;
  box-shadow: var(--pf-v5-global--BoxShadow--sm) !important;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important;
  height: 100%;
  min-height: 280px;
  display: flex;
  flex-direction: column;
  overflow-wrap: anywhere;

  &:hover {
    transform: translateY(-4px);
    border-color: var(--pf-v5-global--primary-color--100) !important;
    box-shadow: var(--pf-v5-global--BoxShadow--lg) !important;
  }
`;

function CatalogItemCard({
  item,
  onDeployProvider,
}: {
  item: CatalogItem;
  onDeployProvider: (provider: string) => void;
}) {
  const { t } = useTranslation();
  const iconSrc =
    item.icon_data && item.icon_data.startsWith('data:image/') ? item.icon_data : item.icon_url;
  const slugs = getProviderSlugs(item);

  return (
    <StyledCatalogCard data-cy="catalog-browse-card">
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
      <CardBody
        style={{
          flexGrow: 1,
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <CatalogCardDescription>
          {item.description || (
            <span style={{ color: 'var(--pf-global--Color--200)' }}>
              {t('No description provided.')}
            </span>
          )}
        </CatalogCardDescription>

        {/* Cloud provider icon badges — click to open per-provider deploy modal */}
        {slugs.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '1rem',
              justifyContent: 'center',
              alignItems: 'center',
              marginTop: '1.25rem',
              marginBottom: 0,
            }}
          >
            {slugs.map((slug) => {
              const cfg = providerConfig(slug);
              const Logo = PROVIDER_LOGOS[slug];
              if (Logo) {
                return (
                  <ProviderLogoBtn
                    key={slug}
                    type="button"
                    title={t('Deploy via {{label}}', { label: cfg.label })}
                    aria-label={t('Deploy via {{label}}', { label: cfg.label })}
                    onClick={() => onDeployProvider(slug)}
                  >
                    <Logo style={{ height: '24px', width: 'auto' }} />
                  </ProviderLogoBtn>
                );
              }
              return (
                <ProviderFallbackBtn
                  key={slug}
                  type="button"
                  title={t('Deploy via {{label}}', { label: cfg.label })}
                  aria-label={t('Deploy via {{label}}', { label: cfg.label })}
                  onClick={() => onDeployProvider(slug)}
                >
                  {cfg.abbr}
                </ProviderFallbackBtn>
              );
            })}
          </div>
        )}
      </CardBody>
    </StyledCatalogCard>
  );
}
