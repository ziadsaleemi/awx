import { Button, Tooltip } from '@patternfly/react-core';
import { OutlinedCommentDotsIcon } from '@patternfly/react-icons';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import styled from 'styled-components';
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

const ContextualAssistantButton = styled(Button)`
  position: fixed;
  bottom: 24px;
  right: 16px;
  z-index: 500;
  width: 44px;
  height: 44px;
  padding: 0;
  align-items: center;
  justify-content: center;
  color: var(--pf-v5-global--Color--200);
  background: var(--pf-v5-global--BackgroundColor--200);
  border: 1px solid var(--pf-v5-global--BorderColor--100);
  border-radius: 8px;
  box-shadow: var(--pf-v5-global--BoxShadow--sm);

  &:hover,
  &:focus {
    color: var(--pf-v5-global--primary-color--100);
    background: var(--pf-v5-global--BackgroundColor--300);
  }
`;

export function ContextualAIAssistantButton(props: { isEnabled: boolean }) {
  const { isEnabled } = props;
  const { t } = useTranslation();
  const location = useLocation();

  const pageKind = useMemo(() => getContextualPageKind(location.pathname), [location.pathname]);
  const pageLabel = useMemo(() => getPageLabel(location.pathname), [location.pathname]);
  const resourceLabel = pageLabel || t('Capstan resource');

  const prompt = useMemo(() => {
    switch (pageKind) {
      case 'create':
        return t(
          'Help create this {{resource}} in Capstan. Use the current page context, existing Capstan resources, organization scope, and my permissions. If changes are needed, produce a reviewable resource plan.',
          { resource: resourceLabel }
        );
      case 'edit':
        return t(
          'Help edit this {{resource}} in Capstan. Use the current object, related Capstan resources, organization scope, and my permissions. If changes are needed, produce a reviewable resource plan.',
          { resource: resourceLabel }
        );
      case 'detail':
        return t(
          'Help with this {{resource}} in Capstan. Use the current object, related Capstan resources, organization scope, and my permissions. If changes are needed, produce a reviewable resource plan.',
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
      <ContextualAssistantButton
        variant="plain"
        aria-label={t('Open AI assistant for this page')}
        title={t('Open AI assistant for this page')}
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
        data-cy="contextual-ai-assistant"
      >
        <OutlinedCommentDotsIcon />
      </ContextualAssistantButton>
    </Tooltip>
  );
}
