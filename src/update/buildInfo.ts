// Filled in at build time by vite.config.ts (git short hash, or 'dev').
export const APP_BUILD: string = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'dev';
export const APP_BUILD_DATE: string = typeof __APP_BUILD_DATE__ === 'string' ? __APP_BUILD_DATE__ : '';
