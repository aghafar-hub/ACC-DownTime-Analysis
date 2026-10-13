// Colour + pattern fills for SVG charts and HTML bars (see palette.ts). The pattern is the second cue next to the
// colour, so stacks stay readable in print, for colour-blind readers and in high contrast.
import type { CSSProperties } from 'react';
import type { FillPattern, Paint } from './palette';

const INK = 'rgba(255,255,255,0.55)';

/** SVG <pattern> definitions for the paints; fill a shape with `url(#${paintId(uid, key)})`. */
export function PaintDefs({ uid, paints }: { uid: string; paints: Paint[] }) {
  return (
    <defs>
      {paints.map((p) => (
        <pattern key={p.key} id={paintId(uid, p.key)} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform={p.pattern === 'hatch' ? 'rotate(45)' : p.pattern === 'backhatch' ? 'rotate(-45)' : undefined}>
          <rect width="6" height="6" fill={p.color} />
          {p.pattern === 'hatch' || p.pattern === 'backhatch' ? <rect width="1.6" height="6" fill={INK} /> : null}
          {p.pattern === 'dots' ? <circle cx="3" cy="3" r="1.1" fill={INK} /> : null}
          {p.pattern === 'stripes' ? <rect width="6" height="1.6" fill={INK} /> : null}
          {p.pattern === 'grid' ? <path d="M0 3h6M3 0v6" stroke={INK} strokeWidth="1.2" /> : null}
        </pattern>
      ))}
    </defs>
  );
}

export const paintId = (uid: string, key: string): string => `p-${uid}-${key}`;

/** The same fill for an HTML element (CSS gradients). */
export function paintCss(p: Pick<Paint, 'color' | 'pattern'>): CSSProperties {
  return { background: `${overlay(p.pattern)}${p.color}` };
}

function overlay(pattern: FillPattern): string {
  switch (pattern) {
    case 'hatch': return `repeating-linear-gradient(135deg, ${INK} 0 1.6px, transparent 1.6px 6px), `;
    case 'backhatch': return `repeating-linear-gradient(45deg, ${INK} 0 1.6px, transparent 1.6px 6px), `;
    case 'stripes': return `repeating-linear-gradient(0deg, ${INK} 0 1.6px, transparent 1.6px 6px), `;
    case 'dots': return `radial-gradient(${INK} 1.1px, transparent 1.5px) 0 0 / 6px 6px, `;
    case 'grid': return `linear-gradient(${INK} 1.2px, transparent 1.2px) 0 0 / 6px 6px, linear-gradient(90deg, ${INK} 1.2px, transparent 1.2px) 0 0 / 6px 6px, `;
    default: return '';
  }
}

/** A 14 px legend swatch with the paint. */
export function PaintSwatch({ paint, faded }: { paint: Pick<Paint, 'color' | 'pattern'>; faded?: boolean }) {
  return <span className="paint-sw" aria-hidden="true" style={{ ...paintCss(paint), opacity: faded ? 0.5 : 1 }} />;
}
