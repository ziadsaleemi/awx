import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  CodeBlock,
  CodeBlockCode,
} from '@patternfly/react-core';
import {
  LoadingPage,
  PageDetail,
  PageDetails,
  PageHeader,
  PageLayout,
  useGetPageUrl,
  usePageAlertToaster,
  usePageNavigate,
} from '../../../../framework';
import { requestDelete } from '../../../common/crud/Data';
import { useGet, useGetItem } from '../../../common/crud/useGet';
import { usePostRequest } from '../../../common/crud/usePostRequest';
import { StatusLabel } from '../../../common/Status';
import { AwxItemsResponse } from '../../common/AwxItemsResponse';
import { AwxError } from '../../common/AwxError';
import { awxAPI } from '../../common/api/awx-utils';
import { useAwxActiveUser } from '../../common/useAwxActiveUser';
import {
  EdaActivation,
  EdaActivationActionResponse,
  EdaActivationEvent,
} from '../../interfaces/EdaActivation';
import { useAwxNavigationCapabilities } from '../../main/awxNavigationCapabilities';
import { AwxRoute } from '../../main/AwxRoutes';

export function EdaActivationPage() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const id = params.id ?? '';
  const getPageUrl = useGetPageUrl();
  const pageNavigate = usePageNavigate();
  const alertToaster = usePageAlertToaster();
  const postRequest = usePostRequest<unknown, EdaActivationActionResponse>();
  const { activeAwxUser } = useAwxActiveUser();
  const capabilities = useAwxNavigationCapabilities(activeAwxUser);
  const canOperateEda = Boolean(activeAwxUser?.is_superuser) || Boolean(capabilities.canOperateEda);
  const canManageEda = Boolean(activeAwxUser?.is_superuser) || Boolean(capabilities.canManageEda);
  const {
    data: activation,
    error,
    isLoading,
    refresh,
  } = useGetItem<EdaActivation>(awxAPI`/eda/activations`, id);
  const {
    data: events,
    error: eventsError,
    refresh: refreshEvents,
  } = useGet<AwxItemsResponse<EdaActivationEvent>>(
    id ? awxAPI`/eda/activations/${id}/events/` : undefined,
    {
      page_size: 50,
    }
  );

  const runAction = useCallback(
    async (action: 'enable' | 'disable' | 'restart') => {
      if (!activation) return;
      try {
        await postRequest(awxAPI`/eda/activations/${String(activation.id)}/${action}/`, {});
        alertToaster.addAlert({
          variant: 'success',
          title: t('EDA activation {{action}} requested', { action }),
          timeout: 4000,
        });
        refresh();
        refreshEvents();
      } catch (err) {
        alertToaster.addAlert({
          variant: 'danger',
          title: t('Failed to update EDA activation'),
          children: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [activation, alertToaster, postRequest, refresh, refreshEvents, t]
  );

  const deleteActivation = useCallback(async () => {
    if (!activation) return;
    try {
      await requestDelete(
        awxAPI`/eda/activations/${String(activation.id)}/`,
        new AbortController().signal
      );
      alertToaster.addAlert({
        variant: 'success',
        title: t('EDA activation delete requested'),
        timeout: 4000,
      });
      pageNavigate(AwxRoute.EdaActivations);
    } catch (err) {
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Failed to delete EDA activation'),
        children: err instanceof Error ? err.message : String(err),
      });
    }
  }, [activation, alertToaster, pageNavigate, t]);

  const eventLog = useMemo(() => {
    const rows = events?.results ?? [];
    if (!rows.length) return t('No activation events found.');
    return rows
      .map((event) =>
        [
          event.created || '-',
          event.event_type || 'event',
          event.status || '',
          event.rule ? `rule=${event.rule}` : '',
          event.message || '',
        ]
          .filter(Boolean)
          .join(' ')
      )
      .join('\n');
  }, [events?.results, t]);

  if (error) return <AwxError error={error} handleRefresh={refresh} />;
  if (eventsError) return <AwxError error={eventsError} handleRefresh={refreshEvents} />;
  if (isLoading || !activation) return <LoadingPage />;

  return (
    <PageLayout>
      <PageHeader
        title={activation.name || String(activation.id)}
        titleAdornment={<StatusLabel status={activation.status} />}
        breadcrumbs={[
          { label: t('EDA Activations'), to: getPageUrl(AwxRoute.EdaActivations) },
          { label: activation.name || String(activation.id) },
        ]}
        headerActions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button
              variant="secondary"
              isDisabled={!canOperateEda}
              onClick={() => void runAction('restart')}
            >
              {t('Restart')}
            </Button>
            <Button
              variant="secondary"
              isDisabled={!canOperateEda}
              onClick={() => void runAction('enable')}
            >
              {t('Enable')}
            </Button>
            <Button
              variant="secondary"
              isDisabled={!canOperateEda}
              onClick={() => void runAction('disable')}
            >
              {t('Disable')}
            </Button>
            <Button
              variant="danger"
              isDisabled={!canManageEda}
              onClick={() => void deleteActivation()}
            >
              {t('Delete')}
            </Button>
          </div>
        }
      />
      <PageDetails>
        <PageDetail label={t('Name')}>{activation.name || '-'}</PageDetail>
        <PageDetail label={t('Status')}>
          <StatusLabel status={activation.status} />
        </PageDetail>
        <PageDetail label={t('Rulebook')}>{activation.rulebook || '-'}</PageDetail>
        <PageDetail label={t('Event source')}>{activation.event_source || '-'}</PageDetail>
        <PageDetail label={t('Started')}>
          {activation.started ? new Date(activation.started).toLocaleString() : '-'}
        </PageDetail>
        <PageDetail label={t('Finished')}>
          {activation.finished ? new Date(activation.finished).toLocaleString() : '-'}
        </PageDetail>
        <PageDetail label={t('Controller source')}>{activation.source || '-'}</PageDetail>
        <PageDetail label={t('Controller URL')}>
          {activation.related?.controller_activation ? (
            <a href={activation.related.controller_activation} target="_blank" rel="noreferrer">
              {activation.related.controller_activation}
            </a>
          ) : (
            '-'
          )}
        </PageDetail>
      </PageDetails>
      <Card style={{ margin: '0 24px 24px' }}>
        <CardHeader>
          <CardTitle>{t('Activation events')}</CardTitle>
        </CardHeader>
        <CardBody>
          <CodeBlock>
            <CodeBlockCode>{eventLog}</CodeBlockCode>
          </CodeBlock>
        </CardBody>
      </Card>
    </PageLayout>
  );
}
