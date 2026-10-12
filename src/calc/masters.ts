import type { Area, Equipment, EquipmentAlias, EquipmentArea, Reason } from '../api/types';
import { buildCodeLookup, buildReasonLookup, codeKey, type CodeLookup, type ReasonLookup } from './normalize';

/** The master tables the calculations read (a subset of Startup). */
export interface MasterData {
  areas: Area[];
  equipment: Equipment[];
  equipment_areas: EquipmentArea[];
  aliases: EquipmentAlias[];
  reasons: Reason[];
}

export interface MasterIndex extends CodeLookup {
  areaById: Map<string, Area>;
  /** codeKey(equipment_id) -> set of area_ids the code belongs to */
  areasOfEquipment: Map<string, Set<string>>;
  reasons: ReasonLookup;
}

/** Build lookups once and reuse them; the calc functions never cache anything themselves. */
export function buildIndex(master: MasterData): MasterIndex {
  const areasOfEquipment = new Map<string, Set<string>>();
  for (const ea of master.equipment_areas) {
    const k = codeKey(ea.equipment_id);
    const set = areasOfEquipment.get(k) ?? new Set<string>();
    set.add(ea.area_id);
    areasOfEquipment.set(k, set);
  }
  return {
    ...buildCodeLookup(master.aliases, master.equipment),
    areaById: new Map(master.areas.map((a) => [a.area_id, a])),
    areasOfEquipment,
    reasons: buildReasonLookup(master.reasons),
  };
}

/** Areas a canonical equipment code belongs to (empty set when none). */
export function areasOf(index: MasterIndex, equipmentId: string): ReadonlySet<string> {
  return index.areasOfEquipment.get(equipmentId) ?? index.areasOfEquipment.get(codeKey(equipmentId)) ?? EMPTY;
}

const EMPTY: ReadonlySet<string> = new Set<string>();
