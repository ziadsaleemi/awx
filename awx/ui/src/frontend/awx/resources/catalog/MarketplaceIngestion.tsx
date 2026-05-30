import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActionGroup,
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  CardTitle,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  EmptyState,
  EmptyStateBody,
  EmptyStateIcon,
  Flex,
  FlexItem,
  Form,
  FormGroup,
  Gallery,
  GalleryItem,
  Label,
  Modal,
  ModalBoxBody,
  ModalVariant,
  Select,
  SelectList,
  SelectOption,
  Spinner,
  TextInput,
  Title,
} from '@patternfly/react-core';
import { CloudIcon, DownloadIcon, SearchIcon, StoreIcon } from '@patternfly/react-icons';
import { PageHeader, PageLayout } from '../../../../framework';
import { awxAPI } from '../../common/api/awx-utils';
import { requestGet, postRequest } from '../../../common/crud/Data';
import { useGet } from '../../../common/crud/useGet';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MarketplaceTemplate {
  id: string;
  name: string;
  provider: string;
  type: string;
  description: string;
  region: string;
  metadata: Record<string, unknown>;
}

interface MarketplaceProvider {
  id: string;
  label: string;
  templates: MarketplaceTemplate[];
}

interface MarketplaceListResponse {
  count: number;
  providers: MarketplaceProvider[];
}

// ---------------------------------------------------------------------------
// Type badge colours
// ---------------------------------------------------------------------------

const TYPE_COLOURS: Record<string, 'blue' | 'green' | 'orange' | 'purple' | 'grey'> = {
  image: 'blue',
  marketplace: 'green',
  template: 'orange',
  ami: 'purple',
};

function TypeBadge({ type }: { type: string }) {
  const colour = TYPE_COLOURS[type] ?? 'grey';
  return (
    <Label color={colour} isCompact>
      {type}
    </Label>
  );
}

// ---------------------------------------------------------------------------
// Ingest Modal
// ---------------------------------------------------------------------------

interface IngestModalProps {
  template: MarketplaceTemplate;
  onClose: () => void;
  onSuccess: (name: string) => void;
}

