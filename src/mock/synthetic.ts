// Synthetic data for the mock API: invented areas' equipment, reasons and
// downtime rows. Nothing here comes from the plant. Deterministic: the same
// seed always gives the same data (seeded PRNG), so tests can rely on it.
import tables from '../../schema/tables.json';
import type {
  Access, Area, Classification, ClassificationCode, Equipment, EquipmentAlias, EquipmentArea, EventEdit, EventRow,
  Line, Reason, Setting, TabId, UploadBatch, UploadWarning, WarningType,
} from '../api/types';
import { TAB_IDS } from '../api/types';
import { buildLookup, eventIdOf, fingerprintOf, isAreaLevelCode, matchKey, mergeFlags, resolveRow } from '../util/normalize';

import { DEMO_PASSWORD } from './demoAccounts';
export { DEMO_PASSWORD };
export const DEMO_TEMP_EMAIL = 'newhire@demo.test';
export const DEMO_TEMP_PASSWORD = 'Temp-Pass-1234';

export interface MockUser {
  user_id: string; email: string; display_name: string; role_id: string; password: string;
  must_change: boolean; active: boolean; failed_attempts: number; locked_until?: number;
  created_at: string; last_login_at?: string; overrides: Partial<Access>;
}
export interface AuditRow { at: string; user_id?: string; action: string; entity?: string; entity_id?: string; detail?: string }
export interface TabAccessRow { subject_type: 'role' | 'user'; subject_id: string; tab_id: TabId; level: string }
export interface RoleRow { role_id: string; name: string; description?: string }

export interface SyntheticDb {
  lines: Line[]; areas: Area[]; equipment: Equipment[]; equipment_areas: EquipmentArea[]; aliases: EquipmentAlias[];
  classifications: Classification[]; reasons: Reason[]; settings: Setting[];
  events: EventRow[]; event_edits: EventEdit[]; upload_batches: UploadBatch[]; upload_warnings: UploadWarning[];
  roles: RoleRow[]; users: MockUser[]; tab_access: TabAccessRow[]; audit_log: AuditRow[];
}

// ---------------------------------------------------------------- PRNG
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- time helpers
export function fmtTs(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').replace('Z', '');
}
export function fmtDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
const DAY = 86_400_000;

// ---------------------------------------------------------------- master data
const AREA_PREFIX: Record<string, string> = {
  CR: '111', 'RM.1': '121', 'K.1': '131', 'FM.1': '141', HD: '151', 'CM.1': '161', 'CM.2': '162', 'PK.1': '171', 'HY.1': '181',
  'RM.2': '221', 'K.2': '231', 'FM.2': '241', AFR: '251', 'AFR new': '252', SHR: '253', 'CM.3': '261', 'CM.4': '262', 'PK.2': '271', 'HY.2': '281',
};
const TYPES: [string, string, string][] = [
  ['BC', 'Belt conveyor', 'Conveyor'], ['FN', 'Fan', 'Fan'], ['MT', 'Main motor', 'Motor'], ['PM', 'Pump', 'Pump'],
  ['GB', 'Gearbox', 'Gearbox'], ['SC', 'Screw conveyor', 'Conveyor'], ['RF', 'Rotary feeder', 'Feeder'],
  ['VL', 'Valve', 'Valve'], ['HP', 'Hydraulic unit', 'Pump'], ['CP', 'Compressor', 'Compressor'],
];
const EQUIPMENT_PER_AREA: Record<string, number> = { PK_HY: 2 };

const REASON_TEXT: Record<ClassificationCode, string[]> = {
  PRO: ['Kiln feed interruption', 'Silo level low', 'Raw material shortage', 'Cooler overload', 'Process upset', 'Low demand', 'Quality adjustment', 'Coating ring cleaning', 'Preheater blockage', 'Operator stop'],
  MEC: ['Bearing failure', 'Belt misalignment', 'Belt torn', 'Gearbox oil leak', 'Chute blockage', 'Coupling damaged', 'Idler roller seized', 'Liner worn', 'Shaft broken', 'Fan imbalance', 'Pump seal leak', 'Chain slack', 'Bolts loose', 'Vibration high'],
  ELE: ['Motor overload trip', 'Motor winding failure', 'Cable fault', 'Breaker trip', 'Power dip', 'Sensor wiring fault', 'Contactor failure', 'Earth fault', 'Drive fault', 'Protection relay trip', 'Fuse blown', 'Limit switch fault'],
  AUT: ['PLC communication lost', 'Instrument calibration', 'Sensor signal lost', 'Control loop unstable', 'Network fault', 'Interlock fault', 'Analyser fault', 'Valve positioner fault'],
  PL: ['Planned shutdown', 'Preventive maintenance', 'Annual overhaul', 'Refractory repair', 'Scheduled inspection', 'Lubrication round', 'Liner change planned', 'Calibration planned'],
  CIR: ['Grid power failure', 'Heavy rain', 'Spare part delay', 'Waiting for permit', 'Fuel supply issue', 'Dust emission limit', 'Waiting for operator', 'Public holiday'],
};
// a few entries keep a leading or doubled space "as listed"
const MESSY_REASONS = new Set(['MEC:Bearing failure', 'ELE:Motor overload trip', 'PRO:Silo level low', 'AUT:Network fault']);

