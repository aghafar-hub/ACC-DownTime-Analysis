import { useEffect, useState } from "react";

// PWA item 25 — the install guide. Chrome/Edge/Android fire
// `beforeinstallprompt` once, early (often before React mounts), so it's
// caught here at import time (main.tsx imports this first) and kept for
// the "Install" button. iPhone Safari has no such event: there the guide
// shows the Share → Add to Home Screen steps instead.
type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};

let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // we show our own button instead of Chrome's mini-bar
    deferred = e as InstallEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  // iPadOS reports itself as a Mac; touch points tell them apart
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export type InstallState = {
  installed: boolean;
  canPrompt: boolean;
  ios: boolean;
  install: () => Promise<boolean>;
};

export function useInstall(): InstallState {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return {
    installed: isStandalone(),
    canPrompt: deferred !== null,
    ios: isIos(),
    install: async () => {
      if (!deferred) return false;
      const e = deferred;
      await e.prompt();
      const { outcome } = await e.userChoice;
      deferred = null;
      notify();
      return outcome === "accepted";
    },
  };
}
