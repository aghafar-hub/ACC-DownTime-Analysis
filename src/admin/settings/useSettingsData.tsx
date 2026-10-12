import { useAuth } from '../../auth/AuthContext';
import { useStartup } from '../../data/useStartup';
import { useToast } from '../useToast';

/** What the Calculations and Security subtabs share: the settings on record, the access level and the saved toast. */
export function useSettingsData() {
  const st = useStartup();
  const { canEdit } = useAuth();
  const [toastNode, toast] = useToast();
  const settings = st.startup?.settings ?? [];
  const last = settings.map((s) => s.updated_at).filter(Boolean).sort().pop();
  return { st, settings, last, edit: canEdit('settings'), toastNode, toast };
}
