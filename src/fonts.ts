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
