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
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { PageHeader, PageLayout, usePageAlertToaster } from '../../../../framework';
import { postRequest } from '../../../common/crud/Data';
import { useGet } from '../../../common/crud/useGet';
import { AwxItemsResponse } from '../../common/AwxItemsResponse';
import { ModuleAIAssistantAction } from '../../common/ModuleAIAssistantAction';
import { awxAPI } from '../../common/api/awx-utils';
import { QuayStatus } from './QuayOverview';

type ContainerRuntime = 'podman' | 'docker';

interface QuayBuildPlanPayload {
  project_id: number;
  namespace: string;
  image_name: string;
  tag: string;
  runtime: ContainerRuntime;
  definition_file: string;
  context: string;
}

interface QuayBuildPlan {
  project: {
    project_id: number;
    project_name: string;
    scm_type: string;
    scm_url: string;
    scm_branch: string;
    scm_revision: string;
    local_path: string;
    project_path: string;
    definition_file: string;
    context: string;
  };
  registry: {
    server_url: string;
    registry: string;
    namespace: string;
    insecure: boolean;
    api_token_configured: boolean;
    push_username_configured: boolean;
    push_token_configured: boolean;
  };
  image: {
    repository: string;
    tag: string;
    repository_path: string;
    awx: string;
    push: string;
  };
  commands: Array<{
    label: string;
    command: string;
    working_directory?: string;
  }>;
  awx_execution_environment: {
    image: string;
    pull: string;
  };
  notes: string[];
}

interface QuayImageTag {
  id: number;
  name?: string;
  manifest_digest?: string;
  size?: number;
  last_modified?: string;
  start_ts?: number;
  end_ts?: number;
}

interface AwxProject {
  id: number;
  name: string;
  local_path?: string;
  scm_type?: string;
  scm_url?: string;
  scm_branch?: string;
  status?: string;
}

