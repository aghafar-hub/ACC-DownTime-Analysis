// Tiny native-feel touch feedback — most Android/Chrome handles support
// navigator.vibrate; iOS Safari doesn't expose it at all (no API, not even
// a no-op stub some browsers give you), so this silently no-ops there
// rather than throwing. Kept to a single very short pulse: this is a
// confirmation tick (tab switched, action saved), not a notification buzz.
export function tapHaptic(): void {
  try {
    navigator.vibrate?.(8);
  } catch {
    // ignore — never let haptics break a real interaction
  }
}
