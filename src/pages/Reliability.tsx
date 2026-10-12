import DataNotes from '../components/DataNotes';
import PlaceholderPage from '../components/PlaceholderPage';
import { Tile } from '../components/Tile';
import YearSwitch from '../components/YearSwitch';
import { useYearData } from '../data/useYearData';
import { t } from '../i18n/t';
import { num } from '../util/format';

export default function Reliability() {
  const { st, startup, year, ev, facts } = useYearData();
  const loaded = !!ev.data;
  const setting = (k: string) => startup?.settings.find((s) => s.key === k)?.value || '-';
  return (
    <PlaceholderPage
      tab="reliability"
      subtitle={loaded ? t('{n} events in {year} · availability basis {basis} · {h} scheduled hours a day', { n: num(facts.count), year: year ?? '', basis: setting('availability_basis'), h: setting('scheduled_hours_per_day') }) : t('Loading…')}
      right={<YearSwitch />}
      tiles={
        <>
          <Tile icon="list" label={t('Events loaded for {year}', { year: year ?? '-' })} value={loaded ? num(facts.count) : '-'} testid="fact-events" />
          <Tile icon="calendar" label={t('Years with data')} value={startup ? num(startup.years.length) : '-'} sub={startup?.years.join(', ')} testid="fact-years" />
          <Tile icon="trend" label={t('Availability basis')} value={setting('availability_basis')} sub={t('from Settings')} testid="fact-basis" />
          <Tile icon="clock" label={t('Scheduled hours per day')} value={setting('scheduled_hours_per_day')} sub={t('{n} days a week', { n: setting('scheduled_days_per_week') })} testid="fact-scheduled" />
        </>
      }
      next={{
        title: t('Reliability over time'),
        points: [
          'Availability, operating hours, MTBF, failure rate and mean restoration time by area and month',
          'Comparison with the previous period or the same period last year',
          '"None recorded" where there are no failures and "Unavailable" where data is missing, never zero',
        ],
      }}
    >
      <DataNotes st={st} ev={ev} />
    </PlaceholderPage>
  );
}
