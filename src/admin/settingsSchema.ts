// The settings the app lets an administrator change: what each one means, its
// allowed range (the same ranges the server enforces) and when it takes effect.
import { t } from '../i18n/t';

export type When = 'now' | 'signin' | 'password' | 'checks' | 'mail';

/** `fallback`: the value the server uses while the database has no row for the key (databases made before the key existed). */
export interface NumberField { key: string; kind: 'int' | 'number_or_blank'; min: number; max: number; label: string; help: string; unit?: string; fallback?: string }
export interface ChoiceField { key: string; kind: 'choice'; label: string; help: string; options: { value: string; label: string; detail?: string }[]; fallback?: string }
/**
 * Free text; blank is allowed. `format` url (default): the app's web address; ids: comma-separated user ids (who can close
 * actions); email: one email address (backend 1.9.0); plain: any one-line text.
 */
export interface TextField { key: string; kind: 'text'; maxLength: number; label: string; help: string; placeholder?: string; fallback?: string; format?: 'url' | 'ids' | 'email' | 'plain' }
export type Field = NumberField | ChoiceField | TextField;

export interface Group { id: string; title: string; icon: string; when: When; intro: string; fields: Field[] }

export const WHEN_TEXT: Record<When, { badge: string; detail: string }> = {
  now: { badge: 'Applies right away', detail: 'The dashboards recalculate as soon as this is saved.' },
  signin: { badge: 'Applies to new sign-ins', detail: 'People who are already signed in keep their current session.' },
  password: { badge: 'Applies from the next password change', detail: 'Existing passwords stay valid.' },
  mail: { badge: 'Applies to the next email', detail: 'Emails already sent stay as they are.' },
  checks: { badge: 'Applies at the next check', detail: 'Alerts already raised stay until they resolve or expire. Use "Run checks now" to apply it straight away.' },
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
      id: 'targets', title: t('Targets'), icon: 'limits', when: 'now',
      intro: t('Goals for availability, the reliability and utilization factors, MTBF and MTTR. Targets of single areas are under Actions & targets. Leave a box blank for no target. The dashboards show each target that is set, with whether the figure is on target.'),
      fields: [
        { key: 'availability_target_pct', kind: 'number_or_blank', min: 0, max: 100, label: t('Availability target'), unit: '%', help: t('The line drawn on availability charts and the goal each figure is checked against. From 0 to 100, or blank.') },
        { key: 'reliability_target_pct', kind: 'number_or_blank', min: 0, max: 100, label: t('Reliability factor (RF) target'), unit: '%', fallback: '95', help: t('The line drawn on reliability factor charts and the goal the RF card is checked against. From 0 to 100, or blank. Until it is saved the app uses 95 %.') },
        { key: 'utilization_target_pct', kind: 'number_or_blank', min: 0, max: 100, label: t('Utilization factor (UF) target'), unit: '%', fallback: '', help: t('The goal the UF card and charts are checked against. From 0 to 100, or blank for no target.') },
        { key: 'target_mtbf_h', kind: 'number_or_blank', min: 0.01, max: 100000, label: t('Target MTBF'), unit: t('hours'), fallback: '', help: t('Mean time between failures you aim for: more than 0, up to 100,000 hours, or blank.') },
        { key: 'target_mttr_h', kind: 'number_or_blank', min: 0.01, max: 100000, label: t('Target MTTR'), unit: t('hours'), fallback: '', help: t('Mean time to repair you aim for: more than 0, up to 100,000 hours, or blank.') },
      ],
    },
    {
      id: 'alert-rules', title: t('Alert rules'), icon: 'bell', when: 'checks',
      intro: t('When the system raises an alert or an update for everyone who follows the area. Checks run after every upload and once a day.'),
      fields: [
        { key: 'notif_long_stop_hours', kind: 'int', min: 1, max: 720, label: t('Long stop: more than'), unit: t('hours'), fallback: '8', help: t('A failure event that lasts longer than this raises an alert (1 to 720 whole hours).') },
        { key: 'notif_spike_pct', kind: 'int', min: 1, max: 1000, label: t('Failure spike: rise above'), unit: '%', fallback: '30', help: t('Failures of the last 30 days against the 30 days before, per area. At least 5 failures are needed now.') },
        { key: 'notif_upload_gap_days', kind: 'int', min: 1, max: 3650, label: t('No upload for'), unit: t('days'), fallback: '35', help: t('The newest stored event is older than this many days.') },
        {
          key: 'notif_repeat_alert', kind: 'choice', label: t('Repeated-failure alerts'), fallback: 'true', help: t('Raise an alert when a new repeated-failure group appears.'),
          options: [
            { value: 'true', label: t('On') },
            { value: 'false', label: t('Off') },
          ],
        },
        { key: 'notif_retention_days', kind: 'int', min: 1, max: 3650, label: t('Keep alerts and updates for'), unit: t('days'), fallback: '30', help: t('After this many days they expire and disappear.') },
        { key: 'app_url', kind: 'text', maxLength: 300, label: t('App web address'), placeholder: 'https://', fallback: '', help: t('Used for the link in digest emails. Leave blank for no link.') },
      ],
    },
    {
      // Shown in Settings > Notifications for administrators (backend 1.9.0, backend/apps-script/Mail.js)
      id: 'email', title: t('Email sender'), icon: 'mail', when: 'mail',
      intro: t('The address the app sends its emails from: digests, reports and actions reports. Blank: the Google account that runs the app sends them.'),
      fields: [
        { key: 'system_email', kind: 'text', format: 'email', maxLength: 254, label: t('System email'), placeholder: 'downtime@arabiancement.com', fallback: '', help: t('Must be a "Send mail as" address of the Google account that runs the app (see the steps below). Leave blank to send from that account.') },
        { key: 'system_email_name', kind: 'text', format: 'plain', maxLength: 80, label: t('Sender name'), placeholder: 'ACC Downtime Analysis', fallback: 'ACC Downtime Analysis', help: t('The name people see as the sender.') },
      ],
    },
    {
      // Shown by the Settings > Actions & targets page (backend 1.4.0); the closers list is edited there with a people picker.
      id: 'action-rules', title: t('Action rules'), icon: 'compliance', when: 'checks',
      intro: t('When the system drafts an action for review, and how long a closed action is watched.'),
      fields: [
        {
          key: 'actions_auto_draft', kind: 'choice', label: t('Draft actions automatically'), fallback: 'true', help: t('The rules below create Draft actions for review.'),
          options: [
            { value: 'true', label: t('On') },
            { value: 'false', label: t('Off') },
          ],
        },
        { key: 'actions_repeat_n', kind: 'int', min: 2, max: 100, label: t('Repeated failure: at least'), unit: t('failures'), fallback: '3', help: t('The same equipment and reason fails this many times ...') },
        { key: 'actions_repeat_days', kind: 'int', min: 1, max: 3650, label: t('Repeated failure: within'), unit: t('days'), fallback: '30', help: t('... within this many days.') },
        { key: 'actions_chronic_top', kind: 'int', min: 1, max: 100, label: t('Chronic equipment: in the top'), unit: t('equipment'), fallback: '10', help: t('Equipment among the most failure hours of a month ...') },
        { key: 'actions_chronic_months', kind: 'int', min: 1, max: 24, label: t('Chronic equipment: for'), unit: t('months in a row'), fallback: '3', help: t('... for this many complete months in a row.') },
        { key: 'actions_effect_days', kind: 'int', min: 1, max: 3650, label: t('Effectiveness watch'), unit: t('days'), fallback: '60', help: t('After closing, failures of this many days are compared with the same number of days before.') },
        { key: 'actions_closers', kind: 'text', format: 'ids', maxLength: 2000, label: t('Who can close actions'), fallback: '', help: t('User ids, separated by commas. Administrators can always close.') },
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

/** The values the server uses for keys the database has no row for yet. */
export const SETTING_FALLBACKS: Record<string, string> = Object.fromEntries(
  groups().flatMap((g) => g.fields.filter((f) => f.fallback !== undefined).map((f) => [f.key, f.fallback as string])),
);

/** Plain-English problems by setting key; an empty object means every value is fine. */
export function validateSettings(values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const g of groups()) {
    for (const f of g.fields) {
      const raw = (values[f.key] ?? '').trim();
      if (f.kind === 'text') {
        if (raw.length > f.maxLength) out[f.key] = t('Use at most {n} characters.', { n: f.maxLength });
        else if (f.format === 'ids') { if (raw !== '' && !/^[^,\s][^,]*(,[^,]*)*$/.test(raw)) out[f.key] = t('Write user ids separated by commas.'); }
        else if (f.format === 'email') { if (raw !== '' && !/^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(raw)) out[f.key] = t('Write one email address, like name@company.com.'); }
        else if (f.format === 'plain') { if (/[<>"]/.test(raw)) out[f.key] = t('Do not use < > or quotes.'); }
        else if (raw !== '' && !/^https?:\/\/[^\s"'<>]+$/i.test(raw)) out[f.key] = t('Write a web address that starts with http:// or https://, with no spaces or quotes.');
        continue;
      }
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
