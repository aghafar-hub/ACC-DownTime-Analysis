/** A number that may be unavailable. Unavailable is never shown as 0 or Infinity. */
export type UnavailableCode =
  | 'no_data' | 'no_failures' | 'no_exposure' | 'no_scheduled_time' | 'no_master' | 'no_comparison' | 'not_applicable';

export interface Available { available: true; value: number }
export interface Unavailable { available: false; code: UnavailableCode; reason: string }
export type Metric = Available | Unavailable;

export function avail(value: number): Available {
  return { available: true, value };
}

export function unavail(code: UnavailableCode, reason: string): Unavailable {
  return { available: false, code, reason };
}

/** value of an available metric, otherwise null. */
export function valueOf(m: Metric): number | null {
  return m.available ? m.value : null;
}

/** numerator / denominator, unavailable when the denominator is not strictly positive. */
export function ratio(numerator: number, denominator: number, code: UnavailableCode, reason: string): Metric {
  if (!(denominator > 0) || !Number.isFinite(denominator) || !Number.isFinite(numerator)) return unavail(code, reason);
  return avail(numerator / denominator);
}
