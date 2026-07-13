import { useEffect, useState } from 'react';

export function getViewportPageSize(
  viewportHeight: number,
  rowHeight = 42,
  reservedPx = 296,
  min = 10,
  max = 50
) {
  const rows = Math.floor((viewportHeight - reservedPx) / rowHeight);
  return Math.max(min, Math.min(max, rows));
}

/**
 * Returns a page size that fills a standard full-page table without forcing
 * its pagination below the viewport. The reserved space covers the masthead,
 * page header, toolbar, table header, pagination, and their borders.
 */
export function useViewportPageSize(rowHeight = 42, reservedPx = 296): number {
  const [size, setSize] = useState(() =>
    getViewportPageSize(window.innerHeight, rowHeight, reservedPx)
  );

  useEffect(() => {
    const recalculate = () => {
      const nextSize = getViewportPageSize(window.innerHeight, rowHeight, reservedPx);
      setSize((currentSize) => (currentSize === nextSize ? currentSize : nextSize));
    };

    window.addEventListener('resize', recalculate);
    return () => window.removeEventListener('resize', recalculate);
  }, [rowHeight, reservedPx]);

  return size;
}
