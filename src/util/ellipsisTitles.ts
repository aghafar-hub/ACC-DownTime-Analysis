// Text cut off with '…' (text-overflow: ellipsis or a line clamp) shows its full text as a tooltip (phase 5). One
// listener for the whole app: when the pointer or the keyboard focus reaches such an element and the text really is cut,
// it gets a title with the full text; when the text fits again the title it was given is taken away. An element that has
// its own title keeps it.

const AUTO = 'data-auto-title';

/** True when the element's text is cut: wider (one line) or taller (line clamp) than its box. */
export function isTruncated(el: Pick<HTMLElement, 'scrollWidth' | 'clientWidth' | 'scrollHeight' | 'clientHeight'>, style: Pick<CSSStyleDeclaration, 'textOverflow' | 'webkitLineClamp'>): boolean {
  const clamp = style.webkitLineClamp && style.webkitLineClamp !== 'none';
  if (style.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) return true;
  return !!clamp && el.scrollHeight > el.clientHeight + 1;
}

/** The full text for the tooltip: the element's text with runs of white space made single. */
export const fullText = (text: string | null): string => (text ?? '').replace(/\s+/g, ' ').trim();

function check(target: EventTarget | null): void {
  // the element itself or the nearest ancestor (a few levels) that does the cutting
  let el = target instanceof HTMLElement ? target : null;
  for (let i = 0; el && i < 4; i++, el = el.parentElement) {
    const style = getComputedStyle(el);
    const cuts = style.textOverflow === 'ellipsis' || (style.webkitLineClamp && style.webkitLineClamp !== 'none');
    if (!cuts) continue;
    const auto = el.hasAttribute(AUTO);
    if (el.hasAttribute('title') && !auto) return;
    if (isTruncated(el, style)) {
      const text = fullText(el.textContent);
      if (text) { el.setAttribute('title', text); el.setAttribute(AUTO, ''); }
    } else if (auto) {
      el.removeAttribute('title');
      el.removeAttribute(AUTO);
    }
    return;
  }
}

let installed = false;
export function installEllipsisTitles(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('pointerover', (e) => check(e.target), { capture: true, passive: true });
  document.addEventListener('focusin', (e) => check(e.target), { capture: true });
}
