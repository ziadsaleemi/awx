import { useEffect, useState } from 'react';
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
  FormSelect,
  FormSelectOption,
  Gallery,
  GalleryItem,
  HelperText,
  HelperTextItem,
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
import { CloudIcon, DownloadIcon, StoreIcon } from '@patternfly/react-icons';
import { PageHeader, PageLayout } from '../../../../framework';
import { awxAPI } from '../../common/api/awx-utils';
import { postRequest } from '../../../common/crud/Data';
import { useGet } from '../../../common/crud/useGet';
import { useAwxActiveUser } from '../../common/useAwxActiveUser';

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
  source?: string;
  organization?: number | null;
}

interface MarketplaceProvider {
  id: string;
  label: string;
  templates: MarketplaceTemplate[];
  source?: string;
}

interface MarketplaceListResponse {
  count: number;
  providers: MarketplaceProvider[];
}

interface OrganizationOption {
  id: number;
  name: string;
}

interface OrganizationListResponse {
  results: OrganizationOption[];
}

interface TemplateOption {
  id: number;
  name: string;
}

interface TemplateListResponse<T extends TemplateOption> {
  results: T[];
}

type ProvisionTargetType = 'terraform' | 'workflow';

const EMPTY_ORGANIZATIONS: OrganizationOption[] = [];
const EMPTY_TEMPLATE_OPTIONS: TemplateOption[] = [];

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
  organizations: OrganizationOption[];
  isLoadingOrganizations: boolean;
  defaultOrganizationId?: string;
  onClose: () => void;
  onSuccess: (name: string) => void;
}

