// Phrase table. Every visible string goes through t() so another language
// can be added later without touching the screens. English only for now: the
// English phrase is its own key, so an empty table returns the text as written.
//
//   t('Sign in')                      -> 'Sign in'
//   t('{n} events', { n: 12 })        -> '12 events'
//
// To add Arabic: fill TABLES.ar with { 'Sign in': '...' } and call setLang('ar').
export type Lang = 'en';
const TABLES: Record<string, Record<string, string>> = {
  en: {},
};

let lang: string = 'en';

export function setLang(next: string): void {
  if (TABLES[next]) lang = next;
}
export function getLang(): string {
  return lang;
}

export function t(phrase: string, vars?: Record<string, string | number>): string {
  const base = TABLES[lang]?.[phrase] ?? phrase;
  if (!vars) return base;
  return base.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** "1 event" / "2 events": picks the singular or plural phrase, then fills {n}. */
export function tn(n: number, one: string, many: string): string {
  return t(n === 1 ? one : many, { n: n.toLocaleString('en-GB') });
}
