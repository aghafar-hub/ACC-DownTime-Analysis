// Colours for the charts. Only theme tokens (CSS variables) plus the platform's fixed categorical palette.
export const SERIES_LIGHT = ['#2A78D6', '#EB6834', '#1BAF7A', '#EDA100', '#E87BA4', '#008300', '#4A3AA7', '#E34948'];
export const SERIES_DARK = ['#3987E5', '#D95926', '#199E70', '#C98500', '#D55181', '#008300', '#9085E9', '#E66767'];

/** Series colour by slot, never cycled: a ninth series gets a neutral token colour. */
export function seriesColor(dark: boolean, slot: number): string {
  const list = dark ? SERIES_DARK : SERIES_LIGHT;
  return slot >= 0 && slot < list.length ? list[slot]! : 'var(--tk-text-muted)';
}

/** Classifications keep one slot each, in this order, on every chart. */
export const CLASS_ORDER = ['PRO', 'MEC', 'ELE', 'AUT', 'PL', 'CIR'] as const;
export function classColor(dark: boolean, code: string): string {
  return seriesColor(dark, CLASS_ORDER.indexOf(code as (typeof CLASS_ORDER)[number]));
}

/** Planned / failure / other stacks use meaning tokens, not the categorical palette. */
export const STACK_COLORS = {
  planned: 'var(--tk-info)',
  failure: 'var(--tk-danger)',
  other: 'var(--tk-warning)',
  operating: 'var(--tk-success)',
  stopped: 'var(--tk-text-muted)',
} as const;

export const ACCENT = 'var(--tk-accent)';
export const INK = 'var(--tk-text-primary)';
export const INK2 = 'var(--tk-text-secondary)';
export const GRID = 'var(--tk-border2)';
export const AXIS = 'var(--tk-border)';

export type Marker = 'circle' | 'square' | 'diamond' | 'triangle';
export const MARKERS: Marker[] = ['circle', 'square', 'diamond', 'triangle'];
