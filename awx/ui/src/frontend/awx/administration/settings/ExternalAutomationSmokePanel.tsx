import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  CodeBlock,
  CodeBlockCode,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Label,
  PageSection,
  Spinner,
  Stack,
  StackItem,
} from '@patternfly/react-core';
import { CheckCircleIcon, SyncAltIcon, TimesCircleIcon } from '@patternfly/react-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useGetPageUrl } from '../../../../framework';
import { postRequest } from '../../../common/crud/Data';
import { awxAPI } from '../../common/api/awx-utils';
import { AwxRoute } from '../../main/AwxRoutes';

interface ExternalAutomationCheck {
  ok: boolean;
  status: string;
  count?: number;
  allowed?: boolean;
  health_status_code?: number;
  deny_smoke?: {
    ok: boolean;
    status: string;
    allowed?: boolean;
  };
  policy_sync?: {
    requested?: boolean;
    ok?: boolean;
    status?: string;
    policy_id?: string;
  };
}

interface ExternalAutomationCheckResponse {
  ok: boolean;
  checks: {
    eda?: ExternalAutomationCheck;
    opa?: ExternalAutomationCheck;
  };
  audit?: {
    activity_stream_id: number;
    activity_stream_url: string;
  };
}

interface ExternalAutomationCheckRequest {
  include_eda: boolean;
  include_opa: boolean;
  sync_opa_policy: boolean;
  opa_policy_id: string;
  opa_deny_smoke: boolean;
  start_eda_activation: boolean;
}

function StatusLabel(props: { check?: ExternalAutomationCheck }) {
  const { t } = useTranslation();
  if (!props.check) {
    return (
      <Label color="grey" icon={<TimesCircleIcon />}>
        {t('Not checked')}
      </Label>
    );
  }
  return props.check.ok ? (
    <Label color="green" icon={<CheckCircleIcon />}>
      {props.check.status}
    </Label>
  ) : (
    <Label color="red" icon={<TimesCircleIcon />}>
      {props.check.status}
    </Label>
  );
}

export function ExternalAutomationSmokePanel() {
  const { t } = useTranslation();
  const getPageUrl = useGetPageUrl();
  const [result, setResult] = useState<ExternalAutomationCheckResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const runSmoke = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const response = await postRequest<
        ExternalAutomationCheckResponse,
        ExternalAutomationCheckRequest
      >(awxAPI`/external_automation/check/`, {
        include_eda: true,
        include_opa: true,
        sync_opa_policy: true,
        opa_policy_id: 'awx/managed',
        opa_deny_smoke: true,
        start_eda_activation: false,
      });
      setResult(response);
    } catch {
      setError(t('External automation smoke check failed. Check service settings and logs.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageSection isWidthLimited data-cy="external-automation-smoke">
      <Card isFlat>
        <CardHeader>
          <CardTitle>{t('External Automation Smoke')}</CardTitle>
        </CardHeader>
        <CardBody>
          <Stack hasGutter>
            <StackItem>
              <Button
                variant="secondary"
                icon={<SyncAltIcon />}
                onClick={() => void runSmoke()}
                isLoading={loading}
                isDisabled={loading}
              >
                {t('Run EDA and OPA smoke')}
              </Button>
            </StackItem>
            {loading ? (
              <StackItem>
                <Spinner size="md" />
              </StackItem>
            ) : null}
            {error ? (
              <StackItem>
                <Alert variant="danger" isInline title={error} />
              </StackItem>
            ) : null}
            {result ? (
              <>
                <StackItem>
                  <Alert
                    variant={result.ok ? 'success' : 'danger'}
                    isInline
                    title={
                      result.ok
                        ? t('External automation smoke passed.')
                        : t('External automation smoke failed.')
                    }
                  />
                </StackItem>
                <StackItem>
                  <DescriptionList isHorizontal isCompact>
                    <DescriptionListGroup>
                      <DescriptionListTerm>{t('EDA')}</DescriptionListTerm>
                      <DescriptionListDescription>
                        <StatusLabel check={result.checks.eda} />
                      </DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                      <DescriptionListTerm>{t('EDA activations')}</DescriptionListTerm>
                      <DescriptionListDescription>
                        {result.checks.eda?.count ?? t('Not checked')}
                      </DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                      <DescriptionListTerm>{t('OPA')}</DescriptionListTerm>
                      <DescriptionListDescription>
                        <StatusLabel check={result.checks.opa} />
                      </DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                      <DescriptionListTerm>{t('OPA allow')}</DescriptionListTerm>
                      <DescriptionListDescription>
                        {result.checks.opa?.allowed === true ? t('Allowed') : t('Not allowed')}
                      </DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                      <DescriptionListTerm>{t('OPA deny smoke')}</DescriptionListTerm>
                      <DescriptionListDescription>
                        {result.checks.opa?.deny_smoke?.status ?? t('Not checked')}
                      </DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                      <DescriptionListTerm>{t('OPA policy sync')}</DescriptionListTerm>
                      <DescriptionListDescription>
                        {result.checks.opa?.policy_sync?.status ?? t('Not checked')}
                      </DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                      <DescriptionListTerm>{t('Activity Stream ID')}</DescriptionListTerm>
                      <DescriptionListDescription>
                        {result.audit?.activity_stream_id ? (
                          <Link
                            to={getPageUrl(AwxRoute.ActivityStream, {
                              query: { id: result.audit.activity_stream_id },
                            })}
                            data-cy="external-automation-audit-link"
                          >
                            {result.audit.activity_stream_id}
                          </Link>
                        ) : (
                          t('Not recorded')
                        )}
                      </DescriptionListDescription>
                    </DescriptionListGroup>
                  </DescriptionList>
                </StackItem>
                <StackItem>
                  <CodeBlock>
                    <CodeBlockCode>{JSON.stringify(result, null, 2)}</CodeBlockCode>
                  </CodeBlock>
                </StackItem>
              </>
            ) : null}
          </Stack>
        </CardBody>
      </Card>
    </PageSection>
  );
}
