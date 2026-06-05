import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import {
  PageFormSubmitHandler,
  PageFormTextInput,
  PageHeader,
  PageLayout,
  useGetPageUrl,
  usePageNavigate,
} from '../../../../framework';
import { PageFormMultiSelect } from '../../../../framework/PageForm/Inputs/PageFormMultiSelect';
import { useGet } from '../../../common/crud/useGet';
import { usePatchRequest } from '../../../common/crud/usePatchRequest';
import { usePostRequest } from '../../../common/crud/usePostRequest';
import { useInvalidateCacheOnUnmount } from '../../../common/useInvalidateCache/useInvalidateCache';
import { AwxItemsResponse } from '../../common/AwxItemsResponse';
import { AwxPageForm } from '../../common/AwxPageForm';
import { awxAPI } from '../../common/api/awx-utils';
import { AwxRbacRole } from '../../interfaces/AwxRbacRole';
import { AwxUserType } from '../../interfaces/AwxUserType';
import { AwxRoute } from '../../main/AwxRoutes';

type UserTypeFormData = Pick<AwxUserType, 'name' | 'description' | 'role_definitions'>;

export function CreateUserType() {
  return <UserTypeForm mode="create" />;
}

export function EditUserType() {
  return <UserTypeForm mode="edit" />;
}

export function CloneUserType() {
  return <UserTypeForm mode="clone" />;
}

function UserTypeForm(props: { mode: 'create' | 'edit' | 'clone' }) {
  const { mode } = props;
  const { t } = useTranslation();
  const navigate = useNavigate();
  const pageNavigate = usePageNavigate();
  const getPageUrl = useGetPageUrl();
  const params = useParams<{ id?: string }>();
  const id = Number(params.id);
  const { data: userType } = useGet<AwxUserType>(
    mode === 'create' ? undefined : awxAPI`/user_types/${id.toString()}/`
  );
  const { data: roleDefinitions } = useGet<AwxItemsResponse<AwxRbacRole>>(
    awxAPI`/role_definitions/`,
    { page_size: 200 }
  );
  const postRequest = usePostRequest<UserTypeFormData, AwxUserType>();
  const patchRequest = usePatchRequest<UserTypeFormData, AwxUserType>();

  useInvalidateCacheOnUnmount();

  const roleOptions = useMemo(
    () =>
      (roleDefinitions?.results ?? []).map((roleDefinition) => ({
        label: roleDefinition.name,
        description: roleDefinition.description,
        value: roleDefinition.id,
      })),
    [roleDefinitions?.results]
  );

  const onSubmit: PageFormSubmitHandler<UserTypeFormData> = async (data) => {
    if (mode === 'edit') {
      await patchRequest(awxAPI`/user_types/${id.toString()}/`, data);
    } else if (mode === 'clone') {
      await postRequest(awxAPI`/user_types/${id.toString()}/copy/`, data);
    } else {
      await postRequest(awxAPI`/user_types/`, data);
    }
    pageNavigate(AwxRoute.UserTypes);
  };

  if (mode !== 'create' && !userType) {
    return (
      <PageLayout>
        <PageHeader
          breadcrumbs={[
            { label: t('User types'), to: getPageUrl(AwxRoute.UserTypes) },
            { label: mode === 'clone' ? t('Clone user type') : t('Edit user type') },
          ]}
        />
      </PageLayout>
    );
  }

  const defaultValue: Partial<UserTypeFormData> =
    mode === 'create'
      ? { role_definitions: [] }
      : {
          name:
            mode === 'clone'
              ? t('Copy of {{name}}', { name: userType?.name ?? '' })
              : userType?.name,
          description: userType?.description ?? '',
          role_definitions: userType?.role_definitions ?? [],
        };
  const title =
    mode === 'create'
      ? t('Create user type')
      : mode === 'clone'
        ? t('Clone {{name}}', { name: userType?.name })
        : t('Edit {{name}}', { name: userType?.name });

  return (
    <PageLayout>
      <PageHeader
        title={title}
        breadcrumbs={[
          { label: t('User types'), to: getPageUrl(AwxRoute.UserTypes) },
          { label: title },
        ]}
      />
      <AwxPageForm<UserTypeFormData>
        submitText={mode === 'edit' ? t('Save user type') : t('Create user type')}
        onSubmit={onSubmit}
        cancelText={t('Cancel')}
        onCancel={() => navigate(-1)}
        defaultValue={defaultValue}
      >
        <PageFormTextInput<UserTypeFormData> name="name" label={t('Name')} isRequired />
        <PageFormTextInput<UserTypeFormData> name="description" label={t('Description')} />
        <PageFormMultiSelect<UserTypeFormData>
          name="role_definitions"
          label={t('Assigned roles')}
          placeholder={t('Select roles')}
          helperText={t('Select role definitions included in this user type.')}
          options={roleOptions}
        />
      </AwxPageForm>
    </PageLayout>
  );
}
