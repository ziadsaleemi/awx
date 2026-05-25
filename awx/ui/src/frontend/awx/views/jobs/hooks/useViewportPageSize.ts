import { useEffect, useState } from 'react';

/**
 * Returns an optimal page size that fills the current viewport height.
 *
 * Calculation: (window.innerHeight - reservedPx) / rowHeight
 * - `reservedPx`  accounts for masthead (~60px) + page header (~80px) +
 *                 toolbar (~56px) + pagination bar (~50px) + padding.
 * - Result is clamped between `min` (10) and `max` (50).
 *
 * Re-evaluates on window resize so the size stays correct when the user
 * resizes their browser window (e.g. undocking the DevTools panel).
 *
 * If the user has previously chosen a perPage from the pagination UI it is
 * stored in localStorage and `useView` will prefer that over this default,
 * so this only takes effect on a fresh first visit or after clearing storage.
 */
export function useViewportPageSize(rowHeight = 52, reservedPx = 296): number {
  const [size, setSize] = useState(() => {
    const rows = Math.floor((window.innerHeight - reservedPx) / rowHeight);
    return Math.max(10, Math.min(50, rows));
  });

  useEffect(() => {
    const recalculate = () => {
      const rows = Math.floor((window.innerHeight - reservedPx) / rowHeight);
      setSize(Math.max(10, Math.min(50, rows)));
    };
    window.addEventListener('resize', recalculate);
    return () => window.removeEventListener('resize', recalculate);
  }, [rowHeight, reservedPx]);

  return size;
}
