// 'Download Excel' and 'Download CSV' for a report, in the builder and in the preview. Excel: one workbook with a Summary
// sheet and one sheet per chosen section. CSV: a menu of the sections that hold a table, one file per click. The files
// are made from the report model (src/export/reportExport.ts), so their numbers are the report's numbers.
import { useEffect, useRef, useState } from 'react';
import type { ReportSectionId } from '../api/types';
import PopMenu, { MenuItem } from '../components/PopMenu';
import { buildReportWorkbook, buildSectionCsv } from '../export/reportExport';
import { downloadFile } from '../export/files';
import { XLSX_MIME } from '../export/xlsx';
import { CSV_MIME } from '../export/csv';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import type { ReportModel } from './model';
import { SECTION_BY_ID, SECTION_GROUPS } from './sections';

/** Sections that give a CSV: everything with a table of numbers (the cover and the methodology text have none). */
export const csvSectionIds = (sections: readonly ReportSectionId[]): ReportSectionId[] => sections.filter((s) => s !== 'cover' && s !== 'methodology');

type Note = { text: string; bad: boolean } | null;

export default function ReportExport({ sections, getModel, ready, testid }: {
  sections: readonly ReportSectionId[];
  /** the report model for these sections (the whole report, or just the one a CSV needs); null while the data is not ready */
  getModel: (only?: ReportSectionId[]) => ReportModel | null;
  ready: boolean;
  testid: string;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const none = sections.length === 0;

  const run = async (work: () => string | null) => {
    if (busy) return;
    setBusy(true);
    setNote({ text: t('Preparing the file…'), bad: false });
    await new Promise((r) => window.setTimeout(r, 30)); // let the note paint before the work
    let result: Note;
    try {
      const msg = work();
      result = msg === null ? { text: t('The report data is not ready yet. Try again in a moment.'), bad: true } : { text: msg, bad: false };
    } catch {
      result = { text: t('The file could not be made. Try again.'), bad: true };
    }
    if (alive.current) {
      setNote(result);
      setBusy(false);
    }
  };

  const excel = () => run(() => {
    const model = getModel();
    if (!model) return null;
    const wb = buildReportWorkbook(model);
    if (!downloadFile(wb.fileName, wb.bytes, XLSX_MIME)) return t('The browser did not start the download. Try again.');
    return t('{name} downloaded: {n} sheets.', { name: wb.fileName, n: wb.sheets.length });
  });
  const csv = (id: ReportSectionId) => run(() => {
    const model = getModel([id]);
    if (!model) return null;
    const out = buildSectionCsv(model, id);
    if (!out) return t('This section has no table to export.');
    if (!downloadFile(out.fileName, out.text, CSV_MIME)) return t('The browser did not start the download. Try again.');
    return t('{name} downloaded.', { name: out.fileName });
  });

  return (
    <div className="rx-wrap">
      <div className="rx" data-testid={`${testid}-export`}>
        <button type="button" className="btn" onClick={() => void excel()} disabled={!ready || none || busy} data-testid={`${testid}-excel`}>
          <Icon name="download" size={16} /> {t('Download Excel')}
        </button>
        <PopMenu label={t('Download CSV')} icon="download" testid={`${testid}-csv`} disabled={!ready || none || busy}>
          {(close) => (
            <>
              <p className="pm-note" role="presentation">{t('One file per section. Pick a section with a table.')}</p>
              {csvSectionIds(sections).map((id) => (
                <MenuItem key={id} onClick={() => { close(); void csv(id); }} testid={`${testid}-csv-${id}`} sub={t(SECTION_GROUPS.find((g) => g.id === SECTION_BY_ID[id].group)?.label ?? '')}>
                  {t(SECTION_BY_ID[id].label)}
                </MenuItem>
              ))}
              {csvSectionIds(sections).length === 0 && <p className="pm-note">{t('The chosen sections have no tables. Add a section with figures.')}</p>}
            </>
          )}
        </PopMenu>
      </div>
      <p className={note?.bad ? 'rx-note rx-note--bad' : 'rx-note'} role={note?.bad ? 'alert' : 'status'} aria-live="polite" data-testid={`${testid}-export-note`}>{note?.text ?? ''}</p>
    </div>
  );
}
