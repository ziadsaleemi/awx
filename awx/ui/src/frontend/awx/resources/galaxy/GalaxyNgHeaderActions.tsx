import { Button, Flex, FlexItem } from '@patternfly/react-core';
import { ExternalLinkAltIcon } from '@patternfly/react-icons';
import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ModuleAIAssistantAction } from '../../common/ModuleAIAssistantAction';
import type { GalaxyNgStatus } from './GalaxyNgOverview';

export function getGalaxyBrowserUrl(url?: string) {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    const currentHost = typeof window !== 'undefined' ? window.location.hostname : '';
    if (
      parsed.hostname === 'host.docker.internal' &&
      (currentHost === 'localhost' || currentHost === '127.0.0.1')
    ) {
      parsed.hostname = currentHost;
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

export function getGalaxyApiBrowserUrl(apiRootUrl?: string) {
  if (!apiRootUrl) return undefined;
  try {
    return new URL('v3/swagger-ui/', apiRootUrl).toString();
  } catch {
    return apiRootUrl;
  }
}

export function getGalaxyUiRoute(uiUrl?: string, route?: string) {
  const browserUrl = getGalaxyBrowserUrl(uiUrl);
  if (!browserUrl) return undefined;
  try {
    const base = browserUrl.endsWith('/') ? browserUrl : `${browserUrl}/`;
    return new URL((route || '').replace(/^\//, ''), base).toString();
  } catch {
    return browserUrl;
  }
}

export function GalaxyNgHeaderActions(props: {
  status?: GalaxyNgStatus;
  uiRoute?: string;
  page: string;
  prompt: string;
  context?: Record<string, unknown>;
  extraActions?: ReactNode;
}) {
  const { t } = useTranslation();
  const uiUrl = getGalaxyUiRoute(props.status?.ui_url, props.uiRoute);
  const apiUrl = getGalaxyBrowserUrl(
    props.status?.api_browser_url || getGalaxyApiBrowserUrl(props.status?.api_root_url)
  );

  return (
    <Flex
      spaceItems={{ default: 'spaceItemsSm' }}
      alignItems={{ default: 'alignItemsCenter' }}
      flexWrap={{ default: 'wrap' }}
    >
      {props.extraActions ? <FlexItem>{props.extraActions}</FlexItem> : null}
      {uiUrl ? (
        <FlexItem>
          <Button
            component="a"
            href={uiUrl}
            target="_blank"
            rel="noreferrer"
            variant="secondary"
            icon={<ExternalLinkAltIcon />}
          >
            {t('Open Galaxy UI')}
          </Button>
        </FlexItem>
      ) : null}
      {apiUrl ? (
        <FlexItem>
          <Button
            component="a"
            href={apiUrl}
            target="_blank"
            rel="noreferrer"
            variant="secondary"
            icon={<ExternalLinkAltIcon />}
          >
            {t('Open API')}
          </Button>
        </FlexItem>
      ) : null}
      <FlexItem>
        <ModuleAIAssistantAction
          module="galaxy_ng"
          page={props.page}
          prompt={props.prompt}
          context={props.context}
        />
      </FlexItem>
    </Flex>
  );
}
