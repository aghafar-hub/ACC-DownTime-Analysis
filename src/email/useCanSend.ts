// Who may send reports by email (backend 1.9.0, Access.js sendReport): Edit on the Reports tab, or the Admin role.
import { useAuth } from '../auth/AuthContext';
import { useActionsOptional } from '../actions/ActionsContext';
import type { ActionPerson } from '../api/types';

export function useCanSendEmail(): boolean {
  const { user, access } = useAuth();
  return !!user && (user.role_id === 'ROLE-ADMIN' || access?.reports === 'Edit');
}

/** The people of the app to pick as recipients (the active people the Actions page knows); [] when it is not loaded. */
export function useEmailPeople(): ActionPerson[] {
  return useActionsOptional()?.payload?.people ?? [];
}

/** A file name without characters mail programs or file systems refuse. */
export const safeFileName = (s: string): string => s.replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 110);
