import { describe, expect, it } from 'vitest';
import { bottomBarPages, pagesInSection, PAGES, SECTIONS, type PageId } from './navigation';

const only = (ids: PageId[]) => PAGES.filter((p) => ids.includes(p.id));
const ids = (ps: { id: string }[]) => ps.map((p) => p.id);

describe('navigation sections', () => {
  it('groups every page into Analyze, Data or Setup in the agreed order', () => {
    expect(SECTIONS.map((s) => s.label)).toEqual(['Analyze', 'Data', 'Setup']);
    expect(ids(pagesInSection(PAGES, 'analyze'))).toEqual(['overview', 'pareto', 'repeats', 'reliability']);
    expect(ids(pagesInSection(PAGES, 'data'))).toEqual(['events', 'validate', 'upload']);
    expect(ids(pagesInSection(PAGES, 'setup'))).toEqual(['master']);
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
