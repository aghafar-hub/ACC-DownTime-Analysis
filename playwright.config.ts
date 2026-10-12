import { defineConfig } from '@playwright/test';

// Runs against `vite preview` of a production build (mock API: no
// VITE_API_URL). The preinstalled Chromium is used; never run
// `playwright install`.
const PORT = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results/pw',
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || '/opt/pw-browsers/chromium',
      args: ['--no-sandbox'],
    },
    serviceWorkers: 'block',
  },
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
