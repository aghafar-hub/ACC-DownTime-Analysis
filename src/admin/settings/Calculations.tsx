import DataNotes from '../../components/DataNotes';
import AccessBadge from '../../components/AccessBadge';
import SettingsForm from '../SettingsForm';
import { useSettingsData } from './useSettingsData';
import '../../components/ui.css';
import '../admin.css';

/** Settings > Calculations: availability basis, scheduled hours, repeated-failure rule, duration bands, targets. */
export default function Calculations() {
  const { st, settings, edit, toastNode, toast } = useSettingsData();
  return (
    <div data-testid="settings-calculations">
      <DataNotes st={st} />
      {st.startup && <SettingsForm settings={settings} canEdit={edit} badge={<AccessBadge edit={edit} />} groupIds={['availability', 'rules', 'targets']} onSaved={(text) => { toast(text); st.reload(); }} />}
      {toastNode}
    </div>
  );
}
