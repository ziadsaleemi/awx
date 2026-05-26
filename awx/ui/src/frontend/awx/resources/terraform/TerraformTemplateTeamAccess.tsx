import { useParams } from 'react-router-dom';
import { AwxRoute } from '../../main/AwxRoutes';
import { TeamAccess } from '../../../common/access/components/TeamAccess';

export function TerraformTemplateTeamAccess() {
  const params = useParams<{ id: string }>();
  return (
    <TeamAccess
      service="awx"
      id={params.id || ''}
      type={'terraformjobtemplate'}
      addRolesRoute={AwxRoute.TerraformTemplateAddTeams}
    />
  );
}
