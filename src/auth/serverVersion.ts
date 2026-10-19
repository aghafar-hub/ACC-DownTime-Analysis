// The Apps Script version the app talks to (sent with the session from backend 1.10.0; '' from an older server). Features
// that need a newer server are shown only when it is there, so the app keeps working before the owner deploys it.

/** True when `version` ('1.10.0') is the same as or newer than `min`; '' (unknown, an older server) is never. */
export function versionAtLeast(version: string | null | undefined, min: string): boolean {
  if (!version) return false;
  const a = version.split('.').map((x) => Number(x) || 0);
  const b = min.split('.').map((x) => Number(x) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return true;
}

/** Backend 1.10.0: sign out of all devices, admin-only management of Admins, keep-as-entered in one call. */
export const SERVER_1_10 = '1.10.0';
