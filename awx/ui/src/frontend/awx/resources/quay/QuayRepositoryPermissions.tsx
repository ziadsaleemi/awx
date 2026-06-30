import { useCallback, useMemo, useState } from 'react';
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
  PageSection,
  Spinner,
  Stack,
  StackItem,
  TextInput,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import { PlusCircleIcon, SyncAltIcon, TrashIcon } from '@patternfly/react-icons';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { PageHeader, PageLayout, usePageAlertToaster } from '../../../../framework';
import { postRequest } from '../../../common/crud/Data';
import { useGet } from '../../../common/crud/useGet';
import { AwxItemsResponse } from '../../common/AwxItemsResponse';
import { ModuleAIAssistantAction } from '../../common/ModuleAIAssistantAction';
import { awxAPI } from '../../common/api/awx-utils';
import { QuayStatus } from './QuayOverview';

type QuayPermissionRole = 'read' | 'write' | 'admin';
type QuayPrincipalType = 'user' | 'team';
const QUAY_PRINCIPAL_USER: QuayPrincipalType = 'user';
const QUAY_PRINCIPAL_TEAM: QuayPrincipalType = 'team';

interface QuayRepository {
  id: number;
  _awx_key?: string;
  name?: string;
  namespace?: string;
}

interface QuayPermission {
  id: number;
  _awx_key?: string;
  username?: string;
  teamname?: string;
  name?: string;
  role?: QuayPermissionRole;
}

interface QuayRepositoryPermissionsResponse {
  source: string;
  resource: string;
  namespace: string;
  repository: string;
  users: QuayPermission[];
  teams: QuayPermission[];
  count: number;
  controller_error: string;
}

interface QuayPermissionActionResponse {
  source: string;
  action: string;
  namespace: string;
  repository: string;
  username?: string;
  teamname?: string;
  role?: QuayPermissionRole;
}

function permissionPrincipal(permission: QuayPermission, type: QuayPrincipalType) {
  if (type === 'user') return permission.username || permission.name || '-';
  return permission.teamname || permission.name || '-';
}

