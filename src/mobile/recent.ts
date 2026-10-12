// Recent pages for the phone's More hub — the last few pages opened from the
// hub, a module's page strip or a module switch. Kept on this device only.
export type RecentPage = { key: string; label: string; icon: string; tabler?: boolean; route: string; moduleId?: string; page?: string };

const KEY = 'acc.recentPages.v1';
const MAX = 6;

export function getRecent(): RecentPage[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function pushRecent(p: RecentPage) {
  try {
    const next = [p, ...getRecent().filter((x) => x.key !== p.key)].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage blocked: no recents */
  }
}
