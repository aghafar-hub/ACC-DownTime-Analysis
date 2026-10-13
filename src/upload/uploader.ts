import { t } from '../i18n/t';

/**
 * Who uploaded: 'You', the person's name from the user list when the viewer may read it, else 'Another user' (a raw
 * user id means nothing to the reader). `name` is useUserNames(): it gives the id back when it has no name.
 */
export function uploaderName(id: string, me: string | undefined, name: (id: string) => string): string {
  if (!id) return t('Unknown');
  if (id === me) return t('You');
  const n = name(id);
  return n && n !== id ? n : t('Another user');
}
