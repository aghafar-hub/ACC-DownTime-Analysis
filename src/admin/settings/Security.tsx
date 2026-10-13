import DataNotes from '../../components/DataNotes';
import AccessBadge from '../../components/AccessBadge';
import SettingsForm from '../SettingsForm';
import { useSettingsData } from './useSettingsData';
import '../../components/ui.css';
import '../admin.css';

/** Settings > Security: lockout, session lengths and the minimum password length. */
export default function Security() {
  const { st, settings, edit, toastNode, toast } = useSettingsData();
  return (
    <div data-testid="settings-security">
      <DataNotes st={st} />
      {st.startup && <SettingsForm settings={settings} canEdit={edit} badge={<AccessBadge edit={edit} />} groupIds={['signin']} onSaved={(text) => { toast(text); st.reload(); }} />}
      {toastNode}
    </div>
  );
}
