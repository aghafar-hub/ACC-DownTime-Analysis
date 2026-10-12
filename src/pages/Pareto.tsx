import { useMemo } from 'react';
import DataNotes from '../components/DataNotes';
import PlaceholderPage from '../components/PlaceholderPage';
import { Tile } from '../components/Tile';
import YearSwitch from '../components/YearSwitch';
import { useYearData } from '../data/useYearData';
import { t } from '../i18n/t';
import { hours, num } from '../util/format';

export default function Pareto() {
  const { st, startup, year, ev, facts } = useYearData();
  const loaded = !!ev.data;
  const distinct = useMemo(() => {
    const areas = new Set<string>();
    const reasons = new Set<string>();
    const codes = new Set<string>();
    for (const e of ev.events) {
      if (e.is_void) continue;
      areas.add(e.area_id);
      if (e.reason_id) reasons.add(e.reason_id);
      if (e.equipment_id) codes.add(e.equipment_id);
    }
    return { areas: areas.size, reasons: reasons.size, codes: codes.size };
  }, [ev.events]);
  return (
    <PlaceholderPage
      tab="pareto"
      subtitle={loaded ? t('{events} events in {year} · {codes} equipment codes · {reasons} listed reasons used', { events: num(facts.count), year: year ?? '', codes: distinct.codes, reasons: distinct.reasons }) : t('Loading…')}
      right={<YearSwitch />}
      tiles={
        <>
          <Tile icon="list" label={t('Events loaded for {year}', { year: year ?? '-' })} value={loaded ? num(facts.count) : '-'} testid="fact-events" />
          <Tile icon="limits" label={t('Equipment codes with stops')} value={loaded ? num(distinct.codes) : '-'} sub={t('of {n} in the master list', { n: startup?.equipment.length ?? 0 })} testid="fact-codes" />
          <Tile icon="equipment" label={t('Areas with stops')} value={loaded ? num(distinct.areas) : '-'} sub={t('of {n}', { n: startup?.areas.length ?? 0 })} testid="fact-areas-with-stops" />
          <Tile icon="clock" label={t('Stoppage hours')} value={loaded ? hours(facts.seconds) : '-'} sub={t('area-hours, not voided')} testid="fact-hours" />
        </>
      }
      next={{
        title: t('What costs the most downtime'),
        points: [
          'Pareto bars by area, equipment, reason and classification with a cumulative line and an 80% marker',
          'Top 5, 10, 20 or All, with an "Others" bar and click-through to the events',
          'A separate view for stops caused by equipment that belongs to another area',
        ],
      }}
    >
      <DataNotes st={st} ev={ev} />
    </PlaceholderPage>
  );
}
