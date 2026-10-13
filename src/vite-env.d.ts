/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** Apps Script web app address. Unset: the in-memory demo API is used. */
  readonly VITE_API_URL?: string;
  /** Base path of the site, for example /my-repo/. Default ./ */
  readonly VITE_BASE?: string;
  /** Prefix for every storage key in a test copy. */
  readonly VITE_STORAGE_PREFIX?: string;
  /** Shows a "not live data" ribbon on a test copy. */
  readonly VITE_ENV_LABEL?: string;
}

/** Short git commit of this build, or 'dev' (vite.config.ts `define`). */
declare const __APP_BUILD__: string;
/** Build date, YYYY-MM-DD. */
declare const __APP_BUILD_DATE__: string;

interface Window {
  /** Demo build only (no VITE_API_URL): flips the "new version waiting" state so tests can see the banner. */
  __accTestUpdate?: (() => void) & {
    onApply?: () => void;
    onCheck?: () => Promise<'found' | 'none' | 'error' | 'unavailable'>;
  };
}
