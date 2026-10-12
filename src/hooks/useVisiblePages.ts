import { useAuth } from '../auth/AuthContext';
import { PAGES, type PageDef } from '../navigation';

/** The pages whose tab is View or Edit for the signed-in person. */
export function useVisiblePages(): PageDef[] {
  const { canView } = useAuth();
  return PAGES.filter((p) => canView(p.id));
}
