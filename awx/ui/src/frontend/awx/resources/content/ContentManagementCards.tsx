import {
  Label,
  Stack,
  StackItem,
  Text,
  TextContent,
  TextVariants,
  Title,
} from '@patternfly/react-core';
import { CheckCircleIcon, TimesCircleIcon } from '@patternfly/react-icons';
import { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function ContentStatusLabel(props: {
  enabled: boolean;
  enabledText: string;
  disabledText: string;
}) {
  return props.enabled ? (
    <Label color="green" icon={<CheckCircleIcon />}>
      {props.enabledText}
    </Label>
  ) : (
    <Label color="grey" icon={<TimesCircleIcon />}>
      {props.disabledText}
    </Label>
  );
}

export interface ContentSummaryMetric {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
}

export function ContentSummaryGrid(props: { metrics: ContentSummaryMetric[]; minWidth?: number }) {
  const minWidth = props.minWidth ?? 180;
  return (
    <div
      style={{
        borderInlineStart: '1px solid var(--pf-v5-global--BorderColor--100)',
        borderTop: '1px solid var(--pf-v5-global--BorderColor--100)',
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(min(${minWidth}px, 100%), 1fr))`,
      }}
    >
      {props.metrics.map((metric, index) => (
        <div
          key={`${metric.label}-${index}`}
          style={{
            borderBottom: '1px solid var(--pf-v5-global--BorderColor--100)',
            borderInlineEnd: '1px solid var(--pf-v5-global--BorderColor--100)',
            minWidth: 0,
            padding: '14px 18px',
          }}
        >
          <TextContent>
            <Title
              headingLevel="h3"
              size="xl"
              title={typeof metric.value === 'string' ? metric.value : undefined}
              style={{
                lineHeight: 1.25,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {metric.value}
            </Title>
            <Text component={TextVariants.small} style={{ opacity: 0.78 }}>
              {metric.label}
            </Text>
            {metric.detail ? (
              <Text
                component={TextVariants.small}
                style={{
                  opacity: 0.62,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={typeof metric.detail === 'string' ? metric.detail : undefined}
              >
                {metric.detail}
              </Text>
            ) : null}
          </TextContent>
        </div>
      ))}
    </div>
  );
}

export interface ContentStatusItem {
  label: string;
  value: ReactNode;
  ok?: boolean;
}

export function ContentStatusStrip(props: { items: ContentStatusItem[] }) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
      }}
    >
      {props.items.map((item) => (
        <Label
          key={item.label}
          color={item.ok === false ? 'grey' : item.ok === true ? 'green' : 'blue'}
          icon={
            item.ok === false ? (
              <TimesCircleIcon />
            ) : item.ok === true ? (
              <CheckCircleIcon />
            ) : undefined
          }
        >
          {item.label}: {item.value}
        </Label>
      ))}
    </div>
  );
}

export interface ContentWorkflowLink {
  label: string;
  description: string;
  to?: string;
  href?: string;
}

export interface ContentWorkflowGroup {
  title: string;
  description?: string;
  links: ContentWorkflowLink[];
}

export function ContentWorkflowGroups(props: { groups: ContentWorkflowGroup[] }) {
  return (
    <div
      style={{
        display: 'grid',
        gap: 24,
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))',
      }}
    >
      {props.groups.map((group) => (
        <Stack key={group.title} hasGutter>
          <StackItem>
            <TextContent>
              <Title headingLevel="h3" size="md">
                {group.title}
              </Title>
              {group.description ? (
                <Text component={TextVariants.small} style={{ opacity: 0.72 }}>
                  {group.description}
                </Text>
              ) : null}
            </TextContent>
          </StackItem>
          <StackItem>
            <div style={{ borderTop: '1px solid var(--pf-v5-global--BorderColor--100)' }}>
              {group.links.map((link) => (
                <div
                  key={`${group.title}-${link.label}`}
                  style={{
                    borderBottom: '1px solid var(--pf-v5-global--BorderColor--100)',
                    padding: '10px 0',
                  }}
                >
                  <TextContent>
                    <Text component={TextVariants.p} style={{ marginBottom: 2 }}>
                      {link.to ? (
                        <Link to={link.to}>{link.label}</Link>
                      ) : link.href ? (
                        <a href={link.href} target="_blank" rel="noreferrer">
                          {link.label}
                        </a>
                      ) : (
                        link.label
                      )}
                    </Text>
                    <Text component={TextVariants.small} style={{ opacity: 0.68 }}>
                      {link.description}
                    </Text>
                  </TextContent>
                </div>
              ))}
            </div>
          </StackItem>
        </Stack>
      ))}
    </div>
  );
}
