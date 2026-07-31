import { Flex, FlexItem } from '@patternfly/react-core';
import { ReactNode } from 'react';
import { ModuleAIAssistantAction } from '../../common/ModuleAIAssistantAction';

export function GalaxyNgHeaderActions(props: {
  page: string;
  prompt: string;
  context?: Record<string, unknown>;
  extraActions?: ReactNode;
}) {
  return (
    <Flex
      spaceItems={{ default: 'spaceItemsSm' }}
      alignItems={{ default: 'alignItemsCenter' }}
      flexWrap={{ default: 'wrap' }}
    >
      {props.extraActions ? <FlexItem>{props.extraActions}</FlexItem> : null}
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
