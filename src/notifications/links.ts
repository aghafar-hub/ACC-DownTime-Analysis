// Where each notification's ONE primary button goes: the page that fixes it or shows it, with the filters already
// applied (area, dates, the event itself). Pure: the caller says what the person may open.
import type { Notification, TabId } from '../api/types';
import { t } from '../i18n/t';
import type { NotifLink } from './model';

export interface LinkEnv {
  canView: (tab: TabId) => boolean;
  /** years the app has data for (the Explorer loads these for a drill) */
  years: number[];
  /** year an event is stored under, when it is loaded */
  yearOfEvent?: (eventId: string) => number | undefined;
}

export interface Target { link: NotifLink | null; label: string }

const qs = (pairs: [string, string][]): string => {
  const sp = new URLSearchParams();
  for (const [k, v] of pairs) if (v) sp.append(k, v);
  const s = sp.toString();
  return s ? `?${s}` : '';
};

/** The part of a dedupe key after the type, split on '|'. */
const keyParts = (n: Pick<Notification, 'dedupe_key'>): string[] => n.dedupe_key.split('|');

export function storedTarget(n: Notification, env: LinkEnv): Target {
  const area = n.area_id ?? '';
  switch (n.type) {
    case 'long_stop': {
      const label = t('Open event');
      if (!env.canView('events')) return { link: null, label };
      const id = n.source_ref ?? '';
      if (!id) return { link: { to: '/events' }, label };
      const y = env.yearOfEvent?.(id);
      return {
        link: { to: '/events', state: { drill: { label: n.title, eventIds: [id], years: y ? [y] : env.years, source: t('Notification') } } },
        label,
      };
    }
    case 'repeat_group':
      return { link: env.canView('repeats') ? { to: `/repeats${qs([['area', area]])}` } : null, label: t('See repeats') };
    case 'failure_spike':
      return { link: env.canView('pareto') ? { to: `/pareto${qs([['area', area], ['r', 'last30']])}` } : null, label: t('See causes') };
    case 'availability_low': {
      const month = /^\d{4}-\d{2}$/.test(keyParts(n)[2] ?? '') ? keyParts(n)[2]! : '';
      return {
        link: env.canView('reliability') ? { to: `/reliability${qs([['area', area], ...(month ? ([['r', 'month'], ['m', month]] as [string, string][]) : [])])}` } : null,
        label: t('See reliability'),
      };
    }
    case 'upload_gap':
    case 'upload_done':
      return { link: env.canView('upload') ? { to: '/upload' } : null, label: t('Open Upload') };
    case 'user_event':
      return { link: env.canView('users') ? { to: '/settings/users' } : null, label: t('Open users') };
    case 'action_due':
    case 'task_overdue': // backend 1.7.0: source_ref is the action; the task is in the key task_due|<task_id>|<due>
    case 'action_ready_to_close': {
      const id = n.source_ref || keyParts(n)[1] || '';
      return { link: env.canView('actions') ? { to: id ? `/actions${qs([['id', id]])}` : '/actions' } : null, label: id ? t('Open action {id}', { id }) : t('Open Actions') };
    }
    case 'planned_overrun':
      // the Dashboard's "Planned hours against the allowance" card for the area
      return { link: env.canView('overview') ? { to: `/dashboard${qs([['area', area]])}` } : null, label: t('See planned hours') };
    default:
      return { link: null, label: '' };
  }
}
