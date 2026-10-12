// Build-time settings. The backend address comes only from VITE_API_URL
// (a repository variable in the deploy); it is never written in the source.
export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined)?.trim() || '';
/** True when no backend is configured: the in-memory synthetic API is used. */
export const IS_MOCK: boolean = !API_URL;
export const ENV_LABEL: string = (import.meta.env.VITE_ENV_LABEL as string | undefined) || '';
export const APP_NAME = 'ACC Downtime Analysis';
