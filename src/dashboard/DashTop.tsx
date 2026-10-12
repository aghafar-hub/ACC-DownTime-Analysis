// The top of every Analyze page, in the same order: title with its one-line takeaway, the data-quality banner,
// loading / offline notes, then the shared filter bar.
import type { ReactNode } from 'react';
import { PageHeader } from '../components/Tile';
import { ValidationBanner } from '../validate/ValidationBanner';
import FilterBar from './FilterBar';
import { DashStatus } from './parts';
import type { Dash } from './useDash';

export default function DashTop({ title, takeaway, right, dash, eventCount, hideCompare, belowTakeaway }: {
  title: string; takeaway: string; right?: ReactNode; dash: Dash; eventCount: number | null; hideCompare?: boolean;
  /** shown right under the title and takeaway (the Overview's "Since your last visit" card) */
  belowTakeaway?: ReactNode;
}) {
  return (
    <>
      <PageHeader title={title} subtitle={<span className="takeaway" data-testid="takeaway">{takeaway}</span>} right={right} />
      {belowTakeaway}
      <ValidationBanner />
      <DashStatus dash={dash} />
      <FilterBar dash={dash} eventCount={eventCount} hideCompare={hideCompare} />
    </>
  );
}
