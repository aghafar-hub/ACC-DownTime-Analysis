import { t } from '../i18n/t';
import PopMenu, { MenuItem } from './PopMenu';

/** The 'Export' button: a menu with Excel and CSV. */
export default function ExportMenu({ onExcel, onCsv, disabled, testid = 'export-btn', label }: {
  onExcel: () => void; onCsv: () => void; disabled?: boolean; testid?: string; label?: string;
}) {
  return (
    <PopMenu label={label ?? t('Export')} icon="download" testid={testid} disabled={disabled}>
      {(close) => (
        <>
          <MenuItem onClick={() => { close(); onExcel(); }} sub={t('Formatted workbook (.xlsx)')} testid={`${testid}-excel`}>{t('Excel')}</MenuItem>
          <MenuItem onClick={() => { close(); onCsv(); }} sub={t('Plain text, opens in Excel (.csv)')} testid={`${testid}-csv`}>{t('CSV')}</MenuItem>
        </>
      )}
    </PopMenu>
  );
}
