import { useCallback } from 'react';
import { FieldPath, FieldPathValue, FieldValues, Path } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { PageFormAsyncSelect } from '../../../../../framework/PageForm/Inputs/PageFormAsyncSelect';
import { requestGet } from '../../../../common/crud/Data';
import { AwxItemsResponse } from '../../../common/AwxItemsResponse';
import { awxAPI } from '../../../common/api/awx-utils';
import { TerraformJobTemplate } from '../../../interfaces/TerraformJobTemplate';
import { useSelectTerraformJobTemplate } from '../hooks/useSelectTerraformJobTemplate';

export function PageFormTerraformJobTemplateSelect<
  TFieldValues extends FieldValues = FieldValues,
  TFieldName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>(props: { name: TFieldName; isRequired?: boolean }) {
  const { t } = useTranslation();
  const openSelectDialog = useSelectTerraformJobTemplate();

  const query = useCallback(async () => {
    const response = await requestGet<AwxItemsResponse<TerraformJobTemplate>>(
      awxAPI`/terraform_job_templates/`.concat('?page_size=200')
    );
    return Promise.resolve({
      total: response.count,
      values: response.results as FieldPathValue<TFieldValues, Path<TFieldValues>>[],
    });
  }, []);

  return (
    <PageFormAsyncSelect<TFieldValues>
      name={props.name}
      id="terraform-job-template-select"
      label={t('Terraform template')}
      query={query}
      valueToString={(value) => {
        if (value && typeof value === 'string') return value;
        return (value as TerraformJobTemplate)?.name ?? '';
      }}
      placeholder={t('Select a Terraform template')}
      loadingPlaceholder={t('Loading Terraform templates...')}
      loadingErrorText={t('Error loading Terraform templates')}
      isRequired={props.isRequired}
      limit={200}
      openSelectDialog={openSelectDialog}
    />
  );
}
