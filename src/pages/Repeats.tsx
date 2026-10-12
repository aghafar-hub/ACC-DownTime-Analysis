import DataNotes from '../components/DataNotes';
import PlaceholderPage from '../components/PlaceholderPage';
import { Tile } from '../components/Tile';
import YearSwitch from '../components/YearSwitch';
import { useYearData } from '../data/useYearData';
import { t } from '../i18n/t';
import { num } from '../util/format';

export default function Repeats() {
  const { st, startup, year, ev, facts } = useYearData();
  const loaded = !!ev.data;
  const setting = (k: string) => startup?.settings.find((s) => s.key === k)?.value || '-';
  return (
    <PlaceholderPage
      tab="repeats"
      subtitle={loaded ? t('{n} failure events in {year}. Repeat rule: {min} or more within {days} days', { n: num(facts.failures), year: year ?? '', min: setting('repeat_min_events'), days: setting('repeat_window_days') }) : t('Loading…')}
      right={<YearSwitch />}
      tiles={
        <>
          <Tile icon="alert" label={t('Failure events in {year}', { year: year ?? '-' })} value={loaded ? num(facts.failures) : '-'} sub={t('not voided')} testid="fact-failures" />
          <Tile icon="repeat" label={t('Failures needed to flag a repeat')} value={setting('repeat_min_events')} sub={t('from Settings')} testid="fact-repeat-min" />
          <Tile icon="calendar" label={t('Repeat window')} value={`${setting('repeat_window_days')} ${t('days')}`} sub={t('from Settings')} testid="fact-repeat-days" />
        </>
      }
      next={{
        title: t('Failures that keep coming back'),
        points: [
          'Equipment code and reason pairs with repeated failures inside the window',
          'Occurrences, total hours, average and longest stop, and days between failures',
          'Recurrence events shown separately from the first occurrence',
        ],
      }}
    >
      <DataNotes st={st} ev={ev} />
    </PlaceholderPage>
  );
}
