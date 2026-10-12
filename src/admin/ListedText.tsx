import { t } from '../i18n/t';
import './admin.css';

/**
 * Text exactly as it is listed. Leading and trailing spaces are drawn as visible marks (and named for a
 * screen reader), because "  Belt torn" and "Belt torn" are different entries in the list.
 */
export default function ListedText({ text }: { text: string }) {
  const lead = /^\s*/.exec(text)?.[0] ?? '';
  const trail = text.trim() === '' ? '' : (/\s*$/.exec(text)?.[0] ?? '');
  const body = text.slice(lead.length, text.length - trail.length);
  const mark = (s: string) => s.replace(/ /g, '·').replace(/\t/g, '→');
  return (
    <span data-testid="listed-text">
      {lead && <span className="adm-space" aria-label={t('{n} leading space(s)', { n: lead.length })} title={t('{n} leading space(s)', { n: lead.length })}>{mark(lead)}</span>}
      {body}
      {trail && <span className="adm-space" aria-label={t('{n} trailing space(s)', { n: trail.length })} title={t('{n} trailing space(s)', { n: trail.length })}>{mark(trail)}</span>}
    </span>
  );
}

/** True when the text starts or ends with white space (or has doubled spaces inside). */
export const hasOddSpacing = (text: string): boolean => text !== text.trim() || /\s{2,}/.test(text);
