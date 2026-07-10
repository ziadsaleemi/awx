import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActionGroup,
  Alert,
  Button,
  Card,
  CardBody,
  CardTitle,
  ClipboardCopy,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Form,
  FormGroup,
  FormSelect,
  FormSelectOption,
  Gallery,
  GalleryItem,
  PageSection,
  Spinner,
  Stack,
  StackItem,
  Text,
  TextContent,
  TextInput,
  TextVariants,
  Title,
} from '@patternfly/react-core';
import { PageHeader, PageLayout, usePageAlertToaster } from '../../../../framework';
import { postRequest } from '../../../common/crud/Data';
import { useGet } from '../../../common/crud/useGet';
import { AwxItemsResponse } from '../../common/AwxItemsResponse';
import { awxAPI } from '../../common/api/awx-utils';
import { GalaxyNgHeaderActions } from './GalaxyNgHeaderActions';
import { GalaxyNgStatus } from './GalaxyNgOverview';

interface AwxProject {
  id: number;
  name: string;
  local_path?: string;
  scm_type?: string;
  scm_url?: string;
  scm_branch?: string;
  status?: string;
}

interface GalaxyNgImportPlanPayload {
  project_id: number;
  collection_path: string;
  artifact_dir: string;
}

interface GalaxyNgImportPlan {
  source: string;
  project: {
    project_id: number;
    project_name: string;
    scm_type: string;
    scm_url: string;
    scm_branch: string;
    scm_revision: string;
    local_path: string;
    project_path: string;
    collection_path: string;
    collection_root: string;
    galaxy_yml: string;
    artifact_dir: string;
    artifact_path: string;
    metadata: {
      namespace: string;
      name: string;
      version: string;
      description: string;
    };
  };
  hub: {
    server_url: string;
    api_root_url: string;
    verify_ssl: boolean;
    auth_configured: boolean;
  };
  collection: {
    namespace: string;
    name: string;
    version: string;
    fqcn: string;
    reference: string;
    artifact: string;
  };
  commands: Array<{
    label: string;
    command: string;
    working_directory?: string;
  }>;
  approval: {
    required: string;
    next_url: string;
    message: string;
  };
  notes: string[];
}

