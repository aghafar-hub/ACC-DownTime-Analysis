import { describe, expect, it } from 'vitest';
import { TAB_IDS } from './api/types';
import { ICON_NAMES } from './icons';
import { BOTTOM_BAR_ORDER, bottomBarPages, pageById, pageForPath, pagesInSection, PAGES, SECTIONS, type PageId } from './navigation';

const only = (ids: PageId[]) => PAGES.filter((p) => ids.includes(p.id));
const ids = (ps: { id: string }[]) => ps.map((p) => p.id);

describe('navigation sections', () => {
  it('groups every page into Analyze, Reports, Data or Setup in the agreed order', () => {
    expect(SECTIONS.map((s) => s.label)).toEqual(['Analyze', 'Reports', 'Data', 'Setup']);
    expect(ids(pagesInSection(PAGES, 'analyze'))).toEqual(['overview', 'pareto', 'repeats', 'reliability']);
    expect(ids(pagesInSection(PAGES, 'reports'))).toEqual(['reports']);
    expect(ids(pagesInSection(PAGES, 'data'))).toEqual(['events', 'validate', 'upload']);
    expect(ids(pagesInSection(PAGES, 'setup'))).toEqual(['master']);
  });
  it('Reports is one page of its own section: path, access tab, labels and icon', () => {
    const p = pageById('reports');
    expect(p).toMatchObject({ path: '/reports', access: 'reports', label: 'Reports', tab: 'Reports', short: 'Reports', group: 'reports' });
    expect(pageForPath('/reports')?.id).toBe('reports');
    expect(pageForPath('/reports/anything')?.id).toBe('reports');
    expect(ICON_NAMES).toContain(p.icon);
    // a single page needs no tab row, and it is not on the phone bottom bar
    expect(pagesInSection(PAGES, 'reports')).toHaveLength(1);
    expect(BOTTOM_BAR_ORDER).not.toContain('reports');
    expect(ids(bottomBarPages(PAGES))).not.toContain('reports');
  });
  it('every tab id has a page, so the Users screen can label it', () => {
    for (const tab of TAB_IDS) expect(() => pageById(tab)).not.toThrow();
    expect(pageById('reports').label).toBe('Reports');
  });
  it('the phone bar is Overview, Pareto, Events for everyone who sees them', () => {
    expect(ids(bottomBarPages(PAGES))).toEqual(['overview', 'pareto', 'events']);
  });
  it('takes the next visible page when one of the three is hidden', () => {
    expect(ids(bottomBarPages(only(['overview', 'events', 'reliability', 'repeats'])))).toEqual(['overview', 'events', 'reliability']);
    expect(ids(bottomBarPages(only(['overview', 'validate', 'upload'])))).toEqual(['overview', 'validate', 'upload']);
    expect(ids(bottomBarPages(only(['pareto', 'repeats', 'upload', 'validate'])))).toEqual(['pareto', 'repeats', 'validate']);
  });
});
