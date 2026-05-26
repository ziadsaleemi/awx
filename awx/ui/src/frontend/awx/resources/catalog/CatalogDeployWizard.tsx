import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { FormGroup, TextInput } from '@patternfly/react-core';
import {
  LoadingPage,
  PageFormSubmitHandler,
  PageHeader,
  PageLayout,
  useGetPageUrl,
  usePageNavigate,
  usePageAlertToaster,
} from '../../../../framework';
import { PageFormTextInput } from '../../../../framework/PageForm/Inputs/PageFormTextInput';
import { PageFormTextArea } from '../../../../framework/PageForm/Inputs/PageFormTextArea';
import { AwxPageForm } from '../../common/AwxPageForm';
import { awxAPI } from '../../common/api/awx-utils';
import { useGetItem } from '../../../common/crud/useGet';
import { usePostRequest } from '../../../common/crud/usePostRequest';
import { AwxError } from '../../common/AwxError';
import { AwxRoute } from '../../main/AwxRoutes';
import { CatalogItem } from '../../interfaces/CatalogItem';
import { CatalogDeployment } from '../../interfaces/CatalogDeployment';

interface DeployFormValues {
  name: string;
  extra_vars: string;
}

export function CatalogDeployWizard() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const id = params.id ?? '';
  const getPageUrl = useGetPageUrl();
  const pageNavigate = usePageNavigate();
  const alertToaster = usePageAlertToaster();

  const { data: item, error, isLoading, refresh } = useGetItem<CatalogItem>(
    awxAPI`/catalog_items`,
    id
  );

  const postRequest = usePostRequest<Record<string, unknown>, CatalogDeployment>();

  if (error) return <AwxError error={error} handleRefresh={refresh} />;
  if (isLoading || !item) return <LoadingPage />;

  const onSubmit: PageFormSubmitHandler<DeployFormValues> = async (values) => {
    let parsedVars: Record<string, unknown> = {};
    if (values.extra_vars) {
      try {
        parsedVars = JSON.parse(values.extra_vars) as Record<string, unknown>;
      } catch {
        throw new Error(t('Extra variables must be valid JSON.'));
      }
    }
    try {
      await postRequest(awxAPI`/catalog_items/${id}/deploy/`, {
        name: values.name,
        extra_vars: parsedVars,
      });
      alertToaster.addAlert({
        variant: 'success',
        title: t('Deployment started for "{{name}}"', { name: values.name }),
        timeout: 4000,
      });
      pageNavigate(AwxRoute.CatalogDeployments);
    } catch (err) {
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Failed to deploy catalog item'),
        children: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const defaultValues: DeployFormValues = { name: '', extra_vars: '{}' };

  return (
    <PageLayout>
      <PageHeader
        title={t('Deploy: {{name}}', { name: item.name })}
        description={item.description}
        breadcrumbs={[
          { label: t('Catalog'), to: getPageUrl(AwxRoute.CatalogItems) },
          { label: item.name },
        ]}
      />
      <AwxPageForm
        submitLabel={t('Deploy')}
        onSubmit={onSubmit}
        defaultValue={defaultValues}
        onCancel={() => pageNavigate(AwxRoute.CatalogItems)}
      >
        <PageFormTextInput<DeployFormValues>
          name="name"
          label={t('Deployment name')}
          placeholder={t('e.g. My Dev VM')}
          isRequired
          helperText={t('A human-friendly label for this deployment.')}
        />
        {item.extra_vars_schema && (
          <PageFormTextArea<DeployFormValues>
            name="extra_vars"
            label={t('Extra variables (JSON)')}
            helperText={t('Deployment parameters as a JSON object.')}
          />
        )}
      </AwxPageForm>
    </PageLayout>
  );
}

