// The report as a PDF for an email attachment (backend 1.9.0): every laid-out A4 page of the report preview becomes one
// JPEG picture at about 150 dpi on one A4 PDF page. The two libraries are loaded only when somebody sends.

/** A4 in millimetres. */
export const A4_MM = { w: 210, h: 297 } as const;

/** The pixel ratio that gives about `dpi` dots per inch for a page `cssWidth` CSS pixels wide printed 210 mm wide. */
export function pixelRatioFor(cssWidth: number, dpi = 150): number {
  if (!(cssWidth > 0)) return 1;
  const targetPx = (A4_MM.w / 25.4) * dpi;
  return Math.min(4, Math.max(1, targetPx / cssWidth));
}

/** Bytes to base64 (no data: prefix), in chunks so a large file never overflows the call stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) s += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(s);
}

/** The base64 text of a UTF-8 string. */
export const textToBase64 = (text: string): string => bytesToBase64(new TextEncoder().encode(text));

/**
 * Makes the PDF from the report pages on screen (the preview's `[data-testid=rpt-page]` elements). The screen zoom of a
 * page is ignored: each page is drawn at its own A4 size. `onPage(i, n)` reports progress.
 */
export async function pagesToPdf(pages: HTMLElement[], onPage?: (i: number, n: number) => void): Promise<Uint8Array> {
  const [{ toJpeg }, { jsPDF }] = await Promise.all([import('html-to-image'), import('jspdf')]);
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  for (let i = 0; i < pages.length; i++) {
    onPage?.(i + 1, pages.length);
    const page = pages[i]!;
    const w = page.offsetWidth;
    const h = page.offsetHeight;
    const opts = {
      quality: 0.85, backgroundColor: '#ffffff', pixelRatio: pixelRatioFor(w), width: w, height: h, cacheBust: false,
      style: { transform: 'none', boxShadow: 'none', margin: '0' },
    };
    let url: string;
    try {
      url = await toJpeg(page, opts);
    } catch {
      // web fonts from another site can refuse to be read: draw with the system fonts instead
      url = await toJpeg(page, { ...opts, skipFonts: true });
    }
    if (i > 0) pdf.addPage('a4', 'portrait');
    pdf.addImage(url, 'JPEG', 0, 0, A4_MM.w, A4_MM.h, undefined, 'FAST');
  }
  return new Uint8Array(pdf.output('arraybuffer'));
}

/**
 * Where each PDF page starts in a long document (CSS pixels from its top): a page ends at the last block end that fits,
 * so a block (an action, a table row group) is not cut unless it is taller than a page.
 */
export function pageStarts(blockEnds: readonly number[], total: number, pageH: number): number[] {
  const ends = [...new Set(blockEnds)].filter((e) => e > 0 && e <= total).sort((a, b) => a - b);
  const starts: number[] = [];
  let start = 0;
  while (start < total - 0.5) {
    starts.push(start);
    const limit = start + pageH;
    if (limit >= total) break;
    const fit = ends.filter((e) => e > start + 1 && e <= limit);
    start = fit.length ? fit[fit.length - 1]! : limit;
  }
  return starts;
}

/** A long document (the actions report) as A4 pages with 10 mm margins, cut between its `[data-pdf-block]` parts. */
export async function documentToPdf(root: HTMLElement, onStep?: (text: string) => void): Promise<Uint8Array> {
  const [{ toCanvas }, { jsPDF }] = await Promise.all([import('html-to-image'), import('jspdf')]);
  const margin = 10;
  const contentW = A4_MM.w - 2 * margin;
  const contentH = A4_MM.h - 2 * margin;
  const w = root.offsetWidth;
  const total = root.scrollHeight;
  const top = root.getBoundingClientRect().top;
  const ends = [...root.querySelectorAll<HTMLElement>('[data-pdf-block]')].map((b) => b.getBoundingClientRect().bottom - top);
  const opts = { backgroundColor: '#ffffff', pixelRatio: pixelRatioFor(w * (A4_MM.w / contentW)), width: w, height: total, cacheBust: false };
  onStep?.('draw');
  let canvas: HTMLCanvasElement;
  try {
    canvas = await toCanvas(root, opts);
  } catch {
    canvas = await toCanvas(root, { ...opts, skipFonts: true });
  }
  const scale = canvas.width / w;
  const starts = pageStarts(ends, total, w * (contentH / contentW));
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  starts.forEach((s, i) => {
    const end = i + 1 < starts.length ? starts[i + 1]! : total;
    const hPx = Math.max(1, Math.round((end - s) * scale));
    const part = document.createElement('canvas');
    part.width = canvas.width;
    part.height = hPx;
    const g = part.getContext('2d')!;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, part.width, part.height);
    g.drawImage(canvas, 0, Math.round(s * scale), canvas.width, hPx, 0, 0, canvas.width, hPx);
    if (i > 0) pdf.addPage('a4', 'portrait');
    pdf.addImage(part.toDataURL('image/jpeg', 0.85), 'JPEG', margin, margin, contentW, (hPx / canvas.width) * contentW, undefined, 'FAST');
  });
  return new Uint8Array(pdf.output('arraybuffer'));
}
