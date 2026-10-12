import { useYear } from '../data/useStartup';
import { t } from '../i18n/t';
import { CountChip, ChipRow } from './PhoneParts';

/** Year switcher: one chip per year the server has events for. */
export default function YearSwitch() {
  const [year, setYear, years] = useYear();
  if (years.length === 0) return null;
  return (
    <ChipRow label={t('Year')}>
      {years.map((y) => (
        <CountChip key={y} on={y === year} onClick={() => setYear(y)} testid={`year-${y}`}>{y}</CountChip>
      ))}
    </ChipRow>
  );
}
