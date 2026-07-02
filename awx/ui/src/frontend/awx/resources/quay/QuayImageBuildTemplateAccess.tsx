import { useParams } from 'react-router-dom';
import { TeamAccess } from '../../../common/access/components/TeamAccess';
import { UserAccess } from '../../../common/access/components/UserAccess';
import { AwxRoute } from '../../main/AwxRoutes';

export function QuayImageBuildTemplateTeamAccess() {
  const params = useParams<{ id: string }>();
  return (
    <TeamAccess
      service="awx"
      id={params.id || ''}
      type="quayimagebuildtemplate"
      addRolesRoute={AwxRoute.QuayImageBuildTemplateAddTeams}
    />
  );
}

export function QuayImageBuildTemplateUserAccess() {
  const params = useParams<{ id: string }>();
  return (
    <UserAccess
      service="awx"
      id={params.id || ''}
      type="quayimagebuildtemplate"
      addRolesRoute={AwxRoute.QuayImageBuildTemplateAddUsers}
    />
  );
}
