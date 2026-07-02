import { useTranslation } from 'react-i18next';
import { PageHeader, PageLayout } from '../../../../framework';
import { usePersistentFilters } from '../../../common/PersistentFilters';
import { useAwxConfig } from '../../common/useAwxConfig';
import { useGetDocsUrl } from '../../common/util/useGetDocsUrl';
import { awxAPI } from '../../common/api/awx-utils';
import { TemplatesList } from './TemplatesList';
import { ActivityStreamIcon } from '../../common/ActivityStreamIcon';

export function Templates() {
  const { t } = useTranslation();

  usePersistentFilters('templates');
  const config = useAwxConfig();

  return (
    <PageLayout>
      <PageHeader
        title={t('Templates')}
        titleHelpTitle={t('Templates')}
        titleHelp={t(
          'Templates are reusable definitions for automation work. AWX supports Ansible job templates, workflow templates, Terraform templates, and Project Quay execution environment build templates.'
        )}
        titleDocLink={useGetDocsUrl(config, 'templates')}
        description={t(
          'Reusable definitions for running Ansible, Terraform, workflow, and EE image build jobs.'
        )}
        headerActions={
          <ActivityStreamIcon
            type={'job_template+workflow_job_template+workflow_job_template_node'}
          />
        }
      />
      <TemplatesList url={awxAPI`/unified_job_templates/`} />
    </PageLayout>
  );
}
