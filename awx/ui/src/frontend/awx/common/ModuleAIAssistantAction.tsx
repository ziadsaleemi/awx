import { Button, Tooltip } from '@patternfly/react-core';
import { OutlinedCommentDotsIcon } from '@patternfly/react-icons';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { openAIAssistantWithContext, useAIAssistantEnabled } from './AIAssistant';

export function ModuleAIAssistantAction(props: {
  module: string;
  page: string;
  prompt: string;
  context?: Record<string, unknown>;
}) {
  const { module, page, prompt, context } = props;
  const { t } = useTranslation();
  const location = useLocation();
  const { enabled } = useAIAssistantEnabled();

  if (!enabled) return null;

  return (
    <Tooltip content={t('Ask assistant about this module')}>
      <Button
        variant="plain"
        aria-label={t('Ask assistant about this module')}
        title={t('Ask assistant about this module')}
        data-cy="module-ai-assistant"
        onClick={() =>
          openAIAssistantWithContext({
            prompt,
            source: 'module_page_action',
            page_kind: 'module',
            page_label: page,
            module,
            path: location.pathname,
            search: location.search,
            hash: location.hash,
            ...context,
          })
        }
      >
        <OutlinedCommentDotsIcon />
      </Button>
    </Tooltip>
  );
}