function IngestModal({
  template,
  organizations,
  isLoadingOrganizations,
  defaultOrganizationId,
  onClose,
  onSuccess,
}: IngestModalProps) {
  const { t } = useTranslation();
  const [itemName, setItemName] = useState(template.name);
  const [organizationId, setOrganizationId] = useState('');
  const [isOrganizationSelectOpen, setIsOrganizationSelectOpen] = useState(false);
  const [provisionTargetType, setProvisionTargetType] = useState<ProvisionTargetType>('terraform');
  const [provisionTargetId, setProvisionTargetId] = useState('');
  const [deprovisionWorkflowId, setDeprovisionWorkflowId] = useState('');
  const [configureWorkflowId, setConfigureWorkflowId] = useState('');
  const [validateWorkflowId, setValidateWorkflowId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const workflowTemplatesUrl = organizationId
    ? `${awxAPI`/workflow_job_templates/`}?organization=${organizationId}&order_by=name&page_size=200`
    : undefined;
  const terraformTemplatesUrl = organizationId
    ? `${awxAPI`/terraform_job_templates/`}?organization=${organizationId}&order_by=name&page_size=200`
    : undefined;
  const {
    data: workflowTemplatesData,
    isLoading: isLoadingWorkflowTemplates,
    error: workflowTemplatesError,
  } = useGet<TemplateListResponse<TemplateOption>>(workflowTemplatesUrl);
  const {
    data: terraformTemplatesData,
    isLoading: isLoadingTerraformTemplates,
    error: terraformTemplatesError,
  } = useGet<TemplateListResponse<TemplateOption>>(terraformTemplatesUrl);
  const workflowTemplates = workflowTemplatesData?.results ?? EMPTY_TEMPLATE_OPTIONS;
  const terraformTemplates = terraformTemplatesData?.results ?? EMPTY_TEMPLATE_OPTIONS;
  const isLoadingTargets = isLoadingWorkflowTemplates || isLoadingTerraformTemplates;
  const hasTerraformTargets = terraformTemplates.length > 0;
  const hasWorkflowTargets = workflowTemplates.length > 0;
  const targetOptions =
    provisionTargetType === 'terraform' ? terraformTemplates : workflowTemplates;

  useEffect(() => {
    if (organizations.length === 0) {
      if (organizationId) setOrganizationId('');
      return;
    }
    if (
      defaultOrganizationId &&
      organizations.some((organization) => String(organization.id) === defaultOrganizationId) &&
      organizationId !== defaultOrganizationId
    ) {
      setOrganizationId(defaultOrganizationId);
      return;
    }
    if (
      (!organizationId ||
        !organizations.some((organization) => String(organization.id) === organizationId)) &&
      organizations.length > 0
    ) {
      setOrganizationId(String(organizations[0].id));
    }
  }, [defaultOrganizationId, organizationId, organizations]);

  useEffect(() => {
    setProvisionTargetId('');
    setDeprovisionWorkflowId('');
    setConfigureWorkflowId('');
    setValidateWorkflowId('');
  }, [organizationId]);

  useEffect(() => {
    if (isLoadingTargets) return;
    if (provisionTargetType === 'terraform' && !hasTerraformTargets && hasWorkflowTargets) {
      setProvisionTargetType('workflow');
    }
    if (provisionTargetType === 'workflow' && !hasWorkflowTargets && hasTerraformTargets) {
      setProvisionTargetType('terraform');
    }
  }, [hasTerraformTargets, hasWorkflowTargets, isLoadingTargets, provisionTargetType]);

  const selectedOrganizationName =
    organizations.find((organization) => String(organization.id) === organizationId)?.name ??
    t('Select organization');

  const handleIngest = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        provider: template.provider,
        template_id: template.id,
        name: itemName,
        organization: Number(organizationId),
      };
      if (provisionTargetType === 'terraform') {
        payload.terraform_job_template = Number(provisionTargetId);
      } else {
        payload.provision_workflow = Number(provisionTargetId);
      }
      if (deprovisionWorkflowId) {
        payload.deprovision_workflow = Number(deprovisionWorkflowId);
      }
      if (configureWorkflowId) {
        payload.configure_workflow = Number(configureWorkflowId);
      }
      if (validateWorkflowId) {
        payload.validate_workflow = Number(validateWorkflowId);
      }
      await postRequest(awxAPI`/marketplace/ingest/`, payload);
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
      variant={ModalVariant.large}
      title={t('Import as Catalog Item')}
      isOpen
      onClose={onClose}
    >
      <ModalBoxBody>
        {error && (
          <Alert
            variant="danger"
            title={t('Ingestion error')}
            isInline
            style={{ marginBottom: 16 }}
          >
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
          <FormGroup label={t('Organization')} isRequired fieldId="organization">
            <Select
              isOpen={isOrganizationSelectOpen}
              selected={organizationId}
              onSelect={(_ev, value) => {
                setOrganizationId(String(value));
                setIsOrganizationSelectOpen(false);
              }}
              onOpenChange={setIsOrganizationSelectOpen}
              toggle={(ref) => (
                <Button
                  id="organization"
                  ref={ref}
                  variant="control"
                  onClick={() => setIsOrganizationSelectOpen(!isOrganizationSelectOpen)}
                  isDisabled={isLoadingOrganizations || organizations.length === 0}
                >
                  {isLoadingOrganizations
                    ? t('Loading organizations...')
                    : selectedOrganizationName}
                </Button>
              )}
            >
              <SelectList>
                {organizations.map((organization) => (
                  <SelectOption key={organization.id} value={String(organization.id)}>
                    {organization.name}
                  </SelectOption>
                ))}
              </SelectList>
            </Select>
          </FormGroup>
          <FormGroup label={t('Catalog item name')} isRequired fieldId="item-name">
            <TextInput
              id="item-name"
              value={itemName}
              onChange={(_ev, v) => setItemName(v)}
              isRequired
            />
          </FormGroup>
          <FormGroup
            label={t('Provisioning target type')}
            isRequired
            fieldId="provision-target-type"
          >
            <FormSelect
              id="provision-target-type"
              value={provisionTargetType}
              onChange={(_ev, value) => {
                setProvisionTargetType(value as ProvisionTargetType);
                setProvisionTargetId('');
              }}
              isDisabled={isLoadingTargets}
            >
              <FormSelectOption
                value="terraform"
                label={t('Terraform template')}
                isDisabled={!hasTerraformTargets && !isLoadingTerraformTemplates}
              />
              <FormSelectOption
                value="workflow"
                label={t('Provision workflow')}
                isDisabled={!hasWorkflowTargets && !isLoadingWorkflowTemplates}
              />
            </FormSelect>
            <HelperText>
              <HelperTextItem>
                {t('Imported marketplace items must have a launch target before users can deploy.')}
              </HelperTextItem>
            </HelperText>
          </FormGroup>
          <FormGroup label={t('Provisioning target')} isRequired fieldId="provision-target">
            <FormSelect
              id="provision-target"
              value={provisionTargetId}
              onChange={(_ev, value) => setProvisionTargetId(value)}
              isDisabled={isLoadingTargets || targetOptions.length === 0}
            >
              <FormSelectOption
                value=""
                label={
                  isLoadingTargets
                    ? t('Loading targets...')
                    : targetOptions.length === 0
                      ? t('No targets available')
                      : t('Select a target')
                }
              />
              {targetOptions.map((target) => (
                <FormSelectOption key={target.id} value={String(target.id)} label={target.name} />
              ))}
            </FormSelect>
          </FormGroup>
          <FormGroup label={t('Deprovision workflow')} fieldId="deprovision-workflow">
            <FormSelect
              id="deprovision-workflow"
              value={deprovisionWorkflowId}
              onChange={(_ev, value) => setDeprovisionWorkflowId(value)}
              isDisabled={isLoadingWorkflowTemplates}
            >
              <FormSelectOption value="" label={t('No deprovision workflow')} />
              {workflowTemplates.map((workflow) => (
                <FormSelectOption
                  key={workflow.id}
                  value={String(workflow.id)}
                  label={workflow.name}
                />
              ))}
            </FormSelect>
          </FormGroup>
          <FormGroup label={t('Configure workflow')} fieldId="configure-workflow">
            <FormSelect
              id="configure-workflow"
              value={configureWorkflowId}
              onChange={(_ev, value) => setConfigureWorkflowId(value)}
              isDisabled={isLoadingWorkflowTemplates}
            >
              <FormSelectOption value="" label={t('No configure workflow')} />
              {workflowTemplates.map((workflow) => (
                <FormSelectOption
                  key={workflow.id}
                  value={String(workflow.id)}
                  label={workflow.name}
                />
              ))}
            </FormSelect>
          </FormGroup>
          <FormGroup label={t('Validate workflow')} fieldId="validate-workflow">
            <FormSelect
              id="validate-workflow"
              value={validateWorkflowId}
              onChange={(_ev, value) => setValidateWorkflowId(value)}
              isDisabled={isLoadingWorkflowTemplates}
            >
              <FormSelectOption value="" label={t('No validate workflow')} />
              {workflowTemplates.map((workflow) => (
                <FormSelectOption
                  key={workflow.id}
                  value={String(workflow.id)}
                  label={workflow.name}
                />
              ))}
            </FormSelect>
          </FormGroup>
        </Form>

        {(workflowTemplatesError || terraformTemplatesError) && (
          <Alert
            variant="danger"
            title={t('Failed to load deployment targets')}
            isInline
            style={{ marginTop: 16 }}
          >
            {String(workflowTemplatesError || terraformTemplatesError)}
          </Alert>
        )}
        {!isLoadingTargets && !hasWorkflowTargets && !hasTerraformTargets && organizationId && (
          <Alert
            variant="warning"
            title={t('No deployment targets available')}
            isInline
            style={{ marginTop: 16 }}
          >
            {t(
              'Create a workflow job template or Terraform template in this organization before importing marketplace templates.'
            )}
          </Alert>
        )}
        <ActionGroup style={{ marginTop: 16 }}>
          <Button
            variant="primary"
            onClick={() => void handleIngest()}
            isDisabled={
              isLoading ||
              isLoadingTargets ||
              !itemName.trim() ||
              !organizationId ||
              !provisionTargetId
            }
            isLoading={isLoading}
            icon={<DownloadIcon />}
          >
            {t('Import')}
          </Button>
          <Button variant="link" onClick={onClose} isDisabled={isLoading}>
            {t('Cancel')}
          </Button>
        </ActionGroup>
        {!isLoadingOrganizations && organizations.length === 0 && (
          <Alert
            variant="warning"
            title={t('No organizations available')}
            isInline
            style={{ marginTop: 16 }}
          >
            {t('You must administer an organization before importing marketplace templates.')}
          </Alert>
        )}
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

  const selectedLabel = providers.find((p) => p.id === selected)?.label ?? t('All Providers');

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

interface OrganizationFilterProps {
  organizations: OrganizationOption[];
  selected: string;
  isLoading: boolean;
  onChange: (organizationId: string) => void;
}

function OrganizationFilter({
  organizations,
  selected,
  isLoading,
  onChange,
}: OrganizationFilterProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const selectedLabel =
    organizations.find((organization) => String(organization.id) === selected)?.name ??
    t('Select organization');

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
        <Button
          ref={ref}
          variant="control"
          onClick={() => setIsOpen(!isOpen)}
          isDisabled={isLoading || organizations.length === 0}
        >
          {isLoading ? t('Loading organizations...') : selectedLabel}
        </Button>
      )}
    >
      <SelectList>
        {organizations.map((organization) => (
          <SelectOption key={organization.id} value={String(organization.id)}>
            {organization.name}
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
  const { activeAwxUser } = useAwxActiveUser();
  const [providerFilter, setProviderFilter] = useState('');
  const [selectedOrganizationId, setSelectedOrganizationId] = useState('');
  const [ingestTarget, setIngestTarget] = useState<MarketplaceTemplate | null>(null);
  const [successName, setSuccessName] = useState<string | null>(null);

  const organizationsUrl = activeAwxUser?.is_superuser
    ? awxAPI`/organizations/?order_by=name&page_size=200`
    : activeAwxUser?.related?.admin_of_organizations;

  const {
    data: organizationsData,
    isLoading: isLoadingOrganizations,
    error: organizationsError,
  } = useGet<OrganizationListResponse>(organizationsUrl || undefined);

  const organizations = organizationsData?.results ?? EMPTY_ORGANIZATIONS;

  useEffect(() => {
    if (organizations.length === 0) {
      if (selectedOrganizationId) setSelectedOrganizationId('');
      return;
    }
    if (
      !selectedOrganizationId ||
      !organizations.some((organization) => String(organization.id) === selectedOrganizationId)
    ) {
      setSelectedOrganizationId(String(organizations[0].id));
    }
  }, [organizations, selectedOrganizationId]);

  const marketplaceQuery = new URLSearchParams();
  if (providerFilter) marketplaceQuery.set('provider', providerFilter);
  if (selectedOrganizationId) marketplaceQuery.set('organization', selectedOrganizationId);
  const marketplaceQueryString = marketplaceQuery.toString();
  const shouldWaitForOrganizationSelection =
    isLoadingOrganizations || (organizations.length > 0 && !selectedOrganizationId);
  const url =
    activeAwxUser && !shouldWaitForOrganizationSelection
      ? `${awxAPI`/marketplace/templates/`}${marketplaceQueryString ? `?${marketplaceQueryString}` : ''}`
      : undefined;

  const { data, isLoading, error } = useGet<MarketplaceListResponse>(url);
  const allProviders: MarketplaceProvider[] = data?.providers ?? [];
  const isWaitingForTemplateRequest = Boolean(activeAwxUser) && shouldWaitForOrganizationSelection;
  const isTemplateLoading = isLoading || isWaitingForTemplateRequest;

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
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontWeight: 500 }}>{t('Organization:')}</span>
        <OrganizationFilter
          organizations={organizations}
          selected={selectedOrganizationId}
          isLoading={isLoadingOrganizations}
          onChange={(organizationId) => {
            setSelectedOrganizationId(organizationId);
            setSuccessName(null);
          }}
        />
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
      {isTemplateLoading && (
        <div style={{ padding: '40px', textAlign: 'center' }}>
          <Spinner size="lg" />
        </div>
      )}

      {/* Error */}
      {url && error && !isTemplateLoading && (
        <div style={{ padding: '24px' }}>
          <Alert variant="danger" title={t('Failed to load marketplace templates')} isInline>
            {String(error)}
          </Alert>
        </div>
      )}

      {organizationsError && (
        <div style={{ padding: '0 24px 16px' }}>
          <Alert variant="danger" title={t('Failed to load organizations')} isInline>
            {String(organizationsError)}
          </Alert>
        </div>
      )}

      {/* Empty */}
      {url && !isTemplateLoading && !error && allProviders.length === 0 && (
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
      {!isTemplateLoading &&
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
          organizations={organizations}
          isLoadingOrganizations={isLoadingOrganizations}
          defaultOrganizationId={selectedOrganizationId}
          onClose={() => setIngestTarget(null)}
          onSuccess={handleIngestSuccess}
        />
      )}
    </PageLayout>
  );
}
