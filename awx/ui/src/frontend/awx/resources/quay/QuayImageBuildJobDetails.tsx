import {
  ClipboardCopy,
  Progress,
  ProgressMeasureLocation,
  ProgressSize,
} from '@patternfly/react-core';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { DateTimeCell, PageDetail, PageDetails, useGetPageUrl } from '../../../../framework';
import { PageDetailCodeEditor } from '../../../../framework/PageDetails/PageDetailCodeEditor';
import { StatusCell } from '../../../common/Status';
import { Job } from '../../interfaces/Job';
import { QuayImageBuildJob } from '../../interfaces/QuayImageBuildJob';
import { AwxRoute } from '../../main/AwxRoutes';

export function QuayImageBuildJobDetails(props: { job: Job & QuayImageBuildJob }) {
  const { job } = props;
  const { t } = useTranslation();
  const getPageUrl = useGetPageUrl();
  const template = job.summary_fields?.quay_image_build_template;
  const project = job.summary_fields?.project;
  const elapsed = (job as { elapsed?: number | string }).elapsed;

  return (
    <PageDetails>
      <PageDetail label={t('Status')}>
        <StatusCell status={job.status} />
      </PageDetail>
      <PageDetail label={t('EE build template')} isEmpty={!template?.id}>
        {template?.id ? (
          <Link
            to={getPageUrl(AwxRoute.QuayImageBuildTemplateDetails, {
              params: { id: template.id },
            })}
          >
            {template.name}
          </Link>
        ) : (
          '-'
        )}
      </PageDetail>
      <PageDetail label={t('AWX Project')} isEmpty={!project?.id}>
        {project?.id ? (
          <Link to={getPageUrl(AwxRoute.ProjectDetails, { params: { id: project.id } })}>
            {project.name}
          </Link>
        ) : (
          '-'
        )}
      </PageDetail>
      <PageDetail label={t('Image')} isEmpty={!job.image}>
        <ClipboardCopy isReadOnly hoverTip={t('Copy')} clickTip={t('Copied')}>
          {job.image}
        </ClipboardCopy>
      </PageDetail>
      <PageDetail label={t('Registry')}>{job.registry || '-'}</PageDetail>
      <PageDetail label={t('Namespace')}>{job.namespace}</PageDetail>
      <PageDetail label={t('Repository')}>{job.repository}</PageDetail>
      <PageDetail label={t('Tag')}>{job.tag}</PageDetail>
      <PageDetail label={t('Container runtime')}>{job.runtime}</PageDetail>
      <PageDetail label={t('Definition file')}>{job.definition_file}</PageDetail>
      <PageDetail label={t('Build context')}>{job.context_path || '.'}</PageDetail>
      <PageDetail label={t('SCM revision')} isEmpty={!job.scm_revision}>
        {job.scm_revision}
      </PageDetail>
      <PageDetail label={t('Progress')}>
        <Progress
          value={job.progress ?? 0}
          measureLocation={ProgressMeasureLocation.inside}
          size={ProgressSize.sm}
        />
      </PageDetail>
      <PageDetail label={t('Started')} isEmpty={!job.started}>
        <DateTimeCell value={job.started ?? undefined} />
      </PageDetail>
      <PageDetail label={t('Finished')} isEmpty={!job.finished}>
        <DateTimeCell value={job.finished ?? undefined} />
      </PageDetail>
      <PageDetail label={t('Elapsed')}>
        {typeof elapsed === 'number' ? `${elapsed.toFixed(1)}s` : elapsed || '-'}
      </PageDetail>
      <PageDetailCodeEditor
        label={t('Command plan')}
        showCopyToClipboard
        value={JSON.stringify(job.command_summary ?? [], null, 2)}
      />
    </PageDetails>
  );
}
