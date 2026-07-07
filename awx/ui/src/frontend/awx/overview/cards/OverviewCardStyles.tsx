import { Spinner } from '@patternfly/react-core';
import { CSSProperties, ReactNode } from 'react';

const panelBackground = '#222428';
const borderColor = 'var(--pf-v5-global--BorderColor--100)';
const mutedColor = 'var(--pf-v5-global--Color--200)';

export const overviewCardBodyStyle: CSSProperties = {
  minWidth: 0,
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  overflow: 'hidden',
};

export const overviewMutedTextStyle: CSSProperties = {
  color: mutedColor,
};

export function OverviewCenteredSpinner() {
  return (
    <div
      style={{
        minHeight: 180,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Spinner size="lg" />
    </div>
  );
}

export function OverviewMetricGrid(props: { children: ReactNode; minWidth?: number }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(${props.minWidth ?? 140}px, 1fr))`,
        gap: 12,
        minWidth: 0,
      }}
    >
      {props.children}
    </div>
  );
}

export function OverviewMetricTile(props: {
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'danger';
}) {
  const toneColor =
    props.tone === 'success'
      ? 'var(--pf-v5-global--success-color--100)'
      : props.tone === 'warning'
        ? 'var(--pf-v5-global--warning-color--100)'
        : props.tone === 'danger'
          ? 'var(--pf-v5-global--danger-color--100)'
          : undefined;

  return (
    <div
      style={{
        background: panelBackground,
        border: `1px solid ${borderColor}`,
        padding: '14px 16px',
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: 24,
          lineHeight: 1.15,
          fontWeight: 700,
          color: toneColor,
          overflowWrap: 'anywhere',
        }}
      >
        {props.value}
      </div>
      <div style={{ marginTop: 8, fontSize: 13, fontWeight: 600, overflowWrap: 'anywhere' }}>
        {props.label}
      </div>
      {props.detail && (
        <div
          style={{
            ...overviewMutedTextStyle,
            marginTop: 8,
            fontSize: 12,
            lineHeight: 1.35,
            overflowWrap: 'anywhere',
          }}
        >
          {props.detail}
        </div>
      )}
    </div>
  );
}

export function OverviewSection(props: { title?: ReactNode; children: ReactNode }) {
  return (
    <section style={{ minWidth: 0 }}>
      {props.title && (
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, overflowWrap: 'anywhere' }}>
          {props.title}
        </div>
      )}
      {props.children}
    </section>
  );
}

export function OverviewRows(props: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gap: 8,
        minWidth: 0,
      }}
    >
      {props.children}
    </div>
  );
}

export function OverviewRow(props: {
  children: ReactNode;
  accentColor?: string;
  right?: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: props.right ? 'minmax(0, 1fr) auto' : 'minmax(0, 1fr)',
        gap: 12,
        alignItems: 'center',
        background: panelBackground,
        border: `1px solid ${borderColor}`,
        borderLeft: `3px solid ${props.accentColor ?? borderColor}`,
        padding: '10px 12px',
        minWidth: 0,
      }}
    >
      <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{props.children}</div>
      {props.right && (
        <div style={{ minWidth: 0, textAlign: 'right', whiteSpace: 'nowrap' }}>{props.right}</div>
      )}
    </div>
  );
}

export function OverviewTwoColumnGrid(props: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: 16,
        minWidth: 0,
      }}
    >
      {props.children}
    </div>
  );
}
