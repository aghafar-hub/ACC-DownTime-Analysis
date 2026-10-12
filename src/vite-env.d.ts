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