export function QuayRepositoryPermissions() {
  const { t } = useTranslation();
  const alertToaster = usePageAlertToaster();
  const status = useGet<QuayStatus>(awxAPI`/quay/status/`);
  const canManagePermissions = Boolean(
    status.data?.can_manage && status.data?.management_configured
  );
  const repositories = useGet<AwxItemsResponse<QuayRepository>>(
    status.data?.configured && canManagePermissions ? awxAPI`/quay/repositories/` : undefined,
    status.data?.configured && canManagePermissions
      ? { namespace: status.data?.namespace, page_size: 100 }
      : undefined,
    { revalidateOnFocus: false }
  );
  const repositoryOptions = useMemo(() => repositories.data?.results ?? [], [repositories.data]);
  const [selectedRepository, setSelectedRepository] = useState('');
  const selectedRepositoryRecord = useMemo(
    () => repositoryOptions.find((repository) => repository.name === selectedRepository),
    [repositoryOptions, selectedRepository]
  );
  const selectedNamespace = selectedRepositoryRecord?.namespace || status.data?.namespace || '';
  const permissions = useGet<QuayRepositoryPermissionsResponse>(
    selectedRepository && canManagePermissions
      ? awxAPI`/quay/repositories/permissions/`
      : undefined,
    selectedRepository && canManagePermissions
      ? { namespace: selectedNamespace, repository: selectedRepository }
      : undefined,
    { revalidateOnFocus: false }
  );
  const [principalType, setPrincipalType] = useState<QuayPrincipalType>(QUAY_PRINCIPAL_USER);
  const [principal, setPrincipal] = useState('');
  const [role, setRole] = useState<QuayPermissionRole>('read');
  const refresh = useCallback(() => {
    repositories.refresh();
    permissions.refresh();
    status.refresh();
  }, [permissions, repositories, status]);

  const setPermission = useCallback(async () => {
    if (!selectedRepository || !principal.trim()) return;
    const endpoint =
      principalType === 'user'
        ? awxAPI`/quay/repositories/permissions/user/set/`
        : awxAPI`/quay/repositories/permissions/team/set/`;
    const payload = {
      namespace: selectedNamespace,
      repository: selectedRepository,
      role,
      [principalType === 'user' ? 'username' : 'teamname']: principal.trim(),
    };
    try {
      const result = await postRequest<QuayPermissionActionResponse, typeof payload>(
        endpoint,
        payload
      );
      alertToaster.addAlert({
        variant: 'success',
        title: t('Project Quay {{role}} permission saved for {{principal}}.', {
          role: result.role || role,
          principal: principal.trim(),
        }),
        timeout: 4000,
      });
      setPrincipal('');
      permissions.refresh();
    } catch (err) {
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Failed to save Project Quay repository permission'),
        children: err instanceof Error ? err.message : String(err),
      });
    }
  }, [
    alertToaster,
    permissions,
    principal,
    principalType,
    role,
    selectedNamespace,
    selectedRepository,
    t,
  ]);

  const deletePermission = useCallback(
    async (permission: QuayPermission, type: QuayPrincipalType) => {
      const name = permissionPrincipal(permission, type);
      if (!selectedRepository || name === '-') return;
      const endpoint =
        type === 'user'
          ? awxAPI`/quay/repositories/permissions/user/delete/`
          : awxAPI`/quay/repositories/permissions/team/delete/`;
      const payload = {
        namespace: selectedNamespace,
        repository: selectedRepository,
        [type === 'user' ? 'username' : 'teamname']: name,
      };
      try {
        await postRequest<QuayPermissionActionResponse, typeof payload>(endpoint, payload);
        alertToaster.addAlert({
          variant: 'success',
          title: t('Project Quay repository permission removed for {{principal}}.', {
            principal: name,
          }),
          timeout: 4000,
        });
        permissions.refresh();
      } catch (err) {
        alertToaster.addAlert({
          variant: 'danger',
          title: t('Failed to remove Project Quay repository permission'),
          children: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [alertToaster, permissions, selectedNamespace, selectedRepository, t]
  );

  const permissionTable = (items: QuayPermission[], type: QuayPrincipalType) => (
    <Table
      aria-label={type === 'user' ? t('Quay user permissions') : t('Quay team permissions')}
      variant="compact"
    >
      <Thead>
        <Tr>
          <Th>{type === 'user' ? t('User') : t('Team')}</Th>
          <Th>{t('Role')}</Th>
          <Th>{t('Actions')}</Th>
        </Tr>
      </Thead>
      <Tbody>
        {items.map((permission) => (
          <Tr key={permission._awx_key || permission.id}>
            <Td>{permissionPrincipal(permission, type)}</Td>
            <Td>{permission.role || '-'}</Td>
            <Td>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button
                  variant="link"
                  icon={<TrashIcon />}
                  isDanger
                  onClick={() => void deletePermission(permission, type)}
                >
                  {t('Remove')}
                </Button>
              </div>
            </Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );

  return (
    <PageLayout>
      <PageHeader
        title={t('Repository Permissions')}
        description={t(
          'Grant Quay repository access for AWX execution environment image workflows.'
        )}
        headerActions={
          <ModuleAIAssistantAction
            module="quay"
            page={t('Project Quay repository permissions')}
            prompt={t(
              'Help me review and manage Project Quay repository permissions for AWX execution environment images. Explain least-privilege user, team, and robot access for this repository.'
            )}
            context={{
              namespace: selectedNamespace,
              repository: selectedRepository,
              users: permissions.data?.users,
              teams: permissions.data?.teams,
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
          ) : status.data && !canManagePermissions ? (
            <Alert
              isInline
              variant="warning"
              title={t('Project Quay permission management needs an API token.')}
            >
              {t(
                'Configure QUAY_API_TOKEN with repo:admin scope before managing repository permissions from AWX.'
              )}
            </Alert>
          ) : null}
          <Card>
            <CardTitle>{t('Repository')}</CardTitle>
            <CardBody>
              <Toolbar>
                <ToolbarContent>
                  <ToolbarItem>
                    <FormSelect
                      aria-label={t('Repository')}
                      value={selectedRepository}
                      onChange={(_event, value) => setSelectedRepository(value)}
                      isDisabled={!canManagePermissions || repositories.isLoading}
                    >
                      <FormSelectOption
                        value=""
                        label={
                          repositories.isLoading
                            ? t('Loading repositories...')
                            : repositoryOptions.length
                              ? t('Select repository')
                              : t('No repositories found')
                        }
                      />
                      {repositoryOptions.map((repository) => (
                        <FormSelectOption
                          key={repository._awx_key || repository.id}
                          value={repository.name || ''}
                          label={`${repository.namespace || selectedNamespace}/${repository.name || '-'}`}
                        />
                      ))}
                    </FormSelect>
                  </ToolbarItem>
                  <ToolbarItem>
                    <Button
                      variant="secondary"
                      icon={<SyncAltIcon />}
                      onClick={() => void refresh()}
                      isDisabled={!canManagePermissions}
                    >
                      {t('Refresh')}
                    </Button>
                  </ToolbarItem>
                </ToolbarContent>
              </Toolbar>
            </CardBody>
          </Card>
          <Card>
            <CardTitle>{t('Grant access')}</CardTitle>
            <CardBody>
              <Form>
                <div
                  style={{
                    display: 'grid',
                    gap: 16,
                    gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))',
                    alignItems: 'end',
                  }}
                >
                  <FormGroup label={t('Principal type')} fieldId="quay-permission-type">
                    <FormSelect
                      id="quay-permission-type"
                      value={principalType}
                      onChange={(_event, value) => setPrincipalType(value as QuayPrincipalType)}
                    >
                      <FormSelectOption value="user" label={t('User or robot')} />
                      <FormSelectOption value="team" label={t('Team')} />
                    </FormSelect>
                  </FormGroup>
                  <FormGroup label={t('Name')} fieldId="quay-permission-principal" isRequired>
                    <TextInput
                      id="quay-permission-principal"
                      value={principal}
                      placeholder={
                        principalType === 'user' ? t('username or org+robot') : t('team name')
                      }
                      onChange={(_event, value) => setPrincipal(value)}
                    />
                  </FormGroup>
                  <FormGroup label={t('Role')} fieldId="quay-permission-role">
                    <FormSelect
                      id="quay-permission-role"
                      value={role}
                      onChange={(_event, value) => setRole(value as QuayPermissionRole)}
                    >
                      <FormSelectOption value="read" label={t('Read')} />
                      <FormSelectOption value="write" label={t('Write')} />
                      <FormSelectOption value="admin" label={t('Admin')} />
                    </FormSelect>
                  </FormGroup>
                  <Button
                    variant="primary"
                    icon={<PlusCircleIcon />}
                    isDisabled={!canManagePermissions || !selectedRepository || !principal.trim()}
                    onClick={() => void setPermission()}
                  >
                    {t('Save permission')}
                  </Button>
                </div>
              </Form>
            </CardBody>
          </Card>
          <Card>
            <CardTitle>{t('Current permissions')}</CardTitle>
            <CardBody>
              {!selectedRepository ? (
                <Alert
                  isInline
                  variant="info"
                  title={t('Select a repository to view permissions.')}
                />
              ) : permissions.isLoading ? (
                <div style={{ minHeight: 160, display: 'grid', placeItems: 'center' }}>
                  <Spinner size="md" />
                </div>
              ) : permissions.error ? (
                <Alert
                  isInline
                  variant="warning"
                  title={t('Could not load Project Quay permissions.')}
                />
              ) : (
                <Stack hasGutter>
                  <StackItem>
                    <div style={{ fontWeight: 600, marginBottom: 8 }}>{t('Users and robots')}</div>
                    {permissions.data?.users?.length ? (
                      permissionTable(permissions.data.users, QUAY_PRINCIPAL_USER)
                    ) : (
                      <Alert isInline variant="info" title={t('No user permissions found.')} />
                    )}
                  </StackItem>
                  <StackItem>
                    <div style={{ fontWeight: 600, marginBottom: 8 }}>{t('Teams')}</div>
                    {permissions.data?.teams?.length ? (
                      permissionTable(permissions.data.teams, QUAY_PRINCIPAL_TEAM)
                    ) : (
                      <Alert isInline variant="info" title={t('No team permissions found.')} />
                    )}
                  </StackItem>
                </Stack>
              )}
            </CardBody>
          </Card>
        </Stack>
      </PageSection>
    </PageLayout>
  );
}