const CLASS_WEIGHT: [ClassificationCode, number][] = [['MEC', 30], ['ELE', 20], ['AUT', 10], ['PRO', 15], ['PL', 14], ['CIR', 11]];
const TABLES = tables as unknown as {
  settingsDefaults: { key: string; value: string; description?: string }[];
  roleSeeds: RoleRow[];
  tabAccessDefaults: Record<string, Record<TabId, string>>;
  classificationSeeds: Classification[];
  lineSeeds: Line[];
  areaSeeds: (Omit<Area, 'active'>)[];
};

export const GEN_START = '2025-08-12';
export const GEN_END = '2026-10-11';

export function buildSyntheticDb(seed = 20260101): SyntheticDb {
  const rnd = mulberry32(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
  const chance = (p: number) => rnd() < p;
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());

  const lines: Line[] = TABLES.lineSeeds.map((l) => ({ ...l }));
  const areas: Area[] = TABLES.areaSeeds.map((a) => ({ ...a, active: true }));
  const classifications: Classification[] = TABLES.classificationSeeds.map((c) => ({ ...c }));
  const settings: Setting[] = TABLES.settingsDefaults.map((s) => ({ ...s }));

  // ---- reasons (about 60)
  const reasons: Reason[] = [];
  for (const c of classifications) {
    REASON_TEXT[c.code].forEach((text, i) => {
      const messy = MESSY_REASONS.has(`${c.code}:${text}`);
      reasons.push({
        reason_id: `R-${c.code}-${String(i + 1).padStart(3, '0')}`,
        classification: c.code,
        text_as_listed: messy ? `  ${text}` : text,
        match_key: matchKey(text),
        order_no: i + 1,
        active: true,
      });
    });
  }

  // ---- equipment (about 150 codes) and area membership
  const equipment: Equipment[] = [];
  const equipment_areas: EquipmentArea[] = [];
  const byArea = new Map<string, string[]>();
  for (const a of areas) {
    const n = a.area_id === 'AFR new' ? 0 : a.in_downtime_sheet ? 10 : EQUIPMENT_PER_AREA.PK_HY;
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const [tc, tname, ttype] = TYPES[i % TYPES.length];
      const code = `${AREA_PREFIX[a.area_id]}.${tc}${(Math.floor(i / TYPES.length) + 1) * 100 + (i % TYPES.length) * 10}`;
      ids.push(code);
      equipment.push({
        equipment_id: code,
        description: i % 5 === 4 ? undefined : `${tname} ${i + 1} (${a.name})`,
        equipment_type: i % 3 === 2 ? undefined : ttype,
        criticality: i % 4 === 0 ? 'High' : i % 4 === 1 ? 'Medium' : undefined,
        status: code.endsWith('90') && i === 9 ? 'Retired' : 'Active',
        origin: 'Synthetic',
        needs_review: i % 5 === 4,
        review_note: i % 5 === 4 ? 'Description missing' : undefined,
      });
      equipment_areas.push({ equipment_id: code, area_id: a.area_id });
    }
    byArea.set(a.area_id, ids);
  }
  // codes that belong to two areas
  const shares: [string, string][] = [['CM.1', 'CM.2'], ['CM.3', 'CM.4'], ['RM.1', 'CR'], ['K.1', 'FM.1'], ['K.2', 'FM.2'], ['AFR', 'SHR'], ['CM.1', 'PK.1'], ['CM.3', 'PK.2']];
  shares.forEach(([from, to], i) => {
    const code = byArea.get(from)![i % 3];
    equipment_areas.push({ equipment_id: code, area_id: to });
    byArea.get(to)!.push(code);
  });
  // a few typo aliases
  const aliases: EquipmentAlias[] = [];
  for (const area of ['CR', 'K.1', 'CM.3', 'RM.2', 'SHR']) {
    const code = byArea.get(area)![1];
    aliases.push({ alias: code.replace('.', ''), equipment_id: code, reason: 'Missing dot in the sheet' });
  }

  // ---- demo users and access
  const roles = TABLES.roleSeeds.map((r) => ({ ...r }));
  const tab_access: TabAccessRow[] = [];
  for (const [role, levels] of Object.entries(TABLES.tabAccessDefaults)) {
    for (const t of TAB_IDS) tab_access.push({ subject_type: 'role', subject_id: role, tab_id: t, level: levels[t] });
  }
  const mk = (id: string, email: string, name: string, role: string, must = false, pw = DEMO_PASSWORD): MockUser => ({
    user_id: id, email, display_name: name, role_id: role, password: pw, must_change: must, active: true,
    failed_attempts: 0, created_at: '2025-08-01 08:00:00.000', overrides: {},
  });
  const users: MockUser[] = [
    mk('U-DEMO-ADMIN', 'admin@demo.test', 'Demo Admin', 'ROLE-ADMIN'),
    mk('U-DEMO-MGR', 'manager@demo.test', 'Demo Manager', 'ROLE-MGR'),
    mk('U-DEMO-ENG', 'engineer@demo.test', 'Demo Engineer', 'ROLE-ENG'),
    mk('U-DEMO-VIEW', 'viewer@demo.test', 'Demo Viewer', 'ROLE-VIEW'),
    mk('U-DEMO-NEW', DEMO_TEMP_EMAIL, 'Demo New Hire', 'ROLE-VIEW', true, DEMO_TEMP_PASSWORD),
  ];

  const look = buildLookup({ equipment, equipment_areas, aliases, reasons, areas });

  // ---- events
  interface RawRow {
    area_id: string; line_id: string; code_raw: string; stop: number; start: number; freq: 0 | 1;
    classification: ClassificationCode; reason_raw: string; description: string;
  }
  const raw: RawRow[] = [];
  const startMs = Date.parse(`${GEN_START}T00:00:00Z`);
  const endMs = Date.parse(`${GEN_END}T23:59:59Z`);
  const classPick = () => {
    let x = rnd() * CLASS_WEIGHT.reduce((n, [, w]) => n + w, 0);
    for (const [c, w] of CLASS_WEIGHT) { if ((x -= w) < 0) return c; }
    return 'MEC' as ClassificationCode;
  };
  const durationMin = (c: ClassificationCode): number => {
    const mu = c === 'PL' ? 5.0 : c === 'CIR' ? 4.2 : c === 'PRO' ? 3.4 : 3.1;
    const sd = c === 'PL' ? 0.7 : 1.0;
    return Math.min(60 * 30, Math.max(3, Math.exp(mu + sd * gauss())));
  };
  const reasonRaw = (c: ClassificationCode): string => {
    const text = pick(REASON_TEXT[c]);
    const r = rnd();
    if (r < 0.04) return `  ${text}  `;
    if (r < 0.07) return text.toLowerCase();
    if (r < 0.09) return text.replace(' ', '  ');
    return text;
  };
  const codeRaw = (area: string): string => {
    const own = byArea.get(area) ?? [];
    const r = rnd();
    if (r < 0.1 || own.length === 0) return 'N/A';
    let code: string;
    if (r < 0.11) code = pick(equipment).equipment_id; // sometimes a code listed under another area
    else code = pick(own);
    const v = rnd();
    if (v < 0.03) return code.toLowerCase();
    if (v < 0.05) return code.replace('.', '..');
    if (v < 0.07) return ` ${code} `;
    return code;
  };
  // rows may not cross midnight: a long stop is split into continuations
  const emit = (r: Omit<RawRow, 'stop' | 'start'> & { stop: number; start: number }) => {
    let stop = r.stop;
    let freq = r.freq;
    while (true) {
      const midnight = (Math.floor(stop / DAY) + 1) * DAY;
      if (r.start > midnight) {
        raw.push({ ...r, stop, start: midnight, freq });
        stop = midnight;
        freq = 0;
      } else {
        raw.push({ ...r, stop, start: r.start, freq });
        break;
      }
    }
  };
  const work = areas.filter((a) => a.in_downtime_sheet);
  for (const area of work) {
    const rate = area.area_id.startsWith('K.') ? 1.3 : area.area_id === 'AFR new' ? 0.06 : 0.5 + rnd() * 0.7;
    let t = startMs + Math.floor(rnd() * 6 * 3_600_000);
    while (t < endMs) {
      t += -Math.log(1 - rnd()) * (DAY / rate);
      if (t >= endMs) break;
      const c = classPick();
      const stop = Math.round(t / 1000) * 1000;
      const start = stop + Math.round(durationMin(c) * 60_000 / 1000) * 1000;
      const code = area.area_id === 'AFR new' ? (chance(0.5) ? 'AFR2' : 'N/A') : codeRaw(area.area_id);
      const base = {
        area_id: area.area_id, line_id: area.line_id, code_raw: code, classification: c, reason_raw: reasonRaw(c),
        description: chance(0.35) ? pick(['Found on night round', 'Reported by control room', 'Needed spare from store', 'Restarted after reset', 'Cleaned and restarted', 'Operator reported noise']) : '',
      };
      emit({ ...base, stop, start, freq: 1 });
      let last = start;
      // a follow-on row: waiting for a part or a second cause, same stop
      if ((c === 'MEC' || c === 'ELE' || c === 'AUT' || c === 'PRO') && chance(0.12)) {
        const c2: ClassificationCode = chance(0.5) ? 'CIR' : c;
        const stop2 = start;
        const start2 = stop2 + Math.round(durationMin(c2) * 60_000 / 1000) * 1000;
        emit({ ...base, classification: c2, reason_raw: reasonRaw(c2), description: '', stop: stop2, start: start2, freq: 0 });
        last = start2;
      }
      t = last;
    }
  }
  raw.sort((a, b) => (a.stop - b.stop) || a.area_id.localeCompare(b.area_id));

  // ---- data-quality cases (a small, fixed number of each)
  const eligible = raw.map((_, i) => i).filter((i) => raw[i].freq === 1 && raw[i].stop > startMs + 40 * DAY);
  const take = () => eligible.splice(Math.floor(rnd() * eligible.length), 1)[0];
  for (let i = 0; i < 6; i++) raw[take()].code_raw = pick(['999.ZZ900', '999.ZZ910', '888.QQ100']);
  for (let i = 0; i < 8; i++) raw[take()].reason_raw = pick(['Operator error see note', 'Unknown cause', 'Other', 'Checked and OK']);
  for (let i = 0; i < 5; i++) raw[take()].reason_raw = '';
  for (let i = 0; i < 3; i++) { const r = raw[take()]; const s = r.stop; r.stop = r.start; r.start = s; }
  const orphanIdx = [take(), take()];
  for (const i of orphanIdx) raw[i].freq = 0;
  const durationMismatch = new Set([take(), take()]);
  // two true overlaps within an area on one day
  const overlapRows = new Set<number>();
  for (let i = 1; i < raw.length && overlapRows.size < 2; i++) {
    const a = raw[i - 1], b = raw[i];
    if (a.area_id === b.area_id && a.freq === 1 && b.freq === 1 && fmtDate(a.stop) === fmtDate(b.start) && fmtDate(a.start) === fmtDate(b.stop)
      && a.stop > startMs + 60 * DAY && a.start - a.stop > 15 * 60_000 && b.stop - a.start < 3 * 3_600_000 && !overlapRows.has(i - 1)) {
      const newStop = a.start - 3 * 60_000;
      if (newStop <= a.stop || newStop >= b.start) continue;
      b.stop = newStop;
      overlapRows.add(i);
      i += 40;
    }
  }

  // ---- batches: one upload per month, cumulative workbook
  const monthOf = (ms: number) => fmtDate(ms).slice(0, 7);
  const months = [...new Set(raw.map((r) => monthOf(r.stop)))].sort();
  const batchOfMonth = new Map<string, string>();
  const batchTimes = new Map<string, string>();
  months.forEach((m, i) => {
    const [y, mo] = m.split('-').map(Number);
    const next = Date.UTC(y, mo, 2 + (i % 3), 7 + (i % 4), 15 + i, 0);
    const upAt = Math.min(next, Date.parse('2026-10-12T07:30:00Z'));
    const stamp = fmtTs(upAt);
    const id = `B-${stamp.slice(0, 10).replace(/-/g, '')}-${stamp.slice(11, 19).replace(/:/g, '')}-${(0x1000 + i * 37).toString(16)}`;
    batchOfMonth.set(m, id);
    batchTimes.set(id, stamp);
  });

  const events: EventRow[] = [];
  const seen = new Map<string, number>();
  const rowInYear = new Map<number, number>();
  raw.forEach((r, idx) => {
    const stop_ts = fmtTs(r.stop), start_ts = fmtTs(r.start);
    const key = `${r.area_id}|${r.code_raw}|${stop_ts}|${start_ts}`;
    const occ = (seen.get(key) ?? 0) + 1;
    seen.set(key, occ);
    const fingerprint = fingerprintOf(r.area_id, r.code_raw, stop_ts, start_ts, occ);
    const res = resolveRow(look, { area_id: r.area_id, code_raw: r.code_raw, classification: r.classification, reason_raw: r.reason_raw, stop_ts, start_ts });
    const flags = [...res.flags];
    if (orphanIdx.includes(idx)) flags.push('orphan_continuation');
    if (overlapRows.has(idx)) flags.push('overlap_in_area');
    if (durationMismatch.has(idx)) flags.push('duration_mismatch');
    const crit = r.classification === 'PL' || r.classification === 'CIR' ? 'NO_INC' : 'INC';
    const year = new Date(r.stop).getUTCFullYear();
    const srow = (rowInYear.get(year) ?? 5) + 1;
    rowInYear.set(year, srow);
    events.push({
      event_id: eventIdOf(fingerprint),
      batch_id: batchOfMonth.get(monthOf(r.stop))!,
      event_date: fmtDate(r.stop),
      line_id: r.line_id,
      area_id: r.area_id,
      code_raw: r.code_raw,
      equipment_id: res.equipment_id,
      is_area_level: res.is_area_level,
      stop_ts, start_ts,
      duration_s: (r.start - r.stop) / 1000,
      freq: r.freq,
      classification: r.classification,
      criticality: crit,
      is_failure: crit === 'INC' && r.freq === 1,
      reason_raw: r.reason_raw || undefined,
      reason_id: res.reason_id,
      description: r.description || undefined,
      source_file: `Downtime-${year}-synthetic.xlsx`,
      source_row: srow,
      fingerprint,
      flags: flags.join(',') || undefined,
      edited: false,
      is_void: false,
      created_at: batchTimes.get(batchOfMonth.get(monthOf(r.stop))!)!,
    });
  });

  // ---- batch history and warnings
  const upload_batches: UploadBatch[] = [];
  const upload_warnings: UploadWarning[] = [];
  const cumulative = new Map<number, number>();
  const WARN_TYPES: WarningType[] = ['unknown_code', 'code_not_in_area', 'unlisted_reason', 'blank_reason', 'end_before_start', 'orphan_continuation', 'overlap_in_area', 'placeholder_code', 'duration_mismatch'];
  const detailOf: Record<string, string> = {
    unknown_code: 'The equipment code is not in the equipment list.',
    code_not_in_area: 'The equipment code is not listed under this area.',
    unlisted_reason: 'The reason is not in the reason list for this classification.',
    blank_reason: 'The reason is blank.',
    end_before_start: 'The restart time is earlier than the stop time.',
    orphan_continuation: 'This row continues a stop, but no starting row was found.',
    overlap_in_area: 'This stop overlaps another stop in the same area.',
    placeholder_code: 'The equipment code is a placeholder.',
    duration_mismatch: 'The duration differs from the sheet total.',
  };
  months.forEach((m) => {
    const id = batchOfMonth.get(m)!;
    const rows = events.filter((e) => e.batch_id === id);
    const year = Number(m.slice(0, 4));
    const before = cumulative.get(year) ?? 0;
    cumulative.set(year, before + rows.length);
    let wn = 0;
    for (const e of rows) {
      for (const f of String(e.flags ?? '').split(',').filter(Boolean)) {
        if (!WARN_TYPES.includes(f as WarningType)) continue;
        wn++;
        upload_warnings.push({
          warning_id: `W-${id}-${wn}`, batch_id: id, type: f as WarningType, source_row: e.source_row, event_id: e.event_id,
          detail: `${detailOf[f]} (${e.area_id}, ${e.code_raw || 'no code'}, ${e.event_date})`, resolution: 'accepted', resolved_by: 'U-DEMO-ENG',
        });
      }
    }
    upload_batches.push({
      batch_id: id, uploaded_by: 'U-DEMO-ENG', uploaded_at: batchTimes.get(id)!, file_name: `Downtime-${year}-synthetic.xlsx`,
      file_hash: id.slice(-8).padStart(64, '0'), rows_read: before + rows.length, rows_added: rows.length, rows_identical: before,
      rows_skipped: 0, warning_count: wn, status: 'Completed',
    });
  });
  upload_batches.reverse();

  return {
    lines, areas, equipment, equipment_areas, aliases, classifications, reasons, settings, events,
    event_edits: [], upload_batches, upload_warnings, roles, users, tab_access, audit_log: [],
  };
}

export { isAreaLevelCode, mergeFlags };
