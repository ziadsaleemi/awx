import {
  Alert,
  Button,
  ClipboardCopy,
  Label,
  LabelGroup,
  Tab,
  Tabs,
  TabTitleText,
} from '@patternfly/react-core';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import styled from 'styled-components';
import {
  DateTimeCell,
  LoadingPage,
  PageDetail,
  PageDetails,
  PageHeader,
  PageLayout,
} from '../../../../framework';
import { PageDetailCodeEditor } from '../../../../framework/PageDetails/PageDetailCodeEditor';
import { AwxItemsResponse } from '../../common/AwxItemsResponse';
import { AwxError } from '../../common/AwxError';
import { awxAPI } from '../../common/api/awx-utils';
import { useGet } from '../../../common/crud/useGet';
import {
  GalaxyNgRecord,
  GalaxyNgResourceKind,
  decodeGalaxyNgRouteKey,
  galaxyNgRecordMatchesKey,
  galaxyNgResourceNativeRoutes,
  galaxyNgResourceTitles,
  getGalaxyNgContentItems,
  getGalaxyNgDependencies,
  getGalaxyNgCollectionName,
  getGalaxyNgDate,
  getGalaxyNgDescription,
  getGalaxyNgInstallCommand,
  getGalaxyNgLatestVersion,
  getGalaxyNgOwnerNames,
  getGalaxyNgRepositoryName,
  getGalaxyNgSignatureState,
} from './GalaxyNgResourceList';
import { GalaxyNgHeaderActions } from './GalaxyNgHeaderActions';
import { GalaxyNgStatus } from './GalaxyNgOverview';

const galaxyNgResourceKinds: GalaxyNgResourceKind[] = [
  'namespaces',
  'collections',
  'repositories',
  'remotes',
  'remote-registries',
  'signature-keys',
  'collection-approvals',
  'tasks',
];

function isGalaxyNgResourceKind(value: string | undefined): value is GalaxyNgResourceKind {
  return galaxyNgResourceKinds.includes(value as GalaxyNgResourceKind);
}

function getRecordTitle(resource: GalaxyNgResourceKind, record?: GalaxyNgRecord, fallback = '') {
  if (!record) return fallback;
  if (resource === 'collections' || resource === 'collection-approvals') {
    return getGalaxyNgCollectionName(record);
  }
  if (resource === 'tasks') {
    return record.name || record.pulp_href || record.href || fallback;
  }
  return (
    record.name ||
    record.namespace ||
    record.base_path ||
    record.pulp_href ||
    record.href ||
    fallback
  );
}

function Labels(props: { values: string[] }) {
  const values = props.values.filter(Boolean);
  if (!values.length) return <>-</>;
  return (
    <LabelGroup numLabels={8}>
      {values.map((value) => (
        <Label key={value} color="blue">
          {value}
        </Label>
      ))}
    </LabelGroup>
  );
}

function CopyValue(props: { value?: string | null }) {
  if (!props.value) return <>-</>;
  return (
    <ClipboardCopy isReadOnly hoverTip="Copy" clickTip="Copied">
      {props.value}
    </ClipboardCopy>
  );
}

