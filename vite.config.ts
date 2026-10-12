import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Base path: './' (relative) by default so the build works under any
// GitHub Pages sub-path; override with VITE_BASE (for example '/my-repo/').
const base = process.env.VITE_BASE || './';

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      // 'prompt': a new version waits for the person to tap Reload
      // (src/mobile/UpdatePrompt.tsx) instead of reloading mid-form.
      registerType: 'prompt',
      includeAssets: ['icons/favicon-16.png', 'icons/favicon-32.png', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'ACC Downtime Analysis',
        short_name: 'ACC Downtime',
        description: 'Arabian Cement Company: plant downtime analysis.',
        // Relative id / start_url / scope keep the live site and any test
        // copy as two separate installs.
        id: '.',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        orientation: 'any',
        categories: ['business', 'productivity'],
        background_color: '#F3F5F8',
        theme_color: '#FFFFFF',
        icons: [
          { src: 'icons/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        clientsClaim: true,
        runtimeCaching: [
          {
            // Web fonts: serve from the device once fetched, so the app
            // keeps its look offline.
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'acc-dt-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
