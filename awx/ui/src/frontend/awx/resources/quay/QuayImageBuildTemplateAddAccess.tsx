import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import {
  LoadingPage,
  PageHeader,
  PageLayout,
  PageWizard,
  PageWizardStep,
  useGetPageUrl,
} from '../../../../framework';
import { RoleAssignmentsReviewStep } from '../../../common/access/RolesWizard/steps/RoleAssignmentsReviewStep';
import { postRequest } from '../../../common/crud/Data';
import { useGet } from '../../../common/crud/useGet';
import { AwxSelectRolesStep } from '../../access/common/AwxRolesWizardSteps/AwxSelectRolesStep';
import { AwxSelectTeamsStep } from '../../access/common/AwxRolesWizardSteps/AwxSelectTeamsStep';
import { AwxSelectUsersStep } from '../../access/common/AwxRolesWizardSteps/AwxSelectUsersStep';
import { awxErrorAdapter } from '../../common/adapters/awxErrorAdapter';
import { awxAPI } from '../../common/api/awx-utils';
import { useAwxBulkActionDialog } from '../../common/useAwxBulkActionDialog';
import { Role } from '../../interfaces/Role';
import { Team } from '../../interfaces/Team';
import { AwxUser } from '../../interfaces/User';
import { AwxRoute } from '../../main/AwxRoutes';

interface QuayImageBuildTemplate {
  id: number;
  name: string;
}

interface TeamWizardFormValues {
  teams: Team[];
  awxRoles: Role[];
}

interface UserWizardFormValues {
  users: AwxUser[];
  awxRoles: Role[];
}

interface TeamRolePair {
  team: Team;
  role: Role;
}

interface UserRolePair {
  user: AwxUser;
  role: Role;
}

const quayTemplateContentType = 'quayimagebuildtemplate';

function useQuayTemplateAccessWizard(tab: 'team-access' | 'user-access') {
  const { t } = useTranslation();
  const getPageUrl = useGetPageUrl();
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const { data: template, isLoading } = useGet<QuayImageBuildTemplate>(
    `${awxAPI`/quay/execution-environment-images/templates/`}${params.id ?? ''}/`
  );

  const returnToAccessTab = (templateId?: number) => {
    const id = templateId ?? template?.id;
    navigate(
      `${getPageUrl(AwxRoute.QuayExecutionEnvironmentImages)}?template=${id ?? ''}&tab=${tab}`
    );
  };

  return { t, getPageUrl, template, isLoading, returnToAccessTab };
}

export function QuayImageBuildTemplateAddTeams() {
  const { t, getPageUrl, template, isLoading, returnToAccessTab } =
    useQuayTemplateAccessWizard('team-access');
  const teamRoleProgressDialog = useAwxBulkActionDialog<TeamRolePair>();

  if (isLoading || !template) return <LoadingPage />;

  const steps: PageWizardStep[] = [
    {
      id: 'teams',
      label: t('Select team(s)'),
      inputs: (
        <AwxSelectTeamsStep
          descriptionForTeamsSelection={t(
            'Select the team(s) that you want to give access to {{templateName}}.',
            { templateName: template.name }
          )}
        />
      ),
      validate: (formData) => {
        const { teams } = formData as TeamWizardFormValues;
        if (!teams?.length) {
          throw new Error(t('Select at least one team.'));
        }
      },
    },
    {
      id: 'roles',
      label: t('Select roles to apply'),
      inputs: (
        <AwxSelectRolesStep
          contentType={quayTemplateContentType}
          fieldNameForPreviousStep="teams"
          descriptionForRoleSelection={t('Choose roles to apply to {{templateName}}.', {
            templateName: template.name,
          })}
        />
      ),
      validate: (formData) => {
        const { awxRoles } = formData as TeamWizardFormValues;
        if (!awxRoles?.length) {
          throw new Error(t('Select at least one role.'));
        }
      },
    },
    {
      id: 'review',
      label: t('Review'),
      inputs: <RoleAssignmentsReviewStep />,
    },
  ];

  const onSubmit = async (data: TeamWizardFormValues) => {
    const items: TeamRolePair[] = [];
    for (const team of data.teams) {
      for (const role of data.awxRoles) {
        items.push({ team, role });
      }
    }
    return new Promise<void>((resolve) => {
      teamRoleProgressDialog({
        title: t('Add roles'),
        keyFn: ({ team, role }) => `${team.id}_${role.id}`,
        items,
        actionColumns: [
          { header: t('Team'), cell: ({ team }) => team.name },
          { header: t('Role'), cell: ({ role }) => role.name },
        ],
        actionFn: ({ team, role }) =>
          postRequest(awxAPI`/role_team_assignments/`, {
            team: team.id,
            role_definition: role.id,
            content_type: quayTemplateContentType,
            object_id: template.id,
          }),
        onComplete: () => resolve(),
        onClose: () => returnToAccessTab(template.id),
      });
    });
  };

  return (
    <PageLayout>
      <PageHeader
        title={t('Add roles')}
        breadcrumbs={[
          { label: t('Project Quay'), to: getPageUrl(AwxRoute.QuayOverview) },
          {
            label: t('Execution Environments'),
            to: getPageUrl(AwxRoute.QuayExecutionEnvironmentImages),
          },
          {
            label: template.name,
            to: `${getPageUrl(AwxRoute.QuayExecutionEnvironmentImages)}?template=${template.id}&tab=team-access`,
          },
          { label: t('Add roles') },
        ]}
      />
      <PageWizard<TeamWizardFormValues>
        errorAdapter={awxErrorAdapter}
        steps={steps}
        onSubmit={onSubmit}
        disableGrid
        onCancel={() => returnToAccessTab(template.id)}
      />
    </PageLayout>
  );
}