function IngestModal({ template, onClose, onSuccess }: IngestModalProps) {
  const { t } = useTranslation();
  const [itemName, setItemName] = useState(template.name);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleIngest = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await postRequest(awxAPI`/marketplace/ingest/`, {
        provider: template.provider,
        template_id: template.id,
        name: itemName,
      });
      onSuccess(itemName);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : (err as { message?: string })?.message ?? t('Ingestion failed. Please try again.');
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal
      variant={ModalVariant.medium}
      title={t('Import as Catalog Item')}
      isOpen
      onClose={onClose}
    >
      <ModalBoxBody>
        {error && (
          <Alert variant="danger" title={t('Ingestion error')} isInline style={{ marginBottom: 16 }}>
            {error}
          </Alert>
        )}

        <DescriptionList isCompact style={{ marginBottom: 24 }}>
          <DescriptionListGroup>
            <DescriptionListTerm>{t('Provider')}</DescriptionListTerm>
            <DescriptionListDescription>{template.provider}</DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>{t('Template ID')}</DescriptionListTerm>
            <DescriptionListDescription>
              <code>{template.id}</code>
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>{t('Type')}</DescriptionListTerm>
            <DescriptionListDescription>
              <TypeBadge type={template.type} />
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>{t('Region')}</DescriptionListTerm>
            <DescriptionListDescription>{template.region}</DescriptionListDescription>
          </DescriptionListGroup>
          {template.description && (
            <DescriptionListGroup>
              <DescriptionListTerm>{t('Description')}</DescriptionListTerm>
              <DescriptionListDescription>{template.description}</DescriptionListDescription>
            </DescriptionListGroup>
          )}
        </DescriptionList>

        <Form>
          <FormGroup label={t('Catalog item name')} isRequired fieldId="item-name">
            <TextInput
              id="item-name"
              value={itemName}
              onChange={(_ev, v) => setItemName(v)}
              isRequired
            />
          </FormGroup>
        </Form>

        <ActionGroup style={{ marginTop: 16 }}>
          <Button
            variant="primary"
            onClick={() => void handleIngest()}
            isDisabled={isLoading || !itemName.trim()}
            isLoading={isLoading}
            icon={<DownloadIcon />}
          >
            {t('Import')}
          </Button>
          <Button variant="link" onClick={onClose} isDisabled={isLoading}>
            {t('Cancel')}
          </Button>
        </ActionGroup>
      </ModalBoxBody>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Provider filter toolbar
// ---------------------------------------------------------------------------

interface ProviderFilterProps {
  providers: MarketplaceProvider[];
  selected: string;
  onChange: (p: string) => void;
}

function ProviderFilter({ providers, selected, onChange }: ProviderFilterProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  const selectedLabel =
    providers.find((p) => p.id === selected)?.label ?? t('All Providers');

  return (
    <Select
      isOpen={isOpen}
      selected={selected}
      onSelect={(_ev, value) => {
        onChange(String(value));
        setIsOpen(false);
      }}
      onOpenChange={setIsOpen}
      toggle={(ref) => (
        <Button ref={ref} variant="control" onClick={() => setIsOpen(!isOpen)}>
          {selectedLabel}
        </Button>
      )}
    >
      <SelectList>
        <SelectOption value="">{t('All Providers')}</SelectOption>
        {providers.map((p) => (
          <SelectOption key={p.id} value={p.id}>
            {p.label}
          </SelectOption>
        ))}
      </SelectList>
    </Select>
  );
}

// ---------------------------------------------------------------------------
// Template Card
// ---------------------------------------------------------------------------

interface TemplateCardProps {
  template: MarketplaceTemplate;
  onIngest: (template: MarketplaceTemplate) => void;
}

function TemplateCard({ template, onIngest }: TemplateCardProps) {
  const { t } = useTranslation();

  return (
    <Card isCompact isFullHeight>
      <CardHeader>
        <CardTitle>
          <span style={{ fontSize: '0.95rem', fontWeight: 600 }}>{template.name}</span>
        </CardTitle>
      </CardHeader>
      <CardBody>
        <Flex spaceItems={{ default: 'spaceItemsSm' }} style={{ marginBottom: 8 }}>
          <FlexItem>
            <TypeBadge type={template.type} />
          </FlexItem>
          <FlexItem>
            <Badge isRead>{template.region}</Badge>
          </FlexItem>
        </Flex>
        <p style={{ fontSize: '0.85rem', color: 'var(--pf-v5-global--Color--200)' }}>
          {template.description}
        </p>
      </CardBody>
      <CardFooter>
        <Button
          variant="secondary"
          size="sm"
          icon={<DownloadIcon />}
          onClick={() => onIngest(template)}
        >
          {t('Import as Catalog Item')}
        </Button>
      </CardFooter>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function MarketplaceIngestion() {
  const { t } = useTranslation();
  const [providerFilter, setProviderFilter] = useState('');
  const [ingestTarget, setIngestTarget] = useState<MarketplaceTemplate | null>(null);
  const [successName, setSuccessName] = useState<string | null>(null);

  const url =
    awxAPI`/marketplace/templates/` + (providerFilter ? `?provider=${providerFilter}` : '');

  const { data, isLoading, error } = useGet<MarketplaceListResponse>(url);

  const allProviders: MarketplaceProvider[] = data?.providers ?? [];

  const handleIngestSuccess = (name: string) => {
    setIngestTarget(null);
    setSuccessName(name);
    setTimeout(() => setSuccessName(null), 5000);
  };

  return (
    <PageLayout>
      <PageHeader
        title={t('Marketplace')}
        description={t(
          'Browse cloud provider images and marketplace templates. Import any entry as a new Catalog Item.'
        )}
      />

      {successName && (
        <Alert
          variant="success"
          title={t('Catalog item "{{name}}" created successfully.', { name: successName })}
          isInline
          style={{ margin: '0 24px 16px' }}
          actionClose={<Button variant="plain" onClick={() => setSuccessName(null)} />}
        />
      )}

      {/* Provider filter bar */}
      <div
        style={{
          padding: '8px 24px 16px',
          display: 'flex',
          gap: 12,
          alignItems: 'center',
        }}
      >
        <span style={{ fontWeight: 500 }}>{t('Filter by provider:')}</span>
        <ProviderFilter
          providers={allProviders}
          selected={providerFilter}
          onChange={(p) => {
            setProviderFilter(p);
            setSuccessName(null);
          }}
        />
        {data && (
          <span style={{ color: 'var(--pf-v5-global--Color--200)', fontSize: '0.85rem' }}>
            {t('{{count}} templates', { count: data.count })}
          </span>
        )}
      </div>

      {/* Loading */}
      {isLoading && (
        <div style={{ padding: '40px', textAlign: 'center' }}>
          <Spinner size="lg" />
        </div>
      )}

      {/* Error */}
      {error && !isLoading && (
        <div style={{ padding: '24px' }}>
          <Alert variant="danger" title={t('Failed to load marketplace templates')} isInline>
            {String(error)}
          </Alert>
        </div>
      )}

      {/* Empty */}
      {!isLoading && !error && allProviders.length === 0 && (
        <EmptyState>
          <EmptyStateIcon icon={StoreIcon} />
          <Title headingLevel="h4" size="lg">
            {t('No templates found')}
          </Title>
          <EmptyStateBody>
            {t('No marketplace templates are available for the selected filter.')}
          </EmptyStateBody>
        </EmptyState>
      )}

      {/* Provider sections */}
      {!isLoading &&
        !error &&
        allProviders.map((provider) => (
          <div key={provider.id} style={{ padding: '0 24px 32px' }}>
            <Flex alignItems={{ default: 'alignItemsCenter' }} style={{ marginBottom: 16 }}>
              <FlexItem>
                <CloudIcon style={{ marginRight: 8, color: 'var(--pf-v5-global--Color--200)' }} />
              </FlexItem>
              <FlexItem>
                <Title headingLevel="h3" size="md">
                  {provider.label}
                </Title>
              </FlexItem>
              <FlexItem>
                <Badge>{provider.templates.length}</Badge>
              </FlexItem>
            </Flex>

            <Gallery hasGutter minWidths={{ default: '280px' }}>
              {provider.templates.map((tpl) => (
                <GalleryItem key={tpl.id}>
                  <TemplateCard template={tpl} onIngest={setIngestTarget} />
                </GalleryItem>
              ))}
            </Gallery>
          </div>
        ))}

      {/* Ingest modal */}
      {ingestTarget && (
        <IngestModal
          template={ingestTarget}
          onClose={() => setIngestTarget(null)}
          onSuccess={handleIngestSuccess}
        />
      )}
    </PageLayout>
  );
}
