/** Small synthetic fixtures for tests and demos. No real plant data. */
import type { Area, ClassificationCode, Equipment, EquipmentAlias, EquipmentArea, EventRow, Reason } from '../api/types';
import { buildIndex, type MasterData, type MasterIndex } from './masters';
import { codeKey, isAreaLevelCode, matchKey } from './normalize';
import { formatTs, parseTs } from './time';

/** 'YYYY-MM-DD HH:MM' or 'YYYY-MM-DD HH:MM:SS' to the full 'YYYY-MM-DD HH:MM:SS.mmm' form. */
export function ts(text: string): string {
  if (text.length === 16) return `${text}:00.000`;
  if (text.length === 19) return `${text}.000`;
  return text;
}

export interface RowSpec {
  area?: string;
  /** equipment code as written; default '100.A1' */
  code?: string;
  stop: string;
  start: string;
  freq?: 0 | 1;
  cls?: ClassificationCode;
  reason?: string;
  /** default: Freq = 1 and an incident classification */
  failure?: boolean;
  /** resolved equipment id; default the code key. Pass null for an unknown code. */
  eq?: string | null;
  isVoid?: boolean;
  edited?: boolean;
  line?: string;
  description?: string;
  id?: string;
  sourceRow?: number;
}

/** Build rows with unique ids; the counter lives in the closure, not in module state. */
export function createRowFactory(prefix = 'T'): (spec: RowSpec) => EventRow {
  let n = 0;
  return (s) => {
    n++;
    const cls = s.cls ?? 'MEC';
    const freq = s.freq ?? 1;
    const incident = cls !== 'PL' && cls !== 'CIR';
    const code = s.code ?? '100.A1';
    const stop = ts(s.stop);
    const start = ts(s.start);
    const dur = ((parseTs(start) ?? 0) - (parseTs(stop) ?? 0)) / 1000;
    const area = s.area ?? 'K.1';
    const id = s.id ?? `${prefix}${String(n).padStart(5, '0')}`;
    return {
      event_id: id, batch_id: 'B-TEST', event_date: stop.slice(0, 10), line_id: s.line ?? (area.endsWith('.2') ? 'L.2' : 'L.1'), area_id: area,
      code_raw: code, equipment_id: s.eq === null ? undefined : s.eq ?? (isAreaLevelCode(code) ? undefined : codeKey(code)),
      is_area_level: isAreaLevelCode(code), stop_ts: stop, start_ts: start, duration_s: dur, freq,
      classification: cls, criticality: incident ? 'INC' : 'NO_INC', is_failure: s.failure ?? (freq === 1 && incident),
      reason_raw: s.reason, description: s.description, source_row: s.sourceRow ?? n + 1, fingerprint: `fp-${id}`,
      edited: s.edited ?? false, is_void: s.isVoid ?? false, created_at: '2026-01-01 00:00:00.000',
    };
  };
}

const AREAS: [string, string][] = [['K.1', 'L.1'], ['RM.1', 'L.1'], ['CM.1', 'L.1'], ['K.2', 'L.2']];

export function fixtureMasterData(): MasterData {
  const areas: Area[] = AREAS.map(([area_id, line_id], i) => ({ area_id, name: area_id, line_id, sort_order: i + 1, active: true, in_downtime_sheet: true }));
  const eq = (equipment_id: string, equipment_type?: string, criticality?: string): Equipment => ({
    equipment_id, description: equipment_id, equipment_type, criticality, status: 'Active', needs_review: false,
  });
  const equipment: Equipment[] = [
    eq('100.A1', 'Fan', 'High'), eq('100.A2', 'Motor'), eq('200.B1', 'Fan'), eq('300.C1', 'Pump'), eq('400.D1', 'Gearbox'),
  ];
  const ea = (equipment_id: string, area_id: string): EquipmentArea => ({ equipment_id, area_id });
  // 100.A2 belongs to two areas (K.1 and RM.1); 400.D1 belongs to no area
  const equipment_areas = [ea('100.A1', 'K.1'), ea('100.A2', 'K.1'), ea('100.A2', 'RM.1'), ea('200.B1', 'RM.1'), ea('300.C1', 'CM.1')];
  const aliases: EquipmentAlias[] = [{ alias: '100.AA1', equipment_id: '100.A1', reason: 'typo' }];
  const r = (classification: ClassificationCode, text: string, order_no: number): Reason => ({
    reason_id: `R-${classification}-${String(order_no).padStart(3, '0')}`, classification, text_as_listed: text, match_key: matchKey(text), order_no, active: true,
  });
  const reasons = [
    r('MEC', 'Bearing failure', 1), r('MEC', 'Belt slip', 2), r('MEC', 'Other', 3), r('ELE', 'Motor trip', 1), r('ELE', 'Other', 2),
    r('PL', 'Scheduled maintenance', 1), r('CIR', 'Power cut', 1),
  ];
  return { areas, equipment, equipment_areas, aliases, reasons };
}

export function fixtureIndex(): MasterIndex {
  return buildIndex(fixtureMasterData());
}

/** A generator of a year of plausible synthetic events (about `n` rows) for the performance test. Deterministic. */
export function syntheticYear(year: number, n: number): EventRow[] {
  const make = createRowFactory('S');
  const areas = ['K.1', 'RM.1', 'CM.1', 'K.2'];
  const codes = ['100.A1', '100.A2', '200.B1', '300.C1', '400.D1'];
  const reasons = ['Bearing failure', 'Belt slip', 'Other', 'Motor trip'];
  const classes: ClassificationCode[] = ['MEC', 'ELE', 'PRO', 'AUT', 'PL', 'CIR'];
  const rows: EventRow[] = [];
  let seed = 12345;
  const rnd = (): number => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const yearMs = Date.UTC(year, 0, 1);
  const span = 364 * 86_400_000;
  for (let i = 0; i < n; i++) {
    const stopMs = yearMs + Math.floor(rnd() * span);
    const durMin = 1 + Math.floor(rnd() * 90);
    const cls = classes[Math.floor(rnd() * classes.length)]!;
    const stop = formatTs(stopMs);
    const start = formatTs(stopMs + durMin * 60_000);
    rows.push(make({
      area: areas[Math.floor(rnd() * areas.length)], code: codes[Math.floor(rnd() * codes.length)],
      stop, start, cls, reason: reasons[Math.floor(rnd() * reasons.length)], freq: rnd() < 0.1 ? 0 : 1,
    }));
  }
  return rows;
}
