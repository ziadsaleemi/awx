import { ClipboardCopy, Label, LabelGroup } from '@patternfly/react-core';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { LoadingPage, PageDetail, PageDetails, useGetPageUrl } from '../../../../framework';
import { useGet } from '../../../common/crud/useGet';
import { AwxError } from '../../common/AwxError';
import { AwxItemsResponse } from '../../common/AwxItemsResponse';
import { awxAPI } from '../../common/api/awx-utils';
import { InstanceGroup } from '../../interfaces/InstanceGroup';
import { QuayImageBuildTemplate } from '../../interfaces/QuayImageBuildTemplate';
import { AwxRoute } from '../../main/AwxRoutes';

function formatDate(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

export function QuayImageBuildTemplateDetails() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const getPageUrl = useGetPageUrl();
  const {
    data: template,
    error,
    isLoading,
    refresh,
  } = useGet<QuayImageBuildTemplate>(
    params.id ? awxAPI`/quay/execution-environment-images/templates/${params.id}/` : ''
  );
  const { data: instanceGroups } = useGet<AwxItemsResponse<InstanceGroup>>(
    params.id
      ? awxAPI`/quay/execution-environment-images/templates/${params.id}/instance_groups/`
      : ''
  );

  if (error) return <AwxError error={error} handleRefresh={refresh} />;
  if (isLoading || !template) return <LoadingPage />;

  const project =
    template.summary_fields?.project ??
    (template.project && typeof template.project === 'object' ? template.project : undefined);

  return (
    <PageDetails>
      <PageDetail label={t('Name')}>{template.name}</PageDetail>
      <PageDetail label={t('Description')}>{template.description}</PageDetail>
      <PageDetail label={t('Capstan Project')} isEmpty={!project?.id}>
        {project?.id ? (
          <Link to={getPageUrl(AwxRoute.ProjectDetails, { params: { id: project.id } })}>
            {project.name}
          </Link>
        ) : (
          '-'
        )}
      </PageDetail>
      <PageDetail label={t('Image')} isEmpty={!template.image}>
        <ClipboardCopy isReadOnly hoverTip={t('Copy')} clickTip={t('Copied')}>
          {template.image}
        </ClipboardCopy>
      </PageDetail>
      <PageDetail label={t('Namespace')}>{template.namespace}</PageDetail>
      <PageDetail label={t('Repository')}>{template.repository}</PageDetail>
      <PageDetail label={t('Tag')}>{template.tag}</PageDetail>
      <PageDetail label={t('Container runtime')}>{template.runtime}</PageDetail>
      <PageDetail label={t('Definition file')}>{template.definition_file}</PageDetail>
      <PageDetail label={t('Build context')}>
        {template.context ?? template.context_path ?? '.'}
      </PageDetail>
      <PageDetail
        label={t('Instance groups')}
        helpText={t('The instance groups this EE build template will run on.')}
        isEmpty={!instanceGroups?.results?.length}
      >
        <LabelGroup>
          {instanceGroups?.results?.map((instanceGroup) => (
            <Label color="blue" key={instanceGroup.id}>
              <Link
                to={getPageUrl(AwxRoute.InstanceGroupDetails, {
                  params: { id: instanceGroup.id },
                })}
              >
                {instanceGroup.name}
              </Link>
            </Label>
          ))}
        </LabelGroup>
      </PageDetail>
      <PageDetail label={t('Created')}>{formatDate(template.created)}</PageDetail>
      <PageDetail label={t('Last modified')}>{formatDate(template.modified)}</PageDetail>
      <PageDetail label={t('Latest build')} isEmpty={!template.latest_build}>
        {template.latest_build
          ? `${template.latest_build.status} (${formatDate(template.latest_build.created)})`
          : '-'}
      </PageDetail>
    </PageDetails>
  );
}
