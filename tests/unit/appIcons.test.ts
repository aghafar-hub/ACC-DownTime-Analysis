import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The app icon set: the files exist at the pixel sizes the manifest and the page promise.
const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

/** width and height from a PNG's IHDR chunk */
function pngSize(path: string): { w: number; h: number } {
  const b = readFileSync(resolve(ROOT, path));
  expect(b.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

const NAVY = '#0A1627'; // the navy of assets-source/app-icon.png

describe('app icons', () => {
  const cfg = read('vite.config.ts');

  it('the source art is kept and is square', () => {
    const { w, h } = pngSize('assets-source/app-icon.png');
    expect(w).toBe(h);
    expect(w).toBeGreaterThanOrEqual(512);
  });

  it('the manifest lists 192, 512 and a maskable 512 (the same file), and the files have those sizes', () => {
    const entries = [...cfg.matchAll(/\{\s*src:\s*'([^']+)',\s*sizes:\s*'(\d+)x(\d+)',\s*type:\s*'image\/png'(?:,\s*purpose:\s*'(\w+)')?\s*\}/g)].map((m) => ({
      src: m[1], w: Number(m[2]), h: Number(m[3]), purpose: m[4] ?? 'any',
    }));
    expect(entries.map((e) => `${e.src}:${e.w}:${e.purpose}`)).toEqual([
      'icons/pwa-192.png:192:any',
      'icons/pwa-512.png:512:any',
      'icons/pwa-512.png:512:maskable',
    ]);
    // no second copy of the same picture (phase 5: the maskable entry reuses the 512 file)
    expect(existsSync(resolve(ROOT, 'public/icons/pwa-maskable-512.png'))).toBe(false);
    for (const e of entries) {
      expect(existsSync(resolve(ROOT, 'public', e.src)), e.src).toBe(true);
      expect(pngSize(`public/${e.src}`), e.src).toEqual({ w: e.w, h: e.h });
    }
  });

  it('the manifest colours are the icon navy', () => {
    expect(cfg).toMatch(new RegExp(`background_color:\\s*'${NAVY}'`, 'i'));
    expect(cfg).toMatch(new RegExp(`theme_color:\\s*'${NAVY}'`, 'i'));
  });

  it('the page links the favicon and the apple touch icon, and the files have the right sizes', () => {
    const html = read('index.html');
    const sizes: Record<string, number> = { 'icons/favicon-16.png': 16, 'icons/favicon-32.png': 32, 'icons/apple-touch-icon.png': 180 };
    for (const [file, px] of Object.entries(sizes)) {
      expect(html, file).toContain(`/${file}`);
      expect(pngSize(`public/${file}`), file).toEqual({ w: px, h: px });
    }
    expect(html).toContain('/favicon.ico');
    const ico = readFileSync(resolve(ROOT, 'public/favicon.ico'));
    expect(ico.readUInt16LE(0)).toBe(0); // reserved
    expect(ico.readUInt16LE(2)).toBe(1); // icon type
    expect(ico.readUInt16LE(4)).toBeGreaterThanOrEqual(2); // 16 and 32 px images at least
  });
});
