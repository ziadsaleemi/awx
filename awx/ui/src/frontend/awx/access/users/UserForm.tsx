/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import useSWR from 'swr';
import {
  PageFormSubmitHandler,
  PageHeader,
  PageLayout,
  useGetPageUrl,
  usePageNavigate,
} from '../../../../framework';
import { PageFormSingleSelect } from '../../../../framework/PageForm/Inputs/PageFormSingleSelect';
import { PageFormTextInput } from '../../../../framework/PageForm/Inputs/PageFormTextInput';
import { PageFormSection } from '../../../../framework/PageForm/Utils/PageFormSection';
import { requestGet, requestPatch, swrOptions } from '../../../common/crud/Data';
import { useGet } from '../../../common/crud/useGet';
import { usePostRequest } from '../../../common/crud/usePostRequest';
import { AwxItemsResponse } from '../../common/AwxItemsResponse';
import { AwxPageForm } from '../../common/AwxPageForm';
import { awxAPI } from '../../common/api/awx-utils';
import { AwxUserType } from '../../interfaces/AwxUserType';
import { AwxUser } from '../../interfaces/User';
import { AwxRoute } from '../../main/AwxRoutes';
import { PageFormSelectOrganization } from '../organizations/components/PageFormOrganizationSelect';

const UserType = {
  SystemAdministrator: 'built-in:administrator',
  SystemAuditor: 'built-in:auditor',
  NormalUser: 'built-in:normal',
};
const CUSTOM_USER_TYPE_PREFIX = 'custom:';

function customUserTypeValue(id: number) {
  return `${CUSTOM_USER_TYPE_PREFIX}${id.toString()}`;
}

function applyUserTypeToUser(user: AwxUser, userType: string) {
  const customUserTypeId = userType.startsWith(CUSTOM_USER_TYPE_PREFIX)
    ? Number(userType.slice(CUSTOM_USER_TYPE_PREFIX.length))
    : undefined;
  user.is_superuser = userType === UserType.SystemAdministrator;
  user.is_system_auditor = userType === UserType.SystemAuditor;
  user.custom_user_type = customUserTypeId ?? null;
}

function userToUserTypeValue(user: AwxUser) {
  if (user.is_superuser) {
    return UserType.SystemAdministrator;
  }
  if (user.is_system_auditor) {
    return UserType.SystemAuditor;
  }
  if (user.custom_user_type) {
    return customUserTypeValue(user.custom_user_type);
  }
  return UserType.NormalUser;
}

export function CreateUser() {
  const { t } = useTranslation();
  const pageNavigate = usePageNavigate();
  const navigate = useNavigate();
  const postRequest = usePostRequest<AwxUser, AwxUser>();
  const onSubmit: PageFormSubmitHandler<IUserInput> = async (
    userInput,
    setError,
    setFieldError
  ) => {
    const { userType, confirmPassword, ...user } = userInput;
    applyUserTypeToUser(user, userType);
    if (confirmPassword !== user.password) {
      setFieldError('confirmPassword', { message: t('Password does not match.') });
      return false;
    }
    const newUser = await postRequest(
      awxAPI`/organizations/${user.organization!.toString()}/users/`,
      user
    );
    pageNavigate(AwxRoute.UserDetails, { params: { id: newUser.id } });
  };

  const onCancel = () => navigate(-1);
  const getPageUrl = useGetPageUrl();

  return (
    <PageLayout>
      <PageHeader
        title={t('Create user')}
        breadcrumbs={[
          { label: t('Users'), to: getPageUrl(AwxRoute.Users) },
          { label: t('Create user') },
        ]}
      />
      <AwxPageForm
        submitText={t('Create user')}
        onSubmit={onSubmit}
        cancelText={t('Cancel')}
        onCancel={onCancel}
        defaultValue={{ userType: UserType.NormalUser }}
      >
        <UserInputs mode="create" />
      </AwxPageForm>
    </PageLayout>
  );
}