export function GalaxyNgProjectImports() {
  const { t } = useTranslation();
  const alertToaster = usePageAlertToaster();
  const status = useGet<GalaxyNgStatus>(awxAPI`/galaxy_ng/status/`);
  const projects = useGet<AwxItemsResponse<AwxProject>>(
    awxAPI`/projects/`,
    { page_size: 200, order_by: 'name' },
    { revalidateOnFocus: false }
  );
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [collectionPath, setCollectionPath] = useState('.');
  const [artifactDir, setArtifactDir] = useState('dist');
  const [plan, setPlan] = useState<GalaxyNgImportPlan>();
  const [isGenerating, setIsGenerating] = useState(false);

  const configured = Boolean(status.data?.configured && !status.data.controller_error);
  const projectOptions = projects.data?.results ?? [];

  const generatePlan = async () => {
    if (!selectedProjectId) {
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Select a Capstan Project before generating commands.'),
      });
      return;
    }
    setIsGenerating(true);
    try {
      const result = await postRequest<GalaxyNgImportPlan, GalaxyNgImportPlanPayload>(
        awxAPI`/galaxy_ng/collection-imports/build-plan/`,
        {
          project_id: Number(selectedProjectId),
          collection_path: collectionPath.trim() || '.',
          artifact_dir: artifactDir.trim() || 'dist',
        }
      );
      setPlan(result);
      alertToaster.addAlert({
        variant: 'success',
        title: t('Galaxy NG collection import commands generated.'),
        timeout: 3000,
      });
    } catch (err) {
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Unable to generate Galaxy NG collection import commands'),
        children: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <PageLayout>
      <PageHeader
        title={t('Project Imports')}
        description={t(
          'Build collection artifacts from Capstan Projects and publish them to Galaxy NG.'
        )}
        headerActions={
          <GalaxyNgHeaderActions
            status={status.data}
            uiRoute="collections/"
            page={t('Galaxy NG project imports')}
            prompt={t(
              'Help with Galaxy NG project imports in Capstan. Use the selected Capstan Project, collection path, generated commands, Galaxy NG settings, and approval workflow. Explain how to build, publish, approve, and install this collection.'
            )}
            context={{
              configured: status.data?.configured,
              server_url: status.data?.server_url,
              project_id: selectedProjectId,
              collection_path: collectionPath,
              artifact_dir: artifactDir,
              plan,
            }}
          />
        }
      />
      <PageSection>
        <Stack hasGutter>
          {status.isLoading ? (
            <div style={{ minHeight: 160, display: 'grid', placeItems: 'center' }}>
              <Spinner size="lg" />
            </div>
          ) : status.data && (!status.data.configured || status.data.controller_error) ? (
            <Alert isInline variant="warning" title={t('Galaxy NG is not ready')}>
              {status.data.controller_error || status.data.message}
            </Alert>
          ) : null}

          <StackItem>
            <Gallery hasGutter minWidths={{ default: 'min(420px, 100%)' }}>
              <GalleryItem>
                <Card>
                  <CardTitle>{t('Collection source')}</CardTitle>
                  <CardBody>
                    <Stack hasGutter>
                      <StackItem>
                        <Alert isInline variant="info" title={t('Capstan Project-backed content')}>
                          {t(
                            'The selected project must already be synced and the collection path must contain a valid galaxy.yml file.'
                          )}
                        </Alert>
                      </StackItem>
                      {projects.error ? (
                        <StackItem>
                          <Alert
                            isInline
                            variant="warning"
                            title={t('Could not load Capstan Projects.')}
                          />
                        </StackItem>
                      ) : null}
                      <StackItem>
                        <Form>
                          <div
                            style={{
                              display: 'grid',
                              gap: 16,
                              gridTemplateColumns:
                                'repeat(auto-fit, minmax(min(260px, 100%), 1fr))',
                            }}
                          >
                            <FormGroup
                              label={t('Capstan Project')}
                              fieldId="galaxy-ng-import-project"
                              isRequired
                            >
                              <FormSelect
                                id="galaxy-ng-import-project"
                                value={selectedProjectId}
                                onChange={(_, value) => setSelectedProjectId(value)}
                              >
                                <FormSelectOption
                                  value=""
                                  label={
                                    projects.isLoading
                                      ? t('Loading projects...')
                                      : projectOptions.length
                                        ? t('Select a project')
                                        : t('No readable projects found')
                                  }
                                />
                                {projectOptions.map((project) => (
                                  <FormSelectOption
                                    key={project.id}
                                    value={String(project.id)}
                                    label={project.name}
                                  />
                                ))}
                              </FormSelect>
                            </FormGroup>
                            <FormGroup
                              label={t('Collection path')}
                              fieldId="galaxy-ng-import-collection-path"
                              isRequired
                            >
                              <TextInput
                                id="galaxy-ng-import-collection-path"
                                value={collectionPath}
                                onChange={(_, value) => setCollectionPath(value)}
                              />
                            </FormGroup>
                            <FormGroup
                              label={t('Artifact output path')}
                              fieldId="galaxy-ng-import-artifact-dir"
                              isRequired
                            >
                              <TextInput
                                id="galaxy-ng-import-artifact-dir"
                                value={artifactDir}
                                onChange={(_, value) => setArtifactDir(value)}
                              />
                            </FormGroup>
                          </div>
                          <ActionGroup>
                            <Button
                              variant="primary"
                              isLoading={isGenerating}
                              isDisabled={!configured || isGenerating || !selectedProjectId}
                              onClick={() => void generatePlan()}
                            >
                              {t('Generate commands')}
                            </Button>
                          </ActionGroup>
                        </Form>
                      </StackItem>
                    </Stack>
                  </CardBody>
                </Card>
              </GalleryItem>
              <GalleryItem>
                <Card>
                  <CardTitle>{t('Collection artifact')}</CardTitle>
                  <CardBody>
                    {plan ? (
                      <Stack hasGutter>
                        <StackItem>
                          <DescriptionList isHorizontal isCompact>
                            <DescriptionListGroup>
                              <DescriptionListTerm>{t('Source project')}</DescriptionListTerm>
                              <DescriptionListDescription>
                                {plan.project.project_name}
                              </DescriptionListDescription>
                            </DescriptionListGroup>
                            <DescriptionListGroup>
                              <DescriptionListTerm>{t('Collection')}</DescriptionListTerm>
                              <DescriptionListDescription>
                                {plan.collection.reference}
                              </DescriptionListDescription>
                            </DescriptionListGroup>
                            <DescriptionListGroup>
                              <DescriptionListTerm>{t('Galaxy API')}</DescriptionListTerm>
                              <DescriptionListDescription>
                                {plan.hub.api_root_url}
                              </DescriptionListDescription>
                            </DescriptionListGroup>
                            <DescriptionListGroup>
                              <DescriptionListTerm>{t('Approval')}</DescriptionListTerm>
                              <DescriptionListDescription>
                                {plan.approval.message}
                              </DescriptionListDescription>
                            </DescriptionListGroup>
                          </DescriptionList>
                        </StackItem>
                        <StackItem>
                          <ClipboardCopy isReadOnly hoverTip={t('Copy')} clickTip={t('Copied')}>
                            {plan.collection.artifact}
                          </ClipboardCopy>
                        </StackItem>
                      </Stack>
                    ) : (
                      <TextContent>
                        <Text component={TextVariants.p}>
                          {t(
                            'Select a Capstan Project and collection path to generate the collection artifact and publish commands.'
                          )}
                        </Text>
                      </TextContent>
                    )}
                  </CardBody>
                </Card>
              </GalleryItem>
            </Gallery>
          </StackItem>

          {plan ? (
            <StackItem>
              <Card>
                <CardTitle>{t('Generated commands')}</CardTitle>
                <CardBody>
                  <Stack hasGutter>
                    {plan.commands.map((command) => (
                      <StackItem key={command.label}>
                        <Title headingLevel="h3" size="md">
                          {command.label}
                        </Title>
                        {command.working_directory ? (
                          <TextContent>
                            <Text component={TextVariants.small}>
                              {t('Working directory: {{path}}', {
                                path: command.working_directory,
                              })}
                            </Text>
                          </TextContent>
                        ) : null}
                        <ClipboardCopy isReadOnly hoverTip={t('Copy')} clickTip={t('Copied')}>
                          {command.command}
                        </ClipboardCopy>
                      </StackItem>
                    ))}
                    {plan.notes.length ? (
                      <StackItem>
                        <Alert isInline variant="info" title={t('Notes')}>
                          <TextContent>
                            {plan.notes.map((note) => (
                              <Text key={note} component={TextVariants.small}>
                                {note}
                              </Text>
                            ))}
                          </TextContent>
                        </Alert>
                      </StackItem>
                    ) : null}
                  </Stack>
                </CardBody>
              </Card>
            </StackItem>
          ) : null}
        </Stack>
      </PageSection>
    </PageLayout>
  );
}
