import { ButtonVariant, Label, LabelGroup } from '@patternfly/react-core';
import { CopyIcon, PencilAltIcon, PlusCircleIcon, TrashIcon } from '@patternfly/react-icons';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IPageAction,
  ITableColumn,
  IToolbarFilter,
  PageActionSelection,
  PageActionType,
  PageHeader,
  PageLayout,
  PageTable,
  TextCell,
  ToolbarFilterType,
  useGetPageUrl,
  compareStrings,
} from '../../../../framework';
import { requestDelete } from '../../../common/crud/Data';
import { idKeyFn } from '../../../common/utils/nameKeyFn';
import { awxAPI } from '../../common/api/awx-utils';
import { useAwxActiveUser } from '../../common/useAwxActiveUser';
import { useAwxBulkConfirmation } from '../../common/useAwxBulkConfirmation';
import { useAwxView } from '../../common/useAwxView';
import { AwxUserType } from '../../interfaces/AwxUserType';
import { AwxRoute } from '../../main/AwxRoutes';

export function UserTypes() {
  const { t } = useTranslation();
  const tableColumns = useUserTypeColumns();
  const toolbarFilters = useMemo<IToolbarFilter[]>(
    () => [
      {
        key: 'name',
        label: t('Name'),
        type: ToolbarFilterType.MultiText,
        query: 'name__icontains',
        comparison: 'contains',
      },
    ],
    [t]
  );
  const view = useAwxView<AwxUserType>({
    url: awxAPI`/user_types/`,
    toolbarFilters,
    tableColumns,
  });
  const toolbarActions = useUserTypeToolbarActions(
    view.selectedItems,
    view.unselectItemsAndRefresh
  );
  const rowActions = useUserTypeRowActions(view.unselectItemsAndRefresh);

  return (
    <PageLayout>
      <PageHeader
        title={t('User types')}
        titleHelpTitle={t('User types')}
        titleHelp={t(
          'A user type is a named user profile preset with role definitions that can be selected from the user profile form.'
        )}
        description={t(
          'Create custom user types separately from roles, then assign them to users.'
        )}
      />
      <PageTable<AwxUserType>
        {...view}
        tableColumns={tableColumns}
        toolbarActions={toolbarActions}
        rowActions={rowActions}
        toolbarFilters={toolbarFilters}
        errorStateTitle={t('Error loading user types')}
        emptyStateTitle={t('No user types found')}
        defaultSubtitle={t('User type')}
      />
    </PageLayout>
  );
}

function useUserTypeColumns(options?: { disableLinks?: boolean }) {
  const { t } = useTranslation();
  const getPageUrl = useGetPageUrl();
  return useMemo<ITableColumn<AwxUserType>[]>(
    () => [
      {
        header: t('Name'),
        cell: (userType) => (
          <TextCell
            text={userType.name}
            to={
              options?.disableLinks
                ? undefined
                : getPageUrl(AwxRoute.EditUserType, { params: { id: userType.id } })
            }
          />
        ),
        card: 'name',
        list: 'name',
        sort: 'name',
      },
      {
        header: t('Assigned roles'),
        cell: (userType) => (
          <LabelGroup>
            {(userType.summary_fields.role_definitions ?? []).map((roleDefinition) => (
              <Label key={roleDefinition.id}>{roleDefinition.name}</Label>
            ))}
          </LabelGroup>
        ),
        card: 'subtitle',
        list: 'subtitle',
      },
      {
        header: t('Description'),
        type: 'description',
        value: (userType) => userType.description,
      },
    ],
    [getPageUrl, options?.disableLinks, t]
  );
}

