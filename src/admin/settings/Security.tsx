import DataNotes from '../../components/DataNotes';
import { dateText } from '../../util/dates';
import { Tile } from '../../components/Tile';
import { t } from '../../i18n/t';
import { whenText } from '../../util/format';
import SettingsForm from '../SettingsForm';
import { useSettingsData } from './useSettingsData';
import '../../components/ui.css';
import '../admin.css';

/** Settings > Security: lockout, session lengths and the minimum password length. */
export default function Security() {
  const { st, settings, last, edit, toastNode, toast } = useSettingsData();
  return (
    <div data-testid="settings-security">
      <p className="status-line" style={{ marginBottom: 12 }} data-testid="access-level">
        {edit ? t('Your access to this page: can edit.') : t('Your access to this page: view only.')}
      </p>
      <div className="tiles">
        <Tile icon="settings" label={t('Settings on record')} value={st.startup ? settings.length : '-'} testid="fact-settings" />
        <Tile icon="clock" label={t('Last changed')} value={last ? dateText(last) : t('never')} sub={last ? whenText(last.replace(' ', 'T')) : undefined} testid="fact-last-changed" />
      </div>
      <DataNotes st={st} />
      {st.startup && <SettingsForm settings={settings} canEdit={edit} groupIds={['signin']} onSaved={(text) => { toast(text); st.reload(); }} />}
      {toastNode}
    </div>
  );
}
