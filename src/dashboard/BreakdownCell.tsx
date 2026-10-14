// A number in the By area table that opens its split by classification: hover with a mouse, tap, click or Enter /
// Space with the keyboard. Escape, a tap elsewhere or scrolling closes it. Drawn on <body> (fixed, kept on screen) so the
// scrolling table does not cut it off. The parts are rounded so they add up to the number in the cell.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { clampTipShift } from '../charts/ChartKit';
import { t } from '../i18n/t';
import { roundParts, sharePcts, type Split } from './areaBreakdown';

const CLASS_NAME: Record<string, string> = {
  PRO: 'Production', MEC: 'Mechanical', ELE: 'Electrical', AUT: 'Automation', PL: 'Planned', CIR: 'CIR', Other: 'Other',
};

export default function BreakdownCell({ split, text, decimals, unit, title, testid }: {
  split: Split;
  /** the cell's number as shown */
  text: string;
  /** decimals of the shown parts (hours 1, counts 0) */
  decimals: number;
  /** 'h' or '' */
  unit: string;
  /** 'Stopped h of 141' */
  title: string;
  testid: string;
}) {
  const [open, setOpen] = useState<null | 'hover' | 'pinned'>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const id = useId();
  const kind = useRef('mouse');
  /** closed with Escape while the mouse is on the cell: no hover reopening until the mouse leaves */
  const quiet = useRef(false);
  const close = useCallback(() => setOpen(null), []);

  const values = split.parts.map((p) => p.value);
  const shown = roundParts(values, decimals);
  const pcts = sharePcts(values);
  const fmt = (n: number) => n.toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

  useLayoutEffect(() => {
    if (!open || !btn.current) { setPos(null); return; }
    const r = btn.current.getBoundingClientRect();
    setPos({ left: r.left, top: r.bottom + 4 });
  }, [open]);
  useLayoutEffect(() => {
    const el = pop.current;
    const b = btn.current;
    if (!el || !b || !pos) return;
    el.style.translate = '';
    // no room below the cell: open above it (never over the number, so the pointer stays on the cell)
    const r = b.getBoundingClientRect();
    const h = el.getBoundingClientRect().height;
    const top = r.bottom + 4 + h > window.innerHeight - 8 && r.top - 4 - h >= 8 ? r.top - 4 - h : r.bottom + 4;
    el.style.top = `${top}px`;
    const s = clampTipShift(el.getBoundingClientRect(), { left: 0, top: 0, right: document.documentElement.clientWidth || window.innerWidth, bottom: window.innerHeight });
    if (s.dx) el.style.translate = `${s.dx}px 0`;
  }, [pos]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { quiet.current = true; close(); btn.current?.focus(); } };
    const onDoc = (e: Event) => {
      if (e.target instanceof Node && (btn.current?.contains(e.target) || pop.current?.contains(e.target))) return;
      close();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDoc);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDoc);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open, close]);

  const hover = (e: RPointerEvent, on: boolean) => {
    kind.current = e.pointerType;
    if (e.pointerType !== 'mouse') return;
    if (!on) quiet.current = false;
    else if (quiet.current) return;
    setOpen((cur) => (cur === 'pinned' ? cur : on ? 'hover' : null));
  };

  return (
    <>
      <button
        ref={btn} type="button" className="bd-btn" aria-expanded={!!open} aria-controls={open ? id : undefined}
        aria-label={`${title}: ${text}. ${t('Show the split by classification')}`}
        onPointerEnter={(e) => hover(e, true)} onPointerLeave={(e) => hover(e, false)}
        onPointerDown={(e) => { kind.current = e.pointerType; }}
        onClick={() => { quiet.current = false; setOpen((cur) => (cur === 'pinned' ? null : 'pinned')); }}
        data-testid={testid}
      >
        {text}
      </button>
      {open && createPortal(
        <div
          ref={pop} id={id} className="bd-pop" role="dialog" aria-label={title} data-testid="breakdown-pop"
          style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
          onPointerEnter={(e) => hover(e, true)} onPointerLeave={(e) => hover(e, false)}
        >
          <b className="bd-title">{title}</b>
          <table className="bd-table">
            <tbody>
              {split.parts.map((p, i) => (
                <tr key={p.key} data-testid="breakdown-row" data-key={p.key}>
                  <th scope="row"><abbr title={t(CLASS_NAME[p.key] ?? p.key)}>{p.key}</abbr></th>
                  <td className="num" data-testid="breakdown-value">{fmt(shown[i]!)}{unit ? ` ${unit}` : ''}</td>
                  <td className="num muted" data-testid="breakdown-pct">{pcts[i]!.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><th scope="row">{t('Total')}</th><td className="num" data-testid="breakdown-total">{fmt(shown.reduce((s, v) => s + v, 0))}{unit ? ` ${unit}` : ''}</td><td className="num muted">{split.total > 0 ? '100.0%' : '–'}</td></tr>
            </tfoot>
          </table>
        </div>,
        document.body,
      )}
    </>
  );
}
