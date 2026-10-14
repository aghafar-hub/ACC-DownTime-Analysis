import { useMemo } from 'react';
import { useAreaTargets } from '../actions/ActionsContext';
import { areaTargetMap } from '../actions/targets';
import type { DashCtx } from './scope';

/** The year the Dashboard figures are about: the year of the end of the period shown. */
export const ctxYear = (ctx: DashCtx | null): number | null => {
  const end = ctx?.win.effective?.to ?? ctx?.win.range.to;
  return end ? Number(end.slice(0, 4)) : null;
};

/**
 * Availability targets of single areas for the year of the period (Settings › Actions & targets), or null when no area has
 * one: the plant-wide target then applies everywhere, exactly as before.
 */
export function useAreaTargetMap(ctx: DashCtx | null): ReadonlyMap<string, number> | null {
  const { targets } = useAreaTargets();
  const year = ctxYear(ctx);
  return useMemo(() => {
    if (year === null) return null;
    const m = areaTargetMap(targets, year);
    return m.size ? m : null;
  }, [targets, year]);
}
