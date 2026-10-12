import type { EventRow } from '../../api/types';

/** What the Validate page adds to the event popup: helps for fixing, the overlapping records, and what to do after saving. */
export interface ValidateAssist {
  /** the other records this one overlaps (shown with a button to open each) */
  overlaps?: EventRow[];
  onOpenOther?: (eventId: string) => void;
  /** the most used classification for the same area and code */
  suggestion?: { code: string; count: number } | null;
  /** the note the form starts with ("Checked on the Validate page"); the person can change it */
  defaultNote: string;
  /** open straight in the edit form or the void form */
  initialMode?: 'view' | 'edit' | 'void';
  /** called with the saved record; true closes the popup (nothing left to fix) */
  autoClose?: (updated: EventRow) => boolean;
}
