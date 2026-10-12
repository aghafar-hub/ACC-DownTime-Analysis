// Drill-through from a dashboard to the Event Explorer: the matching event ids travel in the router state
// (history state survives a reload), together with the label for the removable chip.
export interface DrillState {
  label: string;
  /** chain ids (head row event_id): the Explorer shows every row of those events */
  eventIds?: string[];
  /** row ids shown as they are */
  rowIds?: string[];
  /** years to load in the Explorer (events can span years) */
  years: number[];
  /** where the ids came from, for the chip: 'Pareto bar', 'Overview' ... */
  source: string;
}

export function readDrill(state: unknown): DrillState | null {
  const d = (state as { drill?: DrillState } | null)?.drill;
  if (!d || typeof d.label !== 'string' || !Array.isArray(d.years)) return null;
  if (!Array.isArray(d.eventIds) && !Array.isArray(d.rowIds)) return null;
  return d;
}
