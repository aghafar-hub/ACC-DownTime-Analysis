// "Cause in another area": the stop is logged under the stopped area (EQUIPMENT column) with the code of the
// cause, and that code is listed in Master Data under other area(s). A normal, intended case (e.g. a raw mill
// stops because of equipment in CR), so it is shown as information and never as a problem.
import type { EquipmentArea, EventRow } from '../../api/types';
import { t } from '../../i18n/t';

export type OwnerLookup = (equipmentId: string | undefined) => string[];

/** equipment_id -> the areas it is listed under (sorted), built once from the master equipment_areas. */
export function buildOwnerLookup(equipmentAreas: readonly Pick<EquipmentArea, 'equipment_id' | 'area_id'>[] | undefined): OwnerLookup {
  const m = new Map<string, string[]>();
  for (const ea of equipmentAreas ?? []) {
    const l = m.get(ea.equipment_id) ?? [];
    if (!l.includes(ea.area_id)) l.push(ea.area_id);
    m.set(ea.equipment_id, l);
  }
  for (const l of m.values()) l.sort();
  return (id) => (id ? (m.get(id) ?? []) : []);
}

/** The owner areas of the cause of a stop, other than the stopped area itself. */
export const ownersOfRow = (row: Pick<EventRow, 'equipment_id' | 'area_id'>, owners: OwnerLookup | undefined): string[] =>
  (owners ? owners(row.equipment_id) : []).filter((a) => a !== row.area_id);

/** 'Cause in CR' / 'Cause in CR, FM.1'; without a master match just 'Cause in another area'. */
export const causeChipLabel = (owners: readonly string[]): string =>
  owners.length ? t('Cause in {areas}', { areas: owners.join(', ') }) : t('Cause in another area');

/** The note shown in the event detail (view mode). */
export function causeNote(areaId: string, owners: readonly string[]): string {
  return t(
    'This code is listed under {owners}, not under {area}. The stop counts for {area} as stopped by another area (not {area}\'s own equipment). Nothing to fix.',
    { owners: owners.length ? owners.join(', ') : t('another area'), area: areaId },
  );
}
