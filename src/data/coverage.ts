// What the data covers, plant-wide over every year: one rule for every page that says so (the data status strip, the
// report builder and the report itself). The pages load only the years their period needs, so a coverage worked out
// from those rows would start at the first loaded year; this one reads the records of all years (ValidationContext).
import { useMemo } from 'react';
import type { EventRow } from '../api/types';
import { dataRangeOf, notUploadedMonths, type DateRange } from '../calc';
import { useValidationOptional } from '../validate/ValidationContext';

export interface PlantCoverage {
  coverage: DateRange | null;
  /** months inside the coverage with no record at all (P6) */
  gaps: string[];
}

/** Coverage and not-uploaded months of the records of all years. Pure. */
export function plantCoverage(rows: readonly EventRow[]): PlantCoverage {
  const coverage = dataRangeOf([...rows]);
  return { coverage, gaps: coverage ? notUploadedMonths([...rows], coverage) : [] };
}

/** The plant-wide coverage once the records of every year are loaded; null before that. */
export function usePlantCoverage(): PlantCoverage | null {
  const v = useValidationOptional();
  const rows = v?.ready ? v.rows : null;
  return useMemo(() => (rows ? plantCoverage(rows) : null), [rows]);
}
