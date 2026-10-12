import type { ReactNode } from 'react';
import type { TabId } from '../api/types';
import NoAccess from '../pages/NoAccess';
import { useAuth } from './AuthContext';

/** Shows the page only when the tab is View or Edit; a deep link to a hidden tab gets a plain notice. */
export default function RequireTab({ tab, children }: { tab: TabId; children: ReactNode }) {
  const { canView } = useAuth();
  return canView(tab) ? <>{children}</> : <NoAccess />;
}