export function QuayImageBuildTemplateAddUsers() {
  const { t, getPageUrl, template, isLoading, returnToAccessTab } =
    useQuayTemplateAccessWizard('user-access');
  const userRoleProgressDialog = useAwxBulkActionDialog<UserRolePair>();

  if (isLoading || !template) return <LoadingPage />;

  const steps: PageWizardStep[] = [
    {
      id: 'users',
      label: t('Select user(s)'),
      inputs: (
        <AwxSelectUsersStep
          descriptionForUsersSelection={t(
            'Select the user(s) that you want to give access to {{templateName}}.',
            { templateName: template.name }
          )}
        />
      ),
      validate: (formData) => {
        const { users } = formData as UserWizardFormValues;
        if (!users?.length) {
          throw new Error(t('Select at least one user.'));
        }
      },
    },
    {
      id: 'roles',
      label: t('Select roles to apply'),
      inputs: (
        <AwxSelectRolesStep
          contentType={quayTemplateContentType}
          fieldNameForPreviousStep="users"
          descriptionForRoleSelection={t('Choose roles to apply to {{templateName}}.', {
            templateName: template.name,
          })}
        />
      ),
      validate: (formData) => {
        const { awxRoles } = formData as UserWizardFormValues;
        if (!awxRoles?.length) {
          throw new Error(t('Select at least one role.'));
        }
      },
    },
    {
      id: 'review',
      label: t('Review'),
      inputs: <RoleAssignmentsReviewStep />,
    },
  ];

  const onSubmit = async (data: UserWizardFormValues) => {
    const items: UserRolePair[] = [];
    for (const user of data.users) {
      for (const role of data.awxRoles) {
        items.push({ user, role });
      }
    }
    return new Promise<void>((resolve) => {
      userRoleProgressDialog({
        title: t('Add roles'),
        keyFn: ({ user, role }) => `${user.id}_${role.id}`,
        items,
        actionColumns: [
          { header: t('User'), cell: ({ user }) => user.username },
          { header: t('Role'), cell: ({ role }) => role.name },
        ],
        actionFn: ({ user, role }) =>
          postRequest(awxAPI`/role_user_assignments/`, {
            user: user.id,
            role_definition: role.id,
            content_type: quayTemplateContentType,
            object_id: template.id,
          }),
        onComplete: () => resolve(),
        onClose: () => returnToAccessTab(template.id),
      });
    });
  };

  return (
    <PageLayout>
      <PageHeader
        title={t('Add roles')}
        breadcrumbs={[
          { label: t('Project Quay'), to: getPageUrl(AwxRoute.QuayOverview) },
          {
            label: t('Execution Environments'),
            to: getPageUrl(AwxRoute.QuayExecutionEnvironmentImages),
          },
          {
            label: template.name,
            to: `${getPageUrl(AwxRoute.QuayExecutionEnvironmentImages)}?template=${template.id}&tab=user-access`,
          },
          { label: t('Add roles') },
        ]}
      />
      <PageWizard<UserWizardFormValues>
        errorAdapter={awxErrorAdapter}
        steps={steps}
        onSubmit={onSubmit}
        disableGrid
        onCancel={() => returnToAccessTab(template.id)}
      />
    </PageLayout>
  );
}
