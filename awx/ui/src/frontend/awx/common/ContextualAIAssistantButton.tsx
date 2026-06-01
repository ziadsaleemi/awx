import { Button, Tooltip } from '@patternfly/react-core';
import { RobotIcon } from '@patternfly/react-icons';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { openAIAssistantWithContext } from './AIAssistant';

type ContextualPageKind = 'create' | 'edit' | 'detail';

function getPathSegments(pathname: string) {
  return pathname.replace(/\/+$/, '').split('/').filter(Boolean);
}

function getContextualPageKind(pathname: string): ContextualPageKind | null {
  const segments = getPathSegments(pathname);

  if (!segments.length) return null;
  if (segments[0] === 'login') return null;
  if (segments[0] === 'settings' && segments[1] === 'ai-assistant') return null;

  if (segments.includes('create') || segments.includes('add')) return 'create';
  if (segments.includes('edit')) return 'edit';
  if (segments[segments.length - 1] === 'details' || segments[segments.length - 1] === 'detail') {
    return 'detail';
  }

  return null;
}

function formatSegment(segment: string) {
  return segment
    .replaceAll('-', ' ')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getPageLabel(pathname: string) {
  const ignoredSegments = new Set(['add', 'create', 'detail', 'details', 'edit']);
  const segments = getPathSegments(pathname)
    .filter((segment) => !ignoredSegments.has(segment))
    .filter((segment) => !/^\d+$/.test(segment))
    .slice(-2);

  return segments.map(formatSegment).join(' ');
}

export function ContextualAIAssistantButton(props: { isEnabled: boolean }) {
  const { isEnabled } = props;
  const { t } = useTranslation();
  const location = useLocation();

  const pageKind = useMemo(() => getContextualPageKind(location.pathname), [location.pathname]);
  const pageLabel = useMemo(() => getPageLabel(location.pathname), [location.pathname]);
  const resourceLabel = pageLabel || t('AWX resource');

  const prompt = useMemo(() => {
    switch (pageKind) {
      case 'create':
        return t(
          'Help create this {{resource}} in AWX. Use the current page context, existing AWX resources, organization scope, and my permissions. If changes are needed, produce a reviewable resource plan.',
          { resource: resourceLabel }
        );
      case 'edit':
        return t(
          'Help edit this {{resource}} in AWX. Use the current object, related AWX resources, organization scope, and my permissions. If changes are needed, produce a reviewable resource plan.',
          { resource: resourceLabel }
        );
      case 'detail':
        return t(
          'Help with this {{resource}} in AWX. Use the current object, related AWX resources, organization scope, and my permissions. If changes are needed, produce a reviewable resource plan.',
          { resource: resourceLabel }
        );
      default:
        return '';
    }
  }, [pageKind, resourceLabel, t]);

  if (!isEnabled || !pageKind) {
    return null;
  }

  return (
    <Tooltip content={t('Open AI assistant for this page')} position="left">
      <Button
        variant="secondary"
        aria-label={t('Open AI assistant for this page')}
        onClick={() =>
          openAIAssistantWithContext({
            prompt,
            source: 'contextual_page_action',
            page_kind: pageKind,
            page_label: resourceLabel,
            path: location.pathname,
            search: location.search,
            hash: location.hash,
            title: typeof document !== 'undefined' ? document.title : undefined,
          })
        }
        icon={<RobotIcon />}
        data-cy="contextual-ai-assistant"
        style={{
          position: 'fixed',
          top: 96,
          right: 16,
          zIndex: 500,
          boxShadow: 'var(--pf-v5-global--BoxShadow--md)',
        }}
      >
        {t('AI')}
      </Button>
    </Tooltip>
  );
}
