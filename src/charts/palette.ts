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

// ---------------------------------------------------------------- dashboard paints (colour + pattern)
// The Dashboard never relies on colour alone: every stack segment has a pattern too (incidental solid, planned
// hatched, other dotted; each classification its own). Light and dark values are tuned for contrast on the card.

export type FillPattern = 'solid' | 'hatch' | 'dots' | 'stripes' | 'grid' | 'backhatch';
export interface Paint { key: string; label: string; short: string; color: string; pattern: FillPattern }

const TYPE_LIGHT = { inc: '#C2512A', pl: '#2F6BC2', cir: '#17927E' };
const TYPE_DARK = { inc: '#E27A4E', pl: '#5E9CF2', cir: '#2FB89F' };

/** Incidental (INC), planned (PL) and CIR: the three stop types, always in this order. */
export function typePaints(dark: boolean): Paint[] {
  const c = dark ? TYPE_DARK : TYPE_LIGHT;
  return [
    { key: 'inc', label: 'Incidental (INC)', short: 'INC', color: c.inc, pattern: 'solid' },
    { key: 'pl', label: 'Planned (PL)', short: 'PL', color: c.pl, pattern: 'hatch' },
    { key: 'cir', label: 'CIR', short: 'CIR', color: c.cir, pattern: 'dots' },
  ];
}

const CLASS_LIGHT: Record<string, string> = { PRO: '#C2512A', MEC: '#7B5BB0', ELE: '#B8860B', AUT: '#C2407A' };
const CLASS_DARK: Record<string, string> = { PRO: '#E27A4E', MEC: '#A68BE0', ELE: '#E0B33C', AUT: '#E67AA8' };
const CLASS_PATTERN: Record<string, FillPattern> = { PRO: 'solid', MEC: 'stripes', ELE: 'grid', AUT: 'backhatch', PL: 'hatch', CIR: 'dots' };

/** One paint per classification (PRO, MEC, ELE, AUT incidental; PL and CIR share the type paints). */
export function classPaint(dark: boolean, code: string, name = code): Paint {
  if (code === 'PL' || code === 'CIR') {
    const p = typePaints(dark)[code === 'PL' ? 1 : 2]!;
    return { ...p, key: code, label: name, short: code };
  }
  const c = (dark ? CLASS_DARK : CLASS_LIGHT)[code] ?? 'var(--tk-text-muted)';
  return { key: code, label: name, short: code, color: c, pattern: CLASS_PATTERN[code] ?? 'solid' };
}
