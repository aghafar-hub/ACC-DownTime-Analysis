// Phone viewport facts for CSS (imported once from main.tsx):
//   --app-vh   the height actually visible — shrinks when the on-screen
//              keyboard opens, so full-screen forms keep their footer above it
//   html.kb-open  the keyboard is up (the bottom bar hides to give room)
//   html.standalone  launched from the home screen (installed app)
// It also scrolls a focused field into view once the keyboard has opened.
const root = document.documentElement;
const vv = window.visualViewport;

function update() {
  const h = vv ? vv.height : window.innerHeight;
  root.style.setProperty('--app-vh', `${Math.round(h)}px`);
  // a keyboard takes well over 150px; the browser's own bars much less
  const kb = !!vv && window.innerHeight - vv.height > 150 && isTyping();
  root.classList.toggle('kb-open', kb);
}

function isTyping() {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && !/^(checkbox|radio|button|submit|range|file|color)$/i.test((el as HTMLInputElement).type)) || el.isContentEditable;
}

update();
(vv || window).addEventListener('resize', update);
window.addEventListener('orientationchange', () => setTimeout(update, 250));
document.addEventListener('focusin', () => {
  setTimeout(() => {
    update();
    const el = document.activeElement as HTMLElement | null;
    if (el && isTyping() && root.classList.contains('kb-open')) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, 300);
});
document.addEventListener('focusout', () => setTimeout(update, 100));

const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
root.classList.toggle('standalone', !!standalone);

// No zooming (user request). Safari ignores user-scalable=no, so stop the
// pinch gesture itself; the double-tap zoom is off via touch-action (CSS).
const stop = (e: Event) => e.preventDefault();
document.addEventListener('gesturestart', stop, { passive: false } as AddEventListenerOptions);
document.addEventListener('gesturechange', stop, { passive: false } as AddEventListenerOptions);
document.addEventListener(
  'touchmove',
  (e) => {
    if ((e as TouchEvent).touches.length > 1) e.preventDefault();
  },
  { passive: false },
);
export {};