function formatBytes(value?: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MiB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GiB`;
}

function timestampFromTag(tag: QuayImageTag) {
  if (tag.last_modified) return tag.last_modified;
  const timestamp = tag.end_ts || tag.start_ts;
  return timestamp ? new Date(timestamp * 1000).toISOString() : '-';
}

export function QuayExecutionEnvironmentImages() {
  const { t } = useTranslation();
  const alertToaster = usePageAlertToaster();
  const status = useGet<QuayStatus>(awxAPI`/quay/status/`);
  const projects = useGet<AwxItemsResponse<AwxProject>>(
    awxAPI`/projects/`,
    { page_size: 200, order_by: 'name' },
    { revalidateOnFocus: false }
  );
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [namespace, setNamespace] = useState('');
  const [imageName, setImageName] = useState('custom-ee');
  const [tag, setTag] = useState('latest');
  const [runtime, setRuntime] = useState<ContainerRuntime>('podman');
  const [definitionFile, setDefinitionFile] = useState('execution-environment.yml');
  const [contextPath, setContextPath] = useState('.');
  const [plan, setPlan] = useState<QuayBuildPlan>();
  const [isGenerating, setIsGenerating] = useState(false);

  const configured = Boolean(status.data?.configured && status.data.registry);
  const effectiveNamespace = namespace.trim() || status.data?.namespace || '';
  const projectOptions = projects.data?.results ?? [];
  const shouldLoadTags = configured && Boolean(effectiveNamespace) && Boolean(imageName.trim());
  const tags = useGet<AwxItemsResponse<QuayImageTag>>(
    shouldLoadTags ? awxAPI`/quay/tags/` : undefined,
    shouldLoadTags
      ? { namespace: effectiveNamespace, repository: imageName.trim(), page_size: 20 }
      : undefined,
    { revalidateOnFocus: false }
  );

  const generatePlan = async () => {
    if (!selectedProjectId) {
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Select an AWX Project before generating commands.'),
      });
      return;
    }
    if (!effectiveNamespace) {
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Set a Project Quay namespace before generating commands.'),
      });
      return;
    }
    setIsGenerating(true);
    try {
      const result = await postRequest<QuayBuildPlan, QuayBuildPlanPayload>(
        awxAPI`/quay/execution-environment-images/build-plan/`,
        {
          project_id: Number(selectedProjectId),
          namespace: effectiveNamespace,
          image_name: imageName.trim(),
          tag: tag.trim(),
          runtime,
          definition_file: definitionFile.trim(),
          context: contextPath.trim(),
        }
      );
      setPlan(result);
      alertToaster.addAlert({
        variant: 'success',
        title: t('Project Quay image commands generated.'),
        timeout: 3000,
      });
    } catch (err) {
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Unable to generate Project Quay image commands'),
        children: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <PageLayout>
      <PageHeader
        title={t('Execution environment images')}
        description={t(
          'Build AWX execution environment images from AWX Projects and host them in Project Quay.'
        )}
        headerActions={
          <ModuleAIAssistantAction
            module="quay"
            page={t('Project Quay execution environment images')}
            prompt={t(
              'Help with Project Quay execution environment images in AWX. Use the selected project, namespace, repository, generated commands, and my AWX permissions. Explain how to build, push, tag, and use the image as an AWX execution environment.'
            )}
            context={{
              registry: status.data?.registry,
              namespace: effectiveNamespace,
              repository: imageName,
              project_id: selectedProjectId,
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
            <Alert isInline variant="warning" title={t('Project Quay is not ready')}>
              {status.data.controller_error || status.data.message}
            </Alert>
          ) : null}

          <StackItem>
            <Gallery hasGutter minWidths={{ default: 'min(420px, 100%)' }}>
              <GalleryItem>
                <Card>
                  <CardTitle>{t('Build and push workflow')}</CardTitle>
                  <CardBody>
                    <Stack hasGutter>
                      <StackItem>
                        <Alert isInline variant="info" title={t('Project Quay hosts EE images.')}>
                          {t(
                            'Generate commands that run from an AWX Project checkout, build an execution environment image, push it to Project Quay, and use the resulting image in AWX execution environments.'
                          )}
                        </Alert>
                      </StackItem>
                      {projects.error ? (
                        <StackItem>
                          <Alert
                            isInline
                            variant="warning"
                            title={t('Could not load AWX Projects.')}
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
                              label={t('AWX Project')}
                              fieldId="quay-ee-project"
                              isRequired
                            >
                              <FormSelect
                                id="quay-ee-project"
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
                              label={t('Quay namespace')}
                              fieldId="quay-ee-namespace"
                              isRequired
                            >
                              <TextInput
                                id="quay-ee-namespace"
                                value={namespace || status.data?.namespace || ''}
                                placeholder={t('Quay organization or user')}
                                onChange={(_, value) => setNamespace(value)}
                              />
                            </FormGroup>
                            <FormGroup
                              label={t('Repository')}
                              fieldId="quay-ee-image-name"
                              isRequired
                            >
                              <TextInput
                                id="quay-ee-image-name"
                                value={imageName}
                                onChange={(_, value) => setImageName(value)}
                              />
                            </FormGroup>
                            <FormGroup label={t('Tag')} fieldId="quay-ee-image-tag" isRequired>
                              <TextInput
                                id="quay-ee-image-tag"
                                value={tag}
                                onChange={(_, value) => setTag(value)}
                              />
                            </FormGroup>
                            <FormGroup label={t('Runtime')} fieldId="quay-ee-runtime">
                              <FormSelect
                                id="quay-ee-runtime"
                                value={runtime}
                                onChange={(_, value) => setRuntime(value as ContainerRuntime)}
                              >
                                <FormSelectOption value="podman" label={t('Podman')} />
                                <FormSelectOption value="docker" label={t('Docker')} />
                              </FormSelect>
                            </FormGroup>
                            <FormGroup
                              label={t('Definition file')}
                              fieldId="quay-ee-definition-file"
                              isRequired
                            >
                              <TextInput
                                id="quay-ee-definition-file"
                                value={definitionFile}
                                onChange={(_, value) => setDefinitionFile(value)}
                              />
                            </FormGroup>
                            <FormGroup
                              label={t('Build context')}
                              fieldId="quay-ee-context"
                              isRequired
                            >
                              <TextInput
                                id="quay-ee-context"
                                value={contextPath}
                                onChange={(_, value) => setContextPath(value)}
                              />
                            </FormGroup>
                          </div>
                          <ActionGroup>
                            <Button
                              variant="primary"
                              isLoading={isGenerating}
                              isDisabled={
                                !configured ||
                                isGenerating ||
                                !selectedProjectId ||
                                !effectiveNamespace
                              }
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
                  <CardTitle>{t('AWX execution environment value')}</CardTitle>
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
                              <DescriptionListTerm>{t('Project checkout')}</DescriptionListTerm>
                              <DescriptionListDescription>
                                {plan.project.project_path}
                              </DescriptionListDescription>
                            </DescriptionListGroup>
                            <DescriptionListGroup>
                              <DescriptionListTerm>{t('Quay registry')}</DescriptionListTerm>
                              <DescriptionListDescription>
                                {plan.registry.registry}
                              </DescriptionListDescription>
                            </DescriptionListGroup>
                            <DescriptionListGroup>
                              <DescriptionListTerm>{t('Repository path')}</DescriptionListTerm>
                              <DescriptionListDescription>
                                {plan.image.repository_path}
                              </DescriptionListDescription>
                            </DescriptionListGroup>
                            <DescriptionListGroup>
                              <DescriptionListTerm>{t('Pull policy')}</DescriptionListTerm>
                              <DescriptionListDescription>
                                {plan.awx_execution_environment.pull}
                              </DescriptionListDescription>
                            </DescriptionListGroup>
                          </DescriptionList>
                        </StackItem>
                        <StackItem>
                          <ClipboardCopy isReadOnly hoverTip={t('Copy')} clickTip={t('Copied')}>
                            {plan.awx_execution_environment.image}
                          </ClipboardCopy>
                        </StackItem>
                      </Stack>
                    ) : (
                      <TextContent>
                        <Text component={TextVariants.p}>
                          {t(
                            'Select an AWX Project and Quay namespace to generate the exact image reference AWX should pull.'
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

          <StackItem>
            <Card>
              <CardTitle>{t('Hosted image tags')}</CardTitle>
              <CardBody>
                {tags.isLoading ? (
                  <div style={{ minHeight: 120, display: 'grid', placeItems: 'center' }}>
                    <Spinner size="md" />
                  </div>
                ) : tags.error ? (
                  <Alert
                    isInline
                    variant="warning"
                    title={t('Could not load Project Quay image tags.')}
                  />
                ) : tags.data?.results?.length ? (
                  <Table
                    aria-label={t('Project Quay hosted execution environment images')}
                    variant="compact"
                  >
                    <Thead>
                      <Tr>
                        <Th>{t('Tag')}</Th>
                        <Th>{t('Digest')}</Th>
                        <Th>{t('Size')}</Th>
                        <Th>{t('Updated')}</Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {tags.data.results.map((imageTag) => (
                        <Tr key={imageTag.id}>
                          <Td>{imageTag.name || '-'}</Td>
                          <Td>{imageTag.manifest_digest || '-'}</Td>
                          <Td>{formatBytes(imageTag.size)}</Td>
                          <Td>{timestampFromTag(imageTag)}</Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                ) : (
                  <TextContent>
                    <Text component={TextVariants.p}>
                      {t('No execution environment image tags found.')}
                    </Text>
                    <Text component={TextVariants.small}>
                      {t(
                        'Push an image to Project Quay and refresh this page to verify AWX can see it.'
                      )}
                    </Text>
                  </TextContent>
                )}
              </CardBody>
            </Card>
          </StackItem>
        </Stack>
      </PageSection>
    </PageLayout>
  );
}
