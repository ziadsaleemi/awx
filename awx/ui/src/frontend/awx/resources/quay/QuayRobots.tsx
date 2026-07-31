import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardTitle,
  Form,
  FormGroup,
  FormSelect,
  FormSelectOption,
  Modal,
  ModalVariant,
  PageSection,
  Spinner,
  Stack,
  TextInput,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import { SyncAltIcon, TrashIcon } from '@patternfly/react-icons';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { PageHeader, PageLayout, usePageAlertToaster } from '../../../../framework';
import { postRequest } from '../../../common/crud/Data';
import { useGet } from '../../../common/crud/useGet';
import { AwxItemsResponse } from '../../common/AwxItemsResponse';
import { ModuleAIAssistantAction } from '../../common/ModuleAIAssistantAction';
import { awxAPI } from '../../common/api/awx-utils';
import { QuayStatus } from './QuayStatus';

type QuayRobotNamespaceKind = 'user' | 'organization';

interface QuayRobot {
  id: number;
  _awx_key?: string;
  name?: string;
  shortname?: string;
  description?: string;
  created?: string;
  last_accessed?: string;
  repositories?: unknown[];
}

interface QuayRobotActionResponse {
  source: string;
  action: string;
  namespace_kind: QuayRobotNamespaceKind;
  namespace: string;
  robot: string;
}

function robotShortName(robot: QuayRobot) {
  if (robot.shortname) return robot.shortname;
  if (robot.name?.includes('+')) return robot.name.split('+').pop() || robot.name;
  return robot.name || '';
}

function robotName(robot: QuayRobot) {
  return robot.name || robot.shortname || '-';
}

