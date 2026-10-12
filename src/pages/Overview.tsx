import DataNotes from '../components/DataNotes';
import PlaceholderPage from '../components/PlaceholderPage';
import { Tile } from '../components/Tile';
import YearSwitch from '../components/YearSwitch';
import { useYearData } from '../data/useYearData';
import { t } from '../i18n/t';
import { num } from '../util/format';

export default function Overview() {
  const { st, startup, year, ev, facts } = useYearData();
  const areas = startup?.areas.filter((a) => a.active).length ?? 0;
  const loaded = !!ev.data;
  return (
    <PlaceholderPage
      tab="overview"
      subtitle={loaded
        ? t('{events} events in {year} · {areas} areas · last data added {date}', { events: num(facts.count), year: year ?? '', areas, date: facts.added || '-' })
        : t('Loading…')}
      right={<YearSwitch />}
      tiles={
        <>
          <Tile icon="list" label={t('Events loaded for {year}', { year: year ?? '-' })} value={loaded ? num(facts.count) : '-'} sub={t('rows, including continuations')} testid="fact-events" />
          <Tile icon="alert" label={t('Failure events')} value={loaded ? num(facts.failures) : '-'} sub={t('not voided')} testid="fact-failures" />
          <Tile icon="equipment" label={t('Areas')} value={startup ? num(areas) : '-'} sub={t('on {n} lines', { n: startup?.lines.length ?? 0 })} testid="fact-areas" />
          <Tile icon="calendar" label={t('Latest event date')} value={facts.last || '-'} sub={t('last data added {date}', { date: facts.added || '-' })} testid="fact-last" />
        </>
      }
      next={{
        title: t('Plant downtime at a glance'),
        points: [
          'Hours, failures and availability for the chosen period, with a comparison',
          'The worst areas and the top reasons, each one a click-through to the events',
          'A month-by-month trend with the current month shown as partial',
        ],
      }}
    >
      <DataNotes st={st} ev={ev} />
    </PlaceholderPage>
  );
}