function formatBytes(value: number | undefined) {
  if (value === undefined || Number.isNaN(value)) return '';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function dependencyLabels(dependencies: Record<string, string>) {
  return Object.entries(dependencies).map(([name, version]) =>
    version ? `${name} ${version}` : name
  );
}

function contentLabels(record: GalaxyNgRecord) {
  return getGalaxyNgContentItems(record).map((content) =>
    [content.name, content.content_type || content.type || content.object_type]
      .filter(Boolean)
      .join(' - ')
  );
}

function BoolLabel(props: { value?: boolean; trueText: string; falseText: string }) {
  return (
    <Label color={props.value ? 'green' : 'grey'}>
      {props.value ? props.trueText : props.falseText}
    </Label>
  );
}

function getProgress(record: GalaxyNgRecord) {
  const progress = record.progress_reports || [];
  if (!progress.length) return [];
  return progress.map((item) =>
    [
      item.message,
      item.state,
      item.done !== undefined && item.total !== undefined ? `${item.done}/${item.total}` : '',
    ]
      .filter(Boolean)
      .join(' - ')
  );
}

const COLLECTION_TAB_INSTALL = 'install';
const COLLECTION_TAB_DOCUMENTATION = 'documentation';
const COLLECTION_TAB_CONTENTS = 'contents';
const COLLECTION_TAB_IMPORT_LOG = 'import-log';
const COLLECTION_TAB_DEPENDENCIES = 'dependencies';
const COLLECTION_TAB_DISTRIBUTIONS = 'distributions';

type CollectionTabKey =
  | typeof COLLECTION_TAB_INSTALL
  | typeof COLLECTION_TAB_DOCUMENTATION
  | typeof COLLECTION_TAB_CONTENTS
  | typeof COLLECTION_TAB_IMPORT_LOG
  | typeof COLLECTION_TAB_DEPENDENCIES
  | typeof COLLECTION_TAB_DISTRIBUTIONS;

const CollectionDetailChrome = styled.div`
  padding: 0 24px 24px;
`;

const CollectionVersionBar = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 16px 32px;
  align-items: center;
  padding: 20px 0;
  border-bottom: 1px solid var(--pf-v5-global--BorderColor--100);
`;

const CollectionVersionItem = styled.div`
  display: flex;
  gap: 8px;
  align-items: baseline;
  color: var(--pf-v5-global--Color--200);
`;

const CollectionVersionValue = styled.span`
  color: var(--pf-v5-global--Color--100);
  font-weight: 600;
`;

const CollectionTabHeader = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--pf-v5-global--BorderColor--100);

  .pf-v5-c-tabs {
    background-color: var(--pf-v5-c-tabs__link--BackgroundColor);
    flex-shrink: 0;
  }
`;

const CollectionExternalLinks = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
`;

const CollectionTabPanel = styled.div`
  padding: 24px 0 0;
`;

const CollectionBodyText = styled.div`
  max-width: 980px;
  color: var(--pf-v5-global--Color--100);
  font-size: var(--pf-v5-global--FontSize--md);
  line-height: 1.5;
`;

const CollectionTagRow = styled.div`
  margin-top: 16px;
`;

function getLatestVersionDetailValue(record: GalaxyNgRecord, key: string) {
  const detail = record.latest_version_detail;
  if (!detail || typeof detail !== 'object') return undefined;
  return detail[key];
}

function getCollectionDocumentation(record: GalaxyNgRecord) {
  const documentation = record.metadata?.documentation;
  if (typeof documentation === 'string' && documentation.trim()) return documentation;
  const detailDocumentation = getLatestVersionDetailValue(record, 'documentation');
  return typeof detailDocumentation === 'string' ? detailDocumentation.trim() : '';
}

function getCollectionImportLog(record: GalaxyNgRecord) {
  const importLog = getLatestVersionDetailValue(record, 'import_log');
  if (Array.isArray(importLog)) return importLog.map((item) => String(item));
  if (typeof importLog === 'string' && importLog.trim()) return [importLog];
  return [];
}

function getCollectionExternalLinks(record: GalaxyNgRecord) {
  return [
    { label: 'Website', value: record.metadata?.homepage || '' },
    { label: 'Issue tracker', value: record.metadata?.issues || '' },
    { label: 'Repo', value: record.metadata?.repository || '' },
  ].filter((item) => item.value);
}

function CollectionVersionSummary(props: { record: GalaxyNgRecord }) {
  const { t } = useTranslation();
  const { record } = props;
  const latestVersion = getGalaxyNgLatestVersion(record);
  const signatureState = getGalaxyNgSignatureState(record);
  const isSigned = signatureState === 'signed';

  return (
    <CollectionVersionBar>
      <CollectionVersionItem>
        <span>{t('Repository')}</span>
        <CollectionVersionValue>{getGalaxyNgRepositoryName(record) || '-'}</CollectionVersionValue>
      </CollectionVersionItem>
      <CollectionVersionItem>
        <span>{t('Version')}</span>
        <CollectionVersionValue>{latestVersion || '-'}</CollectionVersionValue>
      </CollectionVersionItem>
      <CollectionVersionItem>
        <span>{t('Last updated')}</span>
        <CollectionVersionValue>
          <DateTimeCell value={record.version_updated_at || getGalaxyNgDate(record)} />
        </CollectionVersionValue>
      </CollectionVersionItem>
      {signatureState ? (
        <Label color={isSigned ? 'green' : 'orange'} variant="outline">
          {isSigned ? t('Signed') : t('Unsigned')}
        </Label>
      ) : null}
    </CollectionVersionBar>
  );
}

function CollectionInstallTab(props: { record: GalaxyNgRecord }) {
  const { t } = useTranslation();
  const { record } = props;
  const tags = record.metadata?.tags || [];
  const license = Array.isArray(record.metadata?.license) ? record.metadata.license : [];

  return (
    <>
      <CollectionBodyText>
        {getGalaxyNgDescription(record) || t('No collection description has been published yet.')}
      </CollectionBodyText>
      {tags.length ? (
        <CollectionTagRow>
          <Labels values={tags} />
        </CollectionTagRow>
      ) : null}
      <PageDetails numberOfColumns="single" disableScroll>
        <PageDetail label={t('License')} isEmpty={!license.length}>
          <Labels values={license} />
        </PageDetail>
        <PageDetail label={t('Installation')} isEmpty={!getGalaxyNgInstallCommand(record)}>
          <CopyValue value={getGalaxyNgInstallCommand(record)} />
        </PageDetail>
        <PageDetail label={t('Download tarball')} isEmpty={!record.download_url}>
          <CopyValue value={record.download_url} />
        </PageDetail>
        <PageDetail label={t('Artifact')} isEmpty={!record.artifact?.filename}>
          {record.artifact?.filename}
        </PageDetail>
        <PageDetail label={t('Artifact size')} isEmpty={record.artifact?.size === undefined}>
          {formatBytes(record.artifact?.size)}
        </PageDetail>
        <PageDetail label={t('Artifact checksum')} isEmpty={!record.artifact?.sha256}>
          <CopyValue value={record.artifact?.sha256} />
        </PageDetail>
        <PageDetail label={t('Requires Ansible')} isEmpty={!record.requires_ansible}>
          {record.requires_ansible}
        </PageDetail>
      </PageDetails>
    </>
  );
}

function CollectionDocumentationTab(props: { record: GalaxyNgRecord }) {
  const { t } = useTranslation();
  const documentation = getCollectionDocumentation(props.record);

  if (!documentation) {
    return (
      <Alert isInline variant="info" title={t('No documentation was returned by Galaxy NG.')}>
        {t('Publish collection documentation in Galaxy NG to display it here.')}
      </Alert>
    );
  }

  return (
    <PageDetailCodeEditor
      label={t('Documentation')}
      value={documentation}
      fullWidth
      toggleLanguage={false}
    />
  );
}

function CollectionContentsTab(props: { record: GalaxyNgRecord }) {
  const { t } = useTranslation();
  const contents = getGalaxyNgContentItems(props.record);

  if (!contents.length) {
    return (
      <Alert isInline variant="info" title={t('No content list was returned by Galaxy NG.')} />
    );
  }

  return (
    <Table variant="compact" aria-label={t('Galaxy NG collection contents')}>
      <Thead>
        <Tr>
          <Th>{t('Name')}</Th>
          <Th>{t('Type')}</Th>
          <Th>{t('Description')}</Th>
        </Tr>
      </Thead>
      <Tbody>
        {contents.map((content, index) => (
          <Tr key={`${content.name || index}-${content.content_type || content.type || ''}`}>
            <Td dataLabel={t('Name')}>{content.name || '-'}</Td>
            <Td dataLabel={t('Type')}>
              {content.content_type || content.type || content.object_type || '-'}
            </Td>
            <Td dataLabel={t('Description')}>{content.description || '-'}</Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}

function CollectionImportLogTab(props: { record: GalaxyNgRecord }) {
  const { t } = useTranslation();
  const importLog = getCollectionImportLog(props.record);

  if (!importLog.length) {
    return (
      <Alert isInline variant="info" title={t('No import log was returned by Galaxy NG.')}>
        {t('Galaxy NG did not include import log entries for this collection version.')}
      </Alert>
    );
  }

  return (
    <PageDetailCodeEditor
      label={t('Import log')}
      value={importLog.join('\n')}
      fullWidth
      toggleLanguage={false}
    />
  );
}

function CollectionDependenciesTab(props: { record: GalaxyNgRecord }) {
  const { t } = useTranslation();
  const dependencies = getGalaxyNgDependencies(props.record);
  const items = Object.entries(dependencies);

  if (!items.length) {
    return (
      <Alert isInline variant="info" title={t('No dependencies declared for this collection.')} />
    );
  }

  return (
    <Table variant="compact" aria-label={t('Galaxy NG collection dependencies')}>
      <Thead>
        <Tr>
          <Th>{t('Collection')}</Th>
          <Th>{t('Version requirement')}</Th>
        </Tr>
      </Thead>
      <Tbody>
        {items.map(([name, version]) => (
          <Tr key={name}>
            <Td dataLabel={t('Collection')}>{name}</Td>
            <Td dataLabel={t('Version requirement')}>{version || '-'}</Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}

function CollectionDistributionsTab(props: { record: GalaxyNgRecord }) {
  const { t } = useTranslation();
  const { record } = props;

  return (
    <PageDetails numberOfColumns="single" disableScroll>
      <PageDetail label={t('Repository')} isEmpty={!getGalaxyNgRepositoryName(record)}>
        {getGalaxyNgRepositoryName(record)}
      </PageDetail>
      <PageDetail label={t('Installation')} isEmpty={!getGalaxyNgInstallCommand(record)}>
        <CopyValue value={getGalaxyNgInstallCommand(record)} />
      </PageDetail>
      <PageDetail label={t('Download tarball')} isEmpty={!record.download_url}>
        <CopyValue value={record.download_url} />
      </PageDetail>
      <PageDetail label={t('API href')} isEmpty={!record.href}>
        <CopyValue value={record.href} />
      </PageDetail>
      <PageDetail label={t('Pulp href')} isEmpty={!record.pulp_href}>
        <CopyValue value={record.pulp_href} />
      </PageDetail>
    </PageDetails>
  );
}

function CollectionDetailsTabs(props: { record: GalaxyNgRecord }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<CollectionTabKey>(COLLECTION_TAB_INSTALL);
  const externalLinks = getCollectionExternalLinks(props.record);

  return (
    <>
      <CollectionTabHeader>
        <Tabs
          activeKey={activeTab}
          inset={{ default: 'insetSm' }}
          isBox
          onSelect={(event, key) => {
            event.preventDefault();
            setActiveTab(key as CollectionTabKey);
          }}
        >
          <Tab
            eventKey={COLLECTION_TAB_INSTALL}
            title={<TabTitleText>{t('Install')}</TabTitleText>}
          />
          <Tab
            eventKey={COLLECTION_TAB_DOCUMENTATION}
            title={<TabTitleText>{t('Documentation')}</TabTitleText>}
          />
          <Tab
            eventKey={COLLECTION_TAB_CONTENTS}
            title={<TabTitleText>{t('Contents')}</TabTitleText>}
          />
          <Tab
            eventKey={COLLECTION_TAB_IMPORT_LOG}
            title={<TabTitleText>{t('Import log')}</TabTitleText>}
          />
          <Tab
            eventKey={COLLECTION_TAB_DEPENDENCIES}
            title={<TabTitleText>{t('Dependencies')}</TabTitleText>}
          />
          <Tab
            eventKey={COLLECTION_TAB_DISTRIBUTIONS}
            title={<TabTitleText>{t('Distributions')}</TabTitleText>}
          />
        </Tabs>
        {externalLinks.length ? (
          <CollectionExternalLinks>
            {externalLinks.map((link) => (
              <Button
                key={link.label}
                component="a"
                href={link.value}
                target="_blank"
                rel="noreferrer"
                variant="link"
                isInline
              >
                {link.label === 'Website'
                  ? t('Website')
                  : link.label === 'Issue tracker'
                    ? t('Issue tracker')
                    : t('Repo')}
              </Button>
            ))}
          </CollectionExternalLinks>
        ) : null}
      </CollectionTabHeader>
      <CollectionTabPanel>
        {activeTab === COLLECTION_TAB_INSTALL ? (
          <CollectionInstallTab record={props.record} />
        ) : null}
        {activeTab === COLLECTION_TAB_DOCUMENTATION ? (
          <CollectionDocumentationTab record={props.record} />
        ) : null}
        {activeTab === COLLECTION_TAB_CONTENTS ? (
          <CollectionContentsTab record={props.record} />
        ) : null}
        {activeTab === COLLECTION_TAB_IMPORT_LOG ? (
          <CollectionImportLogTab record={props.record} />
        ) : null}
        {activeTab === COLLECTION_TAB_DEPENDENCIES ? (
          <CollectionDependenciesTab record={props.record} />
        ) : null}
        {activeTab === COLLECTION_TAB_DISTRIBUTIONS ? (
          <CollectionDistributionsTab record={props.record} />
        ) : null}
      </CollectionTabPanel>
    </>
  );
}

function GalaxyNgCollectionDetails(props: {
  record: GalaxyNgRecord;
  resource: GalaxyNgResourceKind;
  resourceTitle: string;
  status?: GalaxyNgStatus;
  title: string;
}) {
  const { t } = useTranslation();
  const { record, resource, resourceTitle, status, title } = props;

  return (
    <PageLayout>
      <PageHeader
        title={title}
        description={resourceTitle}
        breadcrumbs={[
          { label: t('Automation Hub'), to: '/galaxy-ng/overview' },
          { label: resourceTitle, to: `/galaxy-ng/${resource}` },
          { label: title },
        ]}
        headerActions={
          <GalaxyNgHeaderActions
            status={status}
            uiRoute={galaxyNgResourceNativeRoutes[resource]}
            page={title}
            prompt={t(
              'Help me review this Galaxy NG collection in AWX. Explain install steps, contents, dependencies, signatures, and follow-up actions.'
            )}
            context={{
              resource,
              title,
              record,
              configured: status?.configured,
              server_url: status?.server_url,
            }}
          />
        }
      />
      {record.version_detail_error ? (
        <Alert
          isInline
          variant="warning"
          title={t('Could not load latest collection version metadata.')}
          style={{ margin: '24px 24px 0' }}
        >
          {record.version_detail_error}
        </Alert>
      ) : null}
      <CollectionDetailChrome>
        <CollectionVersionSummary record={record} />
        <CollectionDetailsTabs record={record} />
      </CollectionDetailChrome>
    </PageLayout>
  );
}

export function GalaxyNgResourceDetails() {
  const { t } = useTranslation();
  const params = useParams<{ resource: string; resourceKey: string }>();
  const validResource = isGalaxyNgResourceKind(params.resource);
  const resource = validResource ? params.resource : 'collections';
  const decodedKey = decodeGalaxyNgRouteKey(params.resourceKey);
  const status = useGet<GalaxyNgStatus>(awxAPI`/galaxy_ng/status/`);
  const response = useGet<AwxItemsResponse<GalaxyNgRecord>>(
    validResource ? awxAPI`/galaxy_ng/${resource}/` : undefined,
    { page_size: 200 }
  );

  if (!validResource) {
    return (
      <PageLayout>
        <PageHeader
          title={t('Galaxy NG resource not found')}
          breadcrumbs={[{ label: t('Automation Hub'), to: '/galaxy-ng/overview' }]}
        />
        <Alert
          isInline
          variant="warning"
          title={t('This Galaxy NG resource route is not available.')}
          style={{ margin: 24 }}
        />
      </PageLayout>
    );
  }

  if (response.error) return <AwxError error={response.error} handleRefresh={response.refresh} />;
  if (response.isLoading || !response.data) return <LoadingPage breadcrumbs />;

  const record = response.data.results.find((item) =>
    galaxyNgRecordMatchesKey(resource, item, params.resourceKey)
  );
  const resourceTitle = t(galaxyNgResourceTitles[resource]);
  const title = getRecordTitle(resource, record, decodedKey || resourceTitle);

  if (!record) {
    return (
      <PageLayout>
        <PageHeader
          title={title}
          breadcrumbs={[
            { label: t('Automation Hub'), to: '/galaxy-ng/overview' },
            { label: resourceTitle, to: `/galaxy-ng/${resource}` },
            { label: title },
          ]}
        />
        <Alert
          isInline
          variant="warning"
          title={t('Galaxy NG resource was not found in the current page of API results.')}
          style={{ margin: 24 }}
        >
          {t('Refresh the resource list or verify the item still exists in Galaxy NG.')}
        </Alert>
      </PageLayout>
    );
  }

  if (resource === 'collections') {
    return (
      <GalaxyNgCollectionDetails
        record={record}
        resource={resource}
        resourceTitle={resourceTitle}
        status={status.data}
        title={title}
      />
    );
  }

  const description = getGalaxyNgDescription(record);
  const latestVersion = getGalaxyNgLatestVersion(record);
  const tags = record.metadata?.tags || [];
  const owners = getGalaxyNgOwnerNames(record);
  const repository = getGalaxyNgRepositoryName(record);
  const signatureState = getGalaxyNgSignatureState(record);
  const dependencies = getGalaxyNgDependencies(record);
  const installCommand = getGalaxyNgInstallCommand(record);
  const authors = record.metadata?.authors || [];
  const license = Array.isArray(record.metadata?.license) ? record.metadata.license : [];
  const homepage = record.metadata?.homepage || '';
  const issueTracker = record.metadata?.issues || '';
  const sourceRepository = record.metadata?.repository || '';

  return (
    <PageLayout>
      <PageHeader
        title={title}
        description={resourceTitle}
        breadcrumbs={[
          { label: t('Automation Hub'), to: '/galaxy-ng/overview' },
          { label: resourceTitle, to: `/galaxy-ng/${resource}` },
          { label: title },
        ]}
        headerActions={
          <GalaxyNgHeaderActions
            status={status.data}
            uiRoute={galaxyNgResourceNativeRoutes[resource]}
            page={title}
            prompt={t(
              'Help me review this Galaxy NG resource in AWX. Explain what it is, what metadata matters, and what follow-up actions make sense.'
            )}
            context={{
              resource,
              title,
              record,
              configured: status.data?.configured,
              server_url: status.data?.server_url,
            }}
          />
        }
      />
      {record.version_detail_error ? (
        <Alert
          isInline
          variant="warning"
          title={t('Could not load latest collection version metadata.')}
          style={{ margin: '24px 24px 0' }}
        >
          {record.version_detail_error}
        </Alert>
      ) : null}
      <PageDetails numberOfColumns="multiple">
        <PageDetail label={t('Name')}>{record.name || record.namespace || title}</PageDetail>
        <PageDetail label={t('Resource type')}>{resourceTitle}</PageDetail>
        <PageDetail label={t('Namespace')} isEmpty={!record.namespace}>
          {record.namespace}
        </PageDetail>
        <PageDetail label={t('Repository')} isEmpty={!repository}>
          {repository}
        </PageDetail>
        <PageDetail label={t('Description')} isEmpty={!description}>
          {description}
        </PageDetail>
        <PageDetail label={t('Latest version')} isEmpty={!latestVersion}>
          {latestVersion}
        </PageDetail>
        <PageDetail label={t('Signature')} isEmpty={!signatureState}>
          <Label color={signatureState === 'signed' ? 'green' : 'orange'} variant="outline">
            {signatureState === 'signed' ? t('Signed') : t('Unsigned')}
          </Label>
        </PageDetail>
        <PageDetail label={t('Requires Ansible')} isEmpty={!record.requires_ansible}>
          {record.requires_ansible}
        </PageDetail>
        <PageDetail label={t('Installation')} isEmpty={!installCommand}>
          <CopyValue value={installCommand} />
        </PageDetail>
        <PageDetail label={t('State')} isEmpty={!record.state && record.deprecated === undefined}>
          {record.state ? (
            <Label
              color={record.state === 'completed' || record.state === 'success' ? 'green' : 'grey'}
            >
              {record.state}
            </Label>
          ) : (
            <BoolLabel
              value={!record.deprecated}
              trueText={t('Active')}
              falseText={t('Deprecated')}
            />
          )}
        </PageDetail>
        <PageDetail label={t('Downloads')} isEmpty={record.download_count === undefined}>
          {record.download_count}
        </PageDetail>
        <PageDetail label={t('Download tarball')} isEmpty={!record.download_url}>
          <CopyValue value={record.download_url} />
        </PageDetail>
        <PageDetail label={t('Artifact')} isEmpty={!record.artifact?.filename}>
          {record.artifact?.filename}
        </PageDetail>
        <PageDetail label={t('Artifact size')} isEmpty={record.artifact?.size === undefined}>
          {formatBytes(record.artifact?.size)}
        </PageDetail>
        <PageDetail label={t('Artifact checksum')} isEmpty={!record.artifact?.sha256}>
          <CopyValue value={record.artifact?.sha256} />
        </PageDetail>
        <PageDetail label={t('Authors')} isEmpty={!authors.length}>
          <Labels values={authors} />
        </PageDetail>
        <PageDetail label={t('License')} isEmpty={!license.length}>
          <Labels values={license} />
        </PageDetail>
        <PageDetail label={t('Company')} isEmpty={!record.company}>
          {record.company}
        </PageDetail>
        <PageDetail label={t('Email')} isEmpty={!record.email}>
          {record.email}
        </PageDetail>
        <PageDetail label={t('Owners')} isEmpty={!owners.length}>
          <Labels values={owners} />
        </PageDetail>
        <PageDetail label={t('Tags')} isEmpty={!tags.length}>
          <Labels values={tags} />
        </PageDetail>
        <PageDetail label={t('Contents')} isEmpty={!contentLabels(record).length}>
          <Labels values={contentLabels(record)} />
        </PageDetail>
        <PageDetail label={t('Dependencies')} isEmpty={!Object.keys(dependencies).length}>
          <Labels values={dependencyLabels(dependencies)} />
        </PageDetail>
        <PageDetail label={t('Website')} isEmpty={!homepage}>
          <CopyValue value={homepage} />
        </PageDetail>
        <PageDetail label={t('Issue tracker')} isEmpty={!issueTracker}>
          <CopyValue value={issueTracker} />
        </PageDetail>
        <PageDetail label={t('Source repository')} isEmpty={!sourceRepository}>
          <CopyValue value={sourceRepository} />
        </PageDetail>
        <PageDetail label={t('Repositories')} isEmpty={!record.repository_list?.length}>
          <Labels values={record.repository_list || []} />
        </PageDetail>
        <PageDetail label={t('Remote')} isEmpty={!record.remote}>
          {record.remote}
        </PageDetail>
        <PageDetail label={t('Policy')} isEmpty={!record.policy}>
          {record.policy}
        </PageDetail>
        <PageDetail label={t('URL')} isEmpty={!record.url}>
          <CopyValue value={record.url} />
        </PageDetail>
        <PageDetail label={t('Pulp href')} isEmpty={!record.pulp_href}>
          <CopyValue value={record.pulp_href} />
        </PageDetail>
        <PageDetail label={t('API href')} isEmpty={!record.href}>
          <CopyValue value={record.href} />
        </PageDetail>
        <PageDetail label={t('Metadata checksum')} isEmpty={!record.metadata_sha256}>
          <CopyValue value={record.metadata_sha256} />
        </PageDetail>
        <PageDetail label={t('Fingerprint')} isEmpty={!record.pubkey_fingerprint}>
          <CopyValue value={record.pubkey_fingerprint} />
        </PageDetail>
        <PageDetail label={t('Progress')} isEmpty={!getProgress(record).length}>
          <Labels values={getProgress(record)} />
        </PageDetail>
        <PageDetail label={t('Created')} isEmpty={!record.created_at && !record.pulp_created}>
          <DateTimeCell value={record.created_at || record.pulp_created} />
        </PageDetail>
        <PageDetail label={t('Updated')} isEmpty={!getGalaxyNgDate(record)}>
          <DateTimeCell value={getGalaxyNgDate(record)} />
        </PageDetail>
        <PageDetailCodeEditor
          label={t('Galaxy NG payload')}
          value={JSON.stringify(record, null, 2)}
          fullWidth
        />
      </PageDetails>
    </PageLayout>
  );
}
