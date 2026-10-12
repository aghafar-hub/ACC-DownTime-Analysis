import DataNotes from '../components/DataNotes';
import PlaceholderPage from '../components/PlaceholderPage';
import { Tile } from '../components/Tile';
import { useStartup } from '../data/useStartup';
import { t } from '../i18n/t';
import { num } from '../util/format';

export default function Master() {
  const st = useStartup();
  const s = st.startup;
  const shared = s ? s.equipment_areas.length - new Set(s.equipment_areas.map((e) => e.equipment_id)).size : 0;
  const review = s ? s.equipment.filter((e) => e.needs_review).length : 0;
  return (
    <PlaceholderPage
      tab="master"
      subtitle={s ? t('{eq} equipment codes · {areas} areas · {reasons} reasons · {aliases} aliases', { eq: num(s.equipment.length), areas: s.areas.length, reasons: s.reasons.length, aliases: s.aliases.length }) : t('Loading…')}
      tiles={
        <>
          <Tile icon="equipment" label={t('Equipment codes')} value={s ? num(s.equipment.length) : '-'} sub={t('{n} need review', { n: review })} testid="fact-equipment" />
          <Tile icon="database" label={t('Areas')} value={s ? num(s.areas.length) : '-'} sub={t('on {n} lines', { n: s?.lines.length ?? 0 })} testid="fact-areas" />
          <Tile icon="list" label={t('Reasons')} value={s ? num(s.reasons.length) : '-'} sub={t('{n} classifications', { n: s?.classifications.length ?? 0 })} testid="fact-reasons" />
          <Tile icon="repeat" label={t('Codes in two or more areas')} value={s ? num(shared) : '-'} sub={t('{n} aliases for typos', { n: s?.aliases.length ?? 0 })} testid="fact-shared" />
        </>
      }
      next={{
        title: t('Keep the lists right'),
        points: [
          'Equipment with the areas it belongs to (a code may belong to several), aliases for typos and retired codes',
          'Reasons per classification, exactly as listed, and areas and lines',
          'A report of codes and reasons that appeared in events but are not in the lists',
        ],
      }}
    >
      <DataNotes st={st} />
    </PlaceholderPage>
  );
}