export function EditUser() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const pageNavigate = usePageNavigate();
  const params = useParams<{ id?: string }>();
  const id = Number(params.id);
  const { data: user } = useSWR<AwxUser>(awxAPI`/users/${id.toString()}/`, requestGet, swrOptions);

  const onSubmit: PageFormSubmitHandler<IUserInput> = async (
    userInput: IUserInput,
    setError,
    setFieldError
  ) => {
    const { userType, confirmPassword, ...user } = userInput;
    applyUserTypeToUser(user, userType);
    if (user.password) {
      if (confirmPassword !== user.password) {
        setFieldError('confirmPassword', { message: t('Password does not match.') });
        return false;
      }
    }
    const newUser = await requestPatch<AwxUser>(awxAPI`/users/${id.toString()}/`, user);
    pageNavigate(AwxRoute.UserDetails, { params: { id: newUser.id } });
  };

  const getPageUrl = useGetPageUrl();

  const onCancel = () => navigate(-1);

  if (!user) {
    return (
      <PageLayout>
        <PageHeader
          breadcrumbs={[
            { label: t('Users'), to: getPageUrl(AwxRoute.Users) },
            { label: t('Edit User') },
          ]}
        />
      </PageLayout>
    );
  }

  const { password, ...defaultUserValue } = user;
  const defaultValue: Partial<IUserInput> = {
    ...defaultUserValue,
    userType: userToUserTypeValue(user),
  };
  return (
    <PageLayout>
      <PageHeader
        title={user?.username ? t('Edit {{userName}}', { userName: user?.username }) : t('User')}
        breadcrumbs={[
          { label: t('Users'), to: getPageUrl(AwxRoute.Users) },
          {
            label: user?.username
              ? t('Edit {{userName}}', { userName: user?.username })
              : t('User'),
          },
        ]}
      />
      <AwxPageForm<IUserInput>
        submitText={t('Save user')}
        onSubmit={onSubmit}
        cancelText={t('Cancel')}
        onCancel={onCancel}
        defaultValue={defaultValue}
      >
        <UserInputs mode="edit" />
      </AwxPageForm>
    </PageLayout>
  );
}

type IUserInput = AwxUser & { userType: string; confirmPassword: string };

function UserInputs(props: { mode: 'create' | 'edit' }) {
  const { mode } = props;
  const { t } = useTranslation();
  const { data: userTypes } = useGet<AwxItemsResponse<AwxUserType>>(awxAPI`/user_types/`, {
    page_size: 200,
  });
  const userTypeOptions = useMemo(
    () => [
      {
        label: t('System administrator'),
        description: t('can edit, change, and update any inventory or automation definition'),
        value: UserType.SystemAdministrator,
      },
      {
        label: t('System auditor'),
        description: t(
          'can see all aspects of the systems automation, but has no permission to run or change automation'
        ),
        value: UserType.SystemAuditor,
      },
      {
        label: t('Normal user'),
        description: t(
          'has read and write access limited to the resources (such as inventory, projects, and job templates) for which that user has been granted the appropriate roles and privileges'
        ),
        value: UserType.NormalUser,
      },
      ...(userTypes?.results ?? []).map((userType) => ({
        label: userType.name,
        description:
          userType.summary_fields.role_definitions
            ?.map((roleDefinition) => roleDefinition.name)
            .join(', ') || userType.description,
        value: customUserTypeValue(userType.id),
      })),
    ],
    [t, userTypes?.results]
  );
  return (
    <>
      <PageFormTextInput<IUserInput>
        name="username"
        label={t('Username')}
        placeholder={t('Enter username')}
        isRequired
        maxLength={150}
        validate={(username: string) => {
          for (const c of username) {
            if (
              !'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz1234567890@.+-_'.includes(c)
            ) {
              return t('Username may contain only letters, numbers, and @.+-_ characters.');
            }
          }
        }}
      />
      <PageFormSingleSelect<IUserInput>
        name="userType"
        label={t('User type')}
        placeholder={t('Select user type')}
        options={userTypeOptions}
        isRequired
      />
      {mode === 'create' && (
        <PageFormSelectOrganization<IUserInput> name="organization" isRequired />
      )}
      <PageFormSection>
        <PageFormTextInput<IUserInput>
          name="password"
          label={t('Password')}
          placeholder={t('Enter password')}
          type="password"
          isRequired={mode === 'create'}
        />
        <PageFormTextInput<IUserInput>
          name="confirmPassword"
          label={t('Confirm password')}
          placeholder={t('Enter password')}
          type="password"
          isRequired={mode === 'create'}
        />
      </PageFormSection>
      <PageFormTextInput<IUserInput>
        name="first_name"
        label={t('First name')}
        placeholder={t('Enter first name')}
        maxLength={150}
      />
      <PageFormTextInput<IUserInput>
        name="last_name"
        label={t('Last name')}
        placeholder={t('Enter last name')}
        maxLength={150}
      />
      <PageFormTextInput<IUserInput>
        name="email"
        label={t('Email')}
        placeholder={t('Enter email')}
      />
    </>
  );
}