export function QuayRobots() {
  const { t } = useTranslation();
  const alertToaster = usePageAlertToaster();
  const status = useGet<QuayStatus>(awxAPI`/quay/status/`);
  const [namespaceKind, setNamespaceKind] = useState<QuayRobotNamespaceKind>('organization');
  const [namespace, setNamespace] = useState('');
  const effectiveNamespace = namespace.trim() || status.data?.namespace || '';
  const canManageRobots = Boolean(status.data?.can_manage && status.data?.management_configured);
  const robots = useGet<AwxItemsResponse<QuayRobot>>(
    status.data?.configured && canManageRobots ? awxAPI`/quay/robots/` : undefined,
    status.data?.configured && canManageRobots
      ? { namespace_kind: namespaceKind, namespace: effectiveNamespace, page_size: 100 }
      : undefined,
    { revalidateOnFocus: false }
  );
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [robotForm, setRobotForm] = useState({ robot: '', description: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const refresh = useCallback(() => {
    robots.refresh();
    status.refresh();
  }, [robots, status]);

  const createRobot = useCallback(async () => {
    setIsSubmitting(true);
    try {
      const result = await postRequest<
        QuayRobotActionResponse,
        {
          namespace_kind: QuayRobotNamespaceKind;
          namespace: string;
          robot: string;
          description: string;
        }
      >(awxAPI`/quay/robots/create/`, {
        namespace_kind: namespaceKind,
        namespace: effectiveNamespace,
        robot: robotForm.robot.trim(),
        description: robotForm.description,
      });
      alertToaster.addAlert({
        variant: 'success',
        title: t('Project Quay robot {{robot}} created.', { robot: result.robot }),
        timeout: 4000,
      });
      setIsCreateOpen(false);
      setRobotForm({ robot: '', description: '' });
      refresh();
    } catch (err) {
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Failed to create Project Quay robot'),
        children: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [alertToaster, effectiveNamespace, namespaceKind, refresh, robotForm, t]);

  const deleteRobot = useCallback(
    async (robot: QuayRobot) => {
      const shortname = robotShortName(robot);
      if (!shortname) return;
      try {
        await postRequest<
          QuayRobotActionResponse,
          { namespace_kind: QuayRobotNamespaceKind; namespace: string; robot: string }
        >(awxAPI`/quay/robots/delete/`, {
          namespace_kind: namespaceKind,
          namespace: effectiveNamespace,
          robot: shortname,
        });
        alertToaster.addAlert({
          variant: 'success',
          title: t('Project Quay robot {{robot}} deleted.', { robot: shortname }),
          timeout: 4000,
        });
        refresh();
      } catch (err) {
        alertToaster.addAlert({
          variant: 'danger',
          title: t('Failed to delete Project Quay robot'),
          children: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [alertToaster, effectiveNamespace, namespaceKind, refresh, t]
  );

  const regenerateToken = useCallback(
    async (robot: QuayRobot) => {
      const shortname = robotShortName(robot);
      if (!shortname) return;
      try {
        await postRequest<
          QuayRobotActionResponse,
          { namespace_kind: QuayRobotNamespaceKind; namespace: string; robot: string }
        >(awxAPI`/quay/robots/regenerate-token/`, {
          namespace_kind: namespaceKind,
          namespace: effectiveNamespace,
          robot: shortname,
        });
        alertToaster.addAlert({
          variant: 'success',
          title: t('Project Quay robot {{robot}} token regenerated.', { robot: shortname }),
          timeout: 4000,
        });
        refresh();
      } catch (err) {
        alertToaster.addAlert({
          variant: 'danger',
          title: t('Failed to regenerate Project Quay robot token'),
          children: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [alertToaster, effectiveNamespace, namespaceKind, refresh, t]
  );

  return (
    <PageLayout>
      <PageHeader
        title={t('Robot Accounts')}
        description={t(
          'Manage Project Quay robot accounts used by Capstan to push and pull images.'
        )}
        headerActions={
          <ModuleAIAssistantAction
            module="quay"
            page={t('Project Quay robot accounts')}
            prompt={t(
              'Help me manage Project Quay robot accounts for Capstan execution environment image workflows. Explain which robots should be used for push credentials and repository permissions.'
            )}
            context={{
              namespace_kind: namespaceKind,
              namespace: effectiveNamespace,
              can_manage: status.data?.can_manage,
              management_configured: status.data?.management_configured,
            }}
          />
        }
      />
      <PageSection>
        <Stack hasGutter>
          {status.isLoading ? (
            <div style={{ minHeight: 180, display: 'grid', placeItems: 'center' }}>
              <Spinner size="lg" />
            </div>
          ) : status.data && (!status.data.configured || status.data.controller_error) ? (
            <Alert isInline variant="warning" title={t('Project Quay is not ready')}>
              {status.data.controller_error || status.data.message}
            </Alert>
          ) : status.data && !canManageRobots ? (
            <Alert
              isInline
              variant="warning"
              title={t('Project Quay robot management needs an API token.')}
            >
              {t(
                'Configure QUAY_API_TOKEN with user:admin or org:admin scope before managing robot accounts from Capstan.'
              )}
            </Alert>
          ) : null}
          <Card>
            <CardTitle>{t('Robot scope')}</CardTitle>
            <CardBody>
              <Toolbar>
                <ToolbarContent>
                  <ToolbarItem>
                    <FormSelect
                      aria-label={t('Robot namespace kind')}
                      value={namespaceKind}
                      onChange={(_event, value) =>
                        setNamespaceKind(value as QuayRobotNamespaceKind)
                      }
                    >
                      <FormSelectOption value="organization" label={t('Organization')} />
                      <FormSelectOption value="user" label={t('Current user')} />
                    </FormSelect>
                  </ToolbarItem>
                  <ToolbarItem>
                    <TextInput
                      aria-label={t('Namespace')}
                      value={effectiveNamespace}
                      placeholder={t('Quay namespace')}
                      onChange={(_event, value) => setNamespace(value)}
                    />
                  </ToolbarItem>
                  <ToolbarItem>
                    <Button
                      variant="secondary"
                      icon={<SyncAltIcon />}
                      onClick={() => void refresh()}
                      isDisabled={!canManageRobots}
                    >
                      {t('Refresh')}
                    </Button>
                  </ToolbarItem>
                  <ToolbarItem>
                    <Button
                      variant="primary"
                      onClick={() => setIsCreateOpen(true)}
                      isDisabled={!canManageRobots || !effectiveNamespace}
                    >
                      {t('Create robot')}
                    </Button>
                  </ToolbarItem>
                </ToolbarContent>
              </Toolbar>
            </CardBody>
          </Card>
          <Card>
            <CardTitle>{t('Robot accounts')}</CardTitle>
            <CardBody>
              {robots.isLoading ? (
                <div style={{ minHeight: 160, display: 'grid', placeItems: 'center' }}>
                  <Spinner size="md" />
                </div>
              ) : robots.error ? (
                <Alert
                  isInline
                  variant="warning"
                  title={t('Could not load Project Quay robots.')}
                />
              ) : robots.data?.results?.length ? (
                <Table aria-label={t('Project Quay robot accounts')} variant="compact">
                  <Thead>
                    <Tr>
                      <Th>{t('Name')}</Th>
                      <Th>{t('Description')}</Th>
                      <Th>{t('Repositories')}</Th>
                      <Th>{t('Created')}</Th>
                      <Th>{t('Actions')}</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {robots.data.results.map((robot) => (
                      <Tr key={robot._awx_key || robot.id}>
                        <Td>{robotName(robot)}</Td>
                        <Td>{robot.description || '-'}</Td>
                        <Td>
                          {Array.isArray(robot.repositories) ? robot.repositories.length : '-'}
                        </Td>
                        <Td>{robot.created || '-'}</Td>
                        <Td>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <Button
                              variant="link"
                              icon={<SyncAltIcon />}
                              onClick={() => void regenerateToken(robot)}
                            >
                              {t('Regenerate token')}
                            </Button>
                            <Button
                              variant="link"
                              icon={<TrashIcon />}
                              isDanger
                              onClick={() => void deleteRobot(robot)}
                            >
                              {t('Delete')}
                            </Button>
                          </div>
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              ) : (
                <Alert isInline variant="info" title={t('No Project Quay robot accounts found.')} />
              )}
            </CardBody>
          </Card>
        </Stack>
      </PageSection>
      <Modal
        variant={ModalVariant.medium}
        title={t('Create Project Quay robot')}
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        actions={[
          <Button
            key="create"
            variant="primary"
            isLoading={isSubmitting}
            isDisabled={isSubmitting || !robotForm.robot.trim()}
            onClick={() => void createRobot()}
          >
            {t('Create robot')}
          </Button>,
          <Button
            key="cancel"
            variant="link"
            isDisabled={isSubmitting}
            onClick={() => setIsCreateOpen(false)}
          >
            {t('Cancel')}
          </Button>,
        ]}
      >
        <Form>
          <FormGroup label={t('Short name')} fieldId="quay-robot-shortname" isRequired>
            <TextInput
              id="quay-robot-shortname"
              value={robotForm.robot}
              onChange={(_event, value) =>
                setRobotForm((current) => ({ ...current, robot: value }))
              }
            />
          </FormGroup>
          <FormGroup label={t('Description')} fieldId="quay-robot-description">
            <TextInput
              id="quay-robot-description"
              value={robotForm.description}
              onChange={(_event, value) =>
                setRobotForm((current) => ({ ...current, description: value }))
              }
            />
          </FormGroup>
        </Form>
      </Modal>
    </PageLayout>
  );
}
