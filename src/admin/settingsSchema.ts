// The settings the app lets an administrator change: what each one means, its
// allowed range (the same ranges the server enforces) and when it takes effect.
import { t } from '../i18n/t';

export type When = 'now' | 'signin' | 'password';

export interface NumberField { key: string; kind: 'int' | 'number_or_blank'; min: number; max: number; label: string; help: string; unit?: string }
export interface ChoiceField { key: string; kind: 'choice'; label: string; help: string; options: { value: string; label: string; detail?: string }[] }
export type Field = NumberField | ChoiceField;

export interface Group { id: string; title: string; icon: string; when: When; intro: string; fields: Field[] }

export const WHEN_TEXT: Record<When, { badge: string; detail: string }> = {
  now: { badge: 'Applies right away', detail: 'The dashboards recalculate as soon as this is saved.' },
  signin: { badge: 'Applies to new sign-ins', detail: 'People who are already signed in keep their current session.' },
  password: { badge: 'Applies from the next password change', detail: 'Existing passwords stay valid.' },
};

export const BASIS_FORMULA: Record<string, string> = {
  A: 'Availability = (scheduled hours − all stop hours) ÷ scheduled hours',
  B: 'Availability = (scheduled hours − planned − incident − circumstantial) ÷ (scheduled hours − planned)',
  C: 'Availability = (scheduled hours − planned − circumstantial − incident) ÷ (scheduled hours − planned − circumstantial)',
};

export function groups(): Group[] {
  return [
    {
      id: 'availability', title: t('Availability'), icon: 'trend', when: 'now',
      intro: t('How the dashboards turn stop hours into availability.'),
      fields: [
        {
          key: 'availability_basis', kind: 'choice', label: t('Availability basis'), help: t('Which stops count against availability. B is the headline.'),
          options: [
            { value: 'A', label: t('A · calendar'), detail: t(BASIS_FORMULA.A as string) },
            { value: 'B', label: t('B · calendar minus planned (headline)'), detail: t(BASIS_FORMULA.B as string) },
            { value: 'C', label: t('C · minus planned and circumstantial'), detail: t(BASIS_FORMULA.C as string) },
          ],
        },
        { key: 'scheduled_hours_per_day', kind: 'int', min: 1, max: 24, label: t('Scheduled hours per day'), unit: t('hours'), help: t('Hours each area is expected to run in a scheduled day (1 to 24).') },
        { key: 'scheduled_days_per_week', kind: 'int', min: 1, max: 7, label: t('Scheduled days per week'), unit: t('days'), help: t('Days each area is expected to run in a week (1 to 7). With 6, the seventh day of each week is not scheduled.') },
        { key: 'availability_target_pct', kind: 'number_or_blank', min: 0, max: 100, label: t('Availability target'), unit: '%', help: t('The line drawn on availability charts. Leave blank for no target.') },
        {
          key: 'default_comparison', kind: 'choice', label: t('Default comparison'), help: t('What the dashboards compare a period with when you open them.'),
          options: [
            { value: 'previous_period', label: t('Previous period') },
            { value: 'same_period_last_year', label: t('Same period last year') },
          ],
        },
      ],
    },
    {
      id: 'rules', title: t('Repeated failures and durations'), icon: 'repeat', when: 'now',
      intro: t('When a failure counts as repeated, and what counts as a short or long stop.'),
      fields: [
        { key: 'repeat_min_events', kind: 'int', min: 2, max: 100, label: t('Failures needed to call it repeated'), unit: t('events'), help: t('The same equipment and reason must fail at least this many times (2 or more).') },
        { key: 'repeat_window_days', kind: 'int', min: 1, max: 3650, label: t('Repeat window'), unit: t('days'), help: t('Those failures must fall within this many days of each other.') },
        { key: 'duration_short_max_min', kind: 'int', min: 1, max: 10000, label: t('Short stop: up to'), unit: t('minutes'), help: t('Stops of this length or less are "Short".') },
        { key: 'duration_long_min_min', kind: 'int', min: 1, max: 100000, label: t('Long stop: from'), unit: t('minutes'), help: t('Stops of this length or more are "Long". It must be more than the short limit.') },
      ],
    },
    {
      id: 'signin', title: t('Sign-in rules'), icon: 'shield', when: 'signin',
      intro: t('How long sessions last and when an account is locked.'),
      fields: [
        { key: 'session_hours', kind: 'int', min: 1, max: 168, label: t('Session length'), unit: t('hours'), help: t('Without "Keep me signed in" (1 to 168).') },
        { key: 'session_hours_keep', kind: 'int', min: 1, max: 8760, label: t('Session length when kept signed in'), unit: t('hours'), help: t('With "Keep me signed in" (up to 8,760, one year).') },
        { key: 'lockout_attempts', kind: 'int', min: 1, max: 100, label: t('Wrong passwords before a lock'), unit: t('attempts'), help: t('After this many wrong passwords in a row the account is locked for a while.') },
        { key: 'lockout_minutes', kind: 'int', min: 1, max: 1440, label: t('Lock time'), unit: t('minutes'), help: t('How long a locked account must wait (up to 1,440, one day).') },
        { key: 'min_password_length', kind: 'int', min: 8, max: 128, label: t('Minimum password length'), unit: t('characters'), help: t('Applies when someone chooses a new password (8 or more).') },
      ],
    },
  ];
}

export const SETTING_KEYS: string[] = groups().flatMap((g) => g.fields.map((f) => f.key));

/** Plain-English problems by setting key; an empty object means every value is fine. */
export function validateSettings(values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const g of groups()) {
    for (const f of g.fields) {
      const raw = (values[f.key] ?? '').trim();
      if (f.kind === 'choice') {
        if (!f.options.some((o) => o.value === raw)) out[f.key] = t('Choose one of the options.');
        continue;
      }
      if (f.kind === 'number_or_blank' && raw === '') continue;
      const n = Number(raw);
      if (raw === '' || !Number.isFinite(n)) out[f.key] = t('Write a number.');
      else if (f.kind === 'int' && !Number.isInteger(n)) out[f.key] = t('Use a whole number.');
      else if (n < f.min || n > f.max) out[f.key] = t('Use a number from {min} to {max}.', { min: f.min.toLocaleString('en-GB'), max: f.max.toLocaleString('en-GB') });
    }
  }
  const s = Number(values.duration_short_max_min), l = Number(values.duration_long_min_min);
  if (!out.duration_short_max_min && !out.duration_long_min_min && s >= l) out.duration_long_min_min = t('The long limit must be more than the short limit ({s} minutes).', { s });
  return out;
}

/** Only the settings that differ from what is stored, as text (what saveSettings takes). */
export function changedSettings(stored: Record<string, string>, values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of SETTING_KEYS) {
    const v = (values[k] ?? '').trim();
    if (v !== (stored[k] ?? '').trim()) out[k] = v;
  }
  return out;
}
