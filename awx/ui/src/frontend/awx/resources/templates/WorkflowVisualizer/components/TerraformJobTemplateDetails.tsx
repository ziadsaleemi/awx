import { useTranslation } from 'react-i18next';
import { PageDetail, useGetPageUrl, TextCell } from '../../../../../../framework';
import { awxAPI } from '../../../../common/api/awx-utils';
import { useGet } from '../../../../../common/crud/useGet';
import { TerraformJobTemplate } from '../../../../interfaces/TerraformJobTemplate';
import { AwxRoute } from '../../../../main/AwxRoutes';
import { jsonToYaml } from '../../../../../../framework/utils/codeEditorUtils';
import { GraphNodeData } from '../types';
import { NodeCodeEditorDetail } from './NodeCodeEditorDetail';

export function TerraformJobTemplateDetails({
  node,
  template,
}: {
  node: GraphNodeData;
  template: TerraformJobTemplate;
}) {
  const { t } = useTranslation();
  const getPageUrl = useGetPageUrl();

  const { resource: nodeValues } = node;
  const extraVars =
    nodeValues?.extra_data ? jsonToYaml(JSON.stringify(nodeValues.extra_data)) : template.extra_vars;

  const { data: project } = useGet<{ id: number; name: string }>(
    template.project ? awxAPI`/projects/${template.project.toString()}/` : null
  );

  return (
    <>
      <PageDetail label={t('Project')}>
        {project ? (
          <TextCell
            text={project.name}
            to={getPageUrl(AwxRoute.ProjectPage, { params: { id: project.id } })}
          />
        ) : (
          template.summary_fields?.project?.name ?? ''
        )}
      </PageDetail>

      <PageDetail label={t('Terraform directory')} isEmpty={!template.terraform_dir}>
        {template.terraform_dir || '.'}
      </PageDetail>

      <PageDetail label={t('Operation')}>{template.terraform_operation}</PageDetail>

      <PageDetail label={t('Verbosity')}>{String(template.verbosity)}</PageDetail>

      {template.summary_fields?.target_inventory && (
        <PageDetail label={t('Target inventory')}>
          <TextCell
            text={template.summary_fields.target_inventory.name}
            to={getPageUrl(AwxRoute.InventoryPage, {
              params: { id: template.summary_fields.target_inventory.id },
            })}
          />
        </PageDetail>
      )}

      {template.target_group && (
        <PageDetail label={t('Target group')}>{template.target_group}</PageDetail>
      )}

      <PageDetail label={t('Template')}>
        <TextCell
          text={template.name}
          to={getPageUrl(AwxRoute.TerraformTemplatePage, { params: { id: template.id } })}
        />
      </PageDetail>

      <NodeCodeEditorDetail label={t('Variables')} value={extraVars} />
    </>
  );
}
