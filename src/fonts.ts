// The app's three typefaces, bundled with the app (phase 5) instead of loaded from Google Fonts: they work offline and
// on networks that block the font service. Only the weights the CSS uses; the latin-ext faces download only when a page
// needs one of their characters (unicode-range). Space Grotesk for display, IBM Plex Sans for UI, IBM Plex Mono for
// codes and times (index.css: --font-display, --sans, --mono).
import '@fontsource/space-grotesk/latin-500.css';
import '@fontsource/space-grotesk/latin-600.css';
import '@fontsource/space-grotesk/latin-700.css';
import '@fontsource/space-grotesk/latin-ext-500.css';
import '@fontsource/space-grotesk/latin-ext-600.css';
import '@fontsource/space-grotesk/latin-ext-700.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-700.css';
import '@fontsource/ibm-plex-sans/latin-ext-400.css';
import '@fontsource/ibm-plex-sans/latin-ext-500.css';
import '@fontsource/ibm-plex-sans/latin-ext-600.css';
import '@fontsource/ibm-plex-sans/latin-ext-700.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-ext-500.css';
import '@fontsource/ibm-plex-mono/latin-ext-600.css';

/** The latin faces the app uses (family, weight). */
export const FONT_FACES: [string, number][] = [
  ['Space Grotesk', 500], ['Space Grotesk', 600], ['Space Grotesk', 700],
  ['IBM Plex Sans', 400], ['IBM Plex Sans', 500], ['IBM Plex Sans', 600], ['IBM Plex Sans', 700],
  ['IBM Plex Mono', 500], ['IBM Plex Mono', 600],
];

/**
 * Loads every latin face once the page is idle after start-up, not only when a page first shows text in it. The service
 * worker keeps them for offline use; this also covers the first visit, before the worker is installed, when the network
 * goes away early (a bold heading that first appears offline would else fall back to a system font).
 */
export function preloadFonts(): void {
  if (typeof document === 'undefined' || !document.fonts?.load) return;
  const run = () => { for (const [family, weight] of FONT_FACES) void document.fonts.load(`${weight} 16px "${family}"`).catch(() => {}); };
  const idle = (window as Window & { requestIdleCallback?: (fn: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  const start = () => (idle ? idle(run, { timeout: 3000 }) : window.setTimeout(run, 1500));
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}
preloadFonts();
