/**
 * G3 — MCP Server Info Panel
 *
 * Shows the MCP server endpoint URLs and configuration snippet so users
 * can connect external AI agents (Claude Desktop, Cursor, VS Code Copilot, etc.)
 * to their AWX instance.
 */

import {
  Alert,
  Button,
  CardBody,
  ClipboardCopy,
  ClipboardCopyVariant,
  CodeBlock,
  CodeBlockCode,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Text,
  TextContent,
  TextVariants,
} from '@patternfly/react-core';
import { ExternalLinkAltIcon } from '@patternfly/react-icons';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { PageDashboardCard } from '../../../../framework/PageDashboard/PageDashboardCard';
import { requestGet } from '../../../common/crud/Data';
import { awxAPI } from '../../common/api/awx-utils';

interface AISettings {
  enabled: boolean;
  provider: string;
  model: string;
  configured: boolean;
}

interface MCPManifest {
  tool_count?: number;
  policy_context_enabled?: boolean;
  capabilities?: {
    audit?: {
      activity_stream?: boolean;
    };
  };
}

function useBaseUrl(): string {
  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.host}`;
  }
  return '';
}

export function MCPServerInfoCard() {
  const { t } = useTranslation();
  const base = useBaseUrl();
  const { data: aiSettings } = useSWR<AISettings>(awxAPI`/ai/settings/`, (url: string) =>
    requestGet<AISettings>(url).catch(() => ({
      enabled: false,
      provider: '',
      model: '',
      configured: false,
    }))
  );
  const { data: manifest } = useSWR<MCPManifest>(awxAPI`/mcp/manifest/`, (url: string) =>
    requestGet<MCPManifest>(url).catch(() => ({}))
  );

  const manifestUrl = `${base}/api/v2/mcp/manifest/`;
  const toolsUrl = `${base}/api/v2/mcp/tools/`;
  const invokeUrl = `${base}/api/v2/mcp/invoke/`;

  const claudeConfig = JSON.stringify(
    {
      mcpServers: {
        awx: {
          command: 'npx',
          args: ['-y', 'mcp-remote', manifestUrl],
          env: {
            MCP_AUTH_HEADER: 'Authorization: Bearer <YOUR_AWX_TOKEN>',
          },
        },
      },
    },
    null,
    2
  );

  const curlExample = `curl -s -X POST ${invokeUrl} \\
  -H "Authorization: Bearer <YOUR_AWX_TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"list_job_templates","arguments":{"search":"deploy"}}' | jq .`;

  return (
    <PageDashboardCard title={t('MCP Server')} width="lg" height="md">
      <CardBody>
        {!aiSettings?.enabled && (
          <Alert
            variant="info"
            isInline
            title={t('AI is not enabled')}
            style={{ marginBottom: 12 }}
          >
            {t(
              'Enable the AI Assistant under Administration → Settings → AI Assistant to get AI-powered tool suggestions.'
            )}
          </Alert>
        )}

        <TextContent style={{ marginBottom: 12 }}>
          <Text component={TextVariants.p}>
            {t(
              'Your AWX instance exposes a Model Context Protocol (MCP) server. Connect any MCP-compatible AI agent to automate and query AWX resources using natural language.'
            )}
          </Text>
        </TextContent>

        <DescriptionList isCompact isHorizontal style={{ marginBottom: 16 }}>
          <DescriptionListGroup>
            <DescriptionListTerm>{t('Manifest URL')}</DescriptionListTerm>
            <DescriptionListDescription>
              <ClipboardCopy
                isReadOnly
                variant={ClipboardCopyVariant.inline}
                hoverTip={t('Copy')}
                clickTip={t('Copied')}
              >
                {manifestUrl}
              </ClipboardCopy>
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>{t('Tools URL')}</DescriptionListTerm>
            <DescriptionListDescription>
              <ClipboardCopy
                isReadOnly
                variant={ClipboardCopyVariant.inline}
                hoverTip={t('Copy')}
                clickTip={t('Copied')}
              >
                {toolsUrl}
              </ClipboardCopy>
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>{t('Invoke URL')}</DescriptionListTerm>
            <DescriptionListDescription>
              <ClipboardCopy
                isReadOnly
                variant={ClipboardCopyVariant.inline}
                hoverTip={t('Copy')}
                clickTip={t('Copied')}
              >
                {invokeUrl}
              </ClipboardCopy>
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>{t('Authentication')}</DescriptionListTerm>
            <DescriptionListDescription>
              {t('AWX personal access token (Bearer). Create one under User → Tokens.')}
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>{t('Tools')}</DescriptionListTerm>
            <DescriptionListDescription>
              {manifest?.tool_count
                ? t('{{count}} tools available', { count: manifest.tool_count })
                : t('Tool discovery enabled')}
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>{t('Audit')}</DescriptionListTerm>
            <DescriptionListDescription>
              {manifest?.capabilities?.audit?.activity_stream
                ? t('Activity Stream records MCP actions')
                : t('Activity Stream audit unavailable')}
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>{t('Policy context')}</DescriptionListTerm>
            <DescriptionListDescription>
              {manifest?.policy_context_enabled
                ? t('Enabled for MCP tool responses')
                : t('Configure MCP Policy Context in AI Assistant settings')}
            </DescriptionListDescription>
          </DescriptionListGroup>
        </DescriptionList>

        <TextContent style={{ marginBottom: 6 }}>
          <Text component={TextVariants.h4}>{t('Claude Desktop config snippet')}</Text>
        </TextContent>
        <CodeBlock style={{ marginBottom: 16 }}>
          <CodeBlockCode>{claudeConfig}</CodeBlockCode>
        </CodeBlock>

        <TextContent style={{ marginBottom: 6 }}>
          <Text component={TextVariants.h4}>{t('Quick test with curl')}</Text>
        </TextContent>
        <ClipboardCopy variant={ClipboardCopyVariant.expansion} isReadOnly>
          {curlExample}
        </ClipboardCopy>

        <div style={{ marginTop: 16 }}>
          <Button
            variant="link"
            icon={<ExternalLinkAltIcon />}
            iconPosition="right"
            component="a"
            href="https://modelcontextprotocol.io/introduction"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('Learn more about MCP')}
          </Button>
        </div>
      </CardBody>
    </PageDashboardCard>
  );
}
