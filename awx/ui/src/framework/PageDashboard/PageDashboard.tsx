/* eslint-disable i18next/no-literal-string */
import { PageSection } from '@patternfly/react-core';
import useResizeObserver from '@react-hook/resize-observer';
import { CSSProperties, ReactNode, createContext, useLayoutEffect, useRef, useState } from 'react';
import { Scrollable } from '../components/Scrollable';

export const PageDashboardContext = createContext({ columns: 1 });

const Divisor = 1662 / 24;

export function PageDashboard(props: { children?: ReactNode; sectionStyle?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);

  const [columns, setColumns] = useState(1);

  useLayoutEffect(() => {
    const raw = Math.max(1, Math.floor((ref.current?.clientWidth ?? 0) / Divisor));
    setColumns(Math.max(2, Math.floor(raw / 2) * 2));
  }, []);

  useResizeObserver(ref, (entry) => {
    const raw = Math.max(1, Math.floor((entry.contentRect.width ?? 0) / Divisor));
    setColumns(Math.max(2, Math.floor(raw / 2) * 2));
  });

  return (
    <PageDashboardContext.Provider value={{ columns }}>
      <Scrollable>
        <PageSection style={{ padding: '16px 0', ...props.sectionStyle }}>
          <div
            ref={ref}
            style={{ display: 'grid', gap: 16, gridTemplateColumns: `repeat(${columns}, 1fr)` }}
          >
            {props.children}
          </div>
        </PageSection>
      </Scrollable>
    </PageDashboardContext.Provider>
  );
}
