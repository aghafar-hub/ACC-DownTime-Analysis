import { defineConfig } from '@playwright/test';

// Runs against `vite preview` of a production build (mock API: no
// VITE_API_URL). The preinstalled Chromium is used; never run
// `playwright install`.
// E2E_PORT lets several runs share the machine: each uses its own port, build
// folder and output folder.
const PORT = Number(process.env.E2E_PORT || 4173);
const OUT = `dist-e2e-${PORT}`;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: `test-results/pw-${PORT}`,
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || '/opt/pw-browsers/chromium',
      args: ['--no-sandbox'],
    },
    serviceWorkers: 'block',
  },
  webServer: {
    command: `npx tsc -b && npx vite build --outDir ${OUT} && npx vite preview --outDir ${OUT} --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