function useUserTypeToolbarActions(
  selectedItems: AwxUserType[],
  onComplete: (userTypes: AwxUserType[]) => void
) {
  const { t } = useTranslation();
  const getPageUrl = useGetPageUrl();
  const { activeAwxUser } = useAwxActiveUser();
  const deleteUserTypes = useDeleteUserTypes(onComplete);
  return useMemo<IPageAction<AwxUserType>[]>(
    () => [
      {
        type: PageActionType.Link,
        selection: PageActionSelection.None,
        isPinned: true,
        variant: ButtonVariant.primary,
        icon: PlusCircleIcon,
        label: t('Create user type'),
        href: getPageUrl(AwxRoute.CreateUserType),
        isDisabled: activeAwxUser?.is_superuser
          ? undefined
          : t('You do not have permission to create user types.'),
      },
      { type: PageActionType.Seperator },
      {
        type: PageActionType.Button,
        selection: PageActionSelection.Multiple,
        icon: TrashIcon,
        label: t('Delete user types'),
        onClick: () => deleteUserTypes(selectedItems),
        isDanger: true,
      },
    ],
    [activeAwxUser?.is_superuser, deleteUserTypes, getPageUrl, selectedItems, t]
  );
}

function useUserTypeRowActions(onComplete: (userTypes: AwxUserType[]) => void) {
  const { t } = useTranslation();
  const getPageUrl = useGetPageUrl();
  const { activeAwxUser } = useAwxActiveUser();
  const deleteUserTypes = useDeleteUserTypes(onComplete);
  return useMemo<IPageAction<AwxUserType>[]>(
    () => [
      {
        type: PageActionType.Link,
        selection: PageActionSelection.Single,
        isPinned: true,
        variant: ButtonVariant.primary,
        icon: PencilAltIcon,
        label: t('Edit user type'),
        href: (userType) => getPageUrl(AwxRoute.EditUserType, { params: { id: userType.id } }),
        isDisabled: activeAwxUser?.is_superuser
          ? undefined
          : t('You do not have permission to edit user types.'),
      },
      {
        type: PageActionType.Link,
        selection: PageActionSelection.Single,
        icon: CopyIcon,
        label: t('Clone user type'),
        href: (userType) => getPageUrl(AwxRoute.CloneUserType, { params: { id: userType.id } }),
        isDisabled: activeAwxUser?.is_superuser
          ? undefined
          : t('You do not have permission to clone user types.'),
      },
      { type: PageActionType.Seperator },
      {
        type: PageActionType.Button,
        selection: PageActionSelection.Single,
        icon: TrashIcon,
        label: t('Delete user type'),
        onClick: (userType) => deleteUserTypes([userType]),
        isDanger: true,
        isDisabled: activeAwxUser?.is_superuser
          ? undefined
          : t('You do not have permission to delete user types.'),
      },
    ],
    [activeAwxUser?.is_superuser, deleteUserTypes, getPageUrl, t]
  );
}

function useDeleteUserTypes(onComplete: (userTypes: AwxUserType[]) => void) {
  const { t } = useTranslation();
  const bulkAction = useAwxBulkConfirmation<AwxUserType>();
  const confirmationColumns = useUserTypeColumns({ disableLinks: true });
  const actionColumns = useMemo<ITableColumn<AwxUserType>[]>(
    () => [
      {
        header: t('Name'),
        cell: (userType) => <TextCell text={userType.name} />,
        card: 'name',
        list: 'name',
      },
    ],
    [t]
  );
  return (userTypes: AwxUserType[]) => {
    bulkAction({
      title: t('Permanently delete user types', { count: userTypes.length }),
      confirmText: t('Yes, I confirm that I want to delete these {{count}} user types.', {
        count: userTypes.length,
      }),
      actionButtonText: t('Delete user types', { count: userTypes.length }),
      items: userTypes.sort((left, right) => compareStrings(left.name, right.name)),
      keyFn: idKeyFn,
      isDanger: true,
      confirmationColumns,
      actionColumns,
      onComplete,
      actionFn: (userType, signal) =>
        requestDelete(awxAPI`/user_types/${userType.id.toString()}/`, signal),
    });
  };
}
