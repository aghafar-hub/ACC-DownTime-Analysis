// Timeline view of the Event Explorer: one row per area, one bar per chained event, time on the x axis.
// Shows when stops happened side by side (for example a raw mill stop and then a kiln stop). The overlap line only
// lists stops that share time; it never says that one caused another.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useLiveSearchParams } from '../../hooks/useLiveSearchParams';
import type { EventRow, Startup } from '../../api/types';
import { buildFailureEvents } from '../../calc';
import { ChartCard } from '../../charts/ChartKit';
import { t, tn } from '../../i18n/t';
import { duration } from '../../util/format';
import {
  LABEL_W_DESKTOP, LABEL_W_PHONE, LANE_PX, barBox, blockedBars, chainBars, isDateText, kindLabel, latestStopDate,
  layoutRows, overlapSentence, overlapsInOtherAreas, shiftDate, summaryText, tableRows, ticksFor, timeSpanText, trackWidth, windowFor, windowLabel,
  type TimelineSpan, type TlBar,
} from './timeline';
import { flagLabel } from './eventLabels';
import './timeline.css';

interface Tip { key: string; x: number; y: number }

/** The three stop types with the same colours as the dashboards, plus the patterns that back the colour up. */
function Legend() {
  const sw = (cls: string) => <span className={`tl-sw tl-vis tl-vis--${cls}`} aria-hidden="true" />;
  return (
    <ul className="chart-legend tl-legend" data-testid="tl-legend">
      <li>{sw('failure')}<span>{t('Failure (INC) solid')}</span></li>
      <li>{sw('planned')}<span>{t('Planned (PL) stripes')}</span></li>
      <li>{sw('other')}<span>{t('CIR dots')}</span></li>
      <li><span className="tl-sw tl-vis tl-vis--failure tl-vis--na" aria-hidden="true" /><span>{t('N/A whole area, heavy outline')}</span></li>
      <li><span className="tl-sw tl-vis tl-vis--failure tl-vis--blocked" aria-hidden="true" /><span>{t('Dashed ◆ data problem')}</span></li>
    </ul>
  );
}

function barLabel(b: TlBar): string {
  const notes = [b.continuesBefore ? t('continues from before the window') : '', b.continuesAfter ? t('continues after the window') : '', b.areaLevel ? t('whole area stopped') : '',
    b.blocked ? t('data problem: {flags}', { flags: b.flags.map(flagLabel).join(', ') }) : ''].filter(Boolean);
  return [`${b.areaId}`, b.code, b.reason || t('(blank)'), timeSpanText(b), duration(b.totalHours * 3600), b.classification, kindLabel(b.kind), ...notes].join(', ');
}

export default function TimelineView({
  sourceRows, filteredRows, startup, year, mobile, onOpen,
}: {
  sourceRows: EventRow[]; filteredRows: EventRow[]; startup: Startup | null; year: string | number | null; mobile: boolean; onOpen: (eventId: string) => void;
}) {
  const location = useLocation();
  const [params, setParams] = useLiveSearchParams();
  const [showAll, setShowAll] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // chains come from the existing chaining (voided and blocked rows are left out); a chain stays when one of its rows passes the filters
  const chains = useMemo(() => buildFailureEvents(sourceRows).chains, [sourceRows]);
  const allowed = useMemo(() => new Set(filteredRows.map((r) => r.event_id)), [filteredRows]);
  const kept = useMemo(() => chains.filter((c) => c.rows.some((r) => allowed.has(r.event_id))), [chains, allowed]);
  const latest = useMemo(() => latestStopDate(sourceRows), [sourceRows]);

  const span: TimelineSpan = params.get('span') === 'week' ? 'week' : 'day';
  const dateParam = params.get('date');
  const date = isDateText(dateParam) ? dateParam : latest ?? new Date().toISOString().slice(0, 10);
  const win = useMemo(() => windowFor(span, date), [span, date]);

  const setView = (next: { span?: TimelineSpan; date?: string | null }) => {
    setParams((cur) => {
      const p = new URLSearchParams(cur);
      if (next.span) { if (next.span === 'week') p.set('span', 'week'); else p.delete('span'); }
      if (next.date === null) p.delete('date'); else if (next.date) p.set('date', next.date);
      return p;
    }, { replace: true, state: location.state });
    setSel(null);
    setTip(null);
  };

  const known = useMemo(() => new Set(startup?.areas.map((a) => a.area_id) ?? []), [startup]);
  const blocked = useMemo(() => blockedBars(filteredRows, win, known), [filteredRows, win, known]);
  const bars = useMemo(() => [...chainBars(kept, win), ...blocked.bars].filter((b) => known.has(b.areaId)), [kept, win, blocked.bars, known]);
  const groups = useMemo(() => layoutRows(bars, startup?.areas ?? [], startup?.lines ?? [], showAll), [bars, startup, showAll]);
  const byKey = useMemo(() => new Map(bars.map((b) => [b.key, b])), [bars]);
  const selected = sel ? byKey.get(sel) ?? null : null;
  const others = useMemo(() => (selected ? overlapsInOtherAreas(selected, bars) : []), [selected, bars]);
  const otherKeys = useMemo(() => new Set(others.map((b) => b.key)), [others]);
  const summary = summaryText(bars, win);
  const rowCount = groups.reduce((n, g) => n + g.rows.length, 0);

  useEffect(() => {
    if (!tip) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setTip(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tip]);

  const showTip = (key: string, el: HTMLElement, mouse?: { x: number; y: number }) => {
    const wrap = wrapRef.current?.getBoundingClientRect();
    if (!wrap) return;
    const r = el.getBoundingClientRect();
    setTip({ key, x: (mouse ? mouse.x : r.left + r.width / 2) - wrap.left, y: r.bottom - wrap.top + 4 });
  };

  const tipBar = tip ? byKey.get(tip.key) ?? null : null;
  const labelW = mobile ? LABEL_W_PHONE : LABEL_W_DESKTOP;
  const selText = selected ? `${selected.areaId} · ${selected.code} · ${selected.reason || t('(blank)')} · ${timeSpanText(selected)} · ${duration(selected.totalHours * 3600)} · ${selected.classification}` : '';

  return (
    <div ref={wrapRef} className="tl-wrap" data-testid="timeline-view">
      <section className="tl-toolbar" aria-label={t('Timeline window')}>
        <div className="seg" role="group" aria-label={t('Window length')} data-testid="tl-span">
          <button type="button" className="seg-btn" aria-pressed={span === 'day'} onClick={() => setView({ span: 'day' })} data-testid="tl-day">{t('Day')}</button>
          <button type="button" className="seg-btn" aria-pressed={span === 'week'} onClick={() => setView({ span: 'week' })} data-testid="tl-week">{t('Week')}</button>
        </div>
        <button type="button" className="btn tl-ctl" onClick={() => setView({ date: shiftDate(span, date, -1) })} aria-label={span === 'day' ? t('Previous day') : t('Previous week')} data-testid="tl-prev">‹ {t('Previous')}</button>
        <div className="field tl-date">
          <label htmlFor="tl-date">{t('Date')}</label>
          <input id="tl-date" className="input mono tl-ctl" type="date" value={date} onChange={(e) => isDateText(e.target.value) && setView({ date: e.target.value })} data-testid="tl-date" />
        </div>
        <button type="button" className="btn tl-ctl" onClick={() => setView({ date: shiftDate(span, date, 1) })} aria-label={span === 'day' ? t('Next day') : t('Next week')} data-testid="tl-next">{t('Next')} ›</button>
        <button type="button" className="btn tl-ctl" onClick={() => setView({ date: null })} disabled={!latest || (latest === date && !dateParam)} data-testid="tl-latest">{t('Latest event')}</button>
        <button type="button" className={showAll ? 'chip chip--on tl-ctl' : 'chip tl-ctl'} aria-pressed={showAll} onClick={() => setShowAll((v) => !v)} data-testid="tl-show-all">{t('Show all areas')}</button>
      </section>

      <ChartCard
        testid="chart-timeline"
        help={{ id: 'events-timeline' }}
        title={t('Stops by area')}
        subtitle={`${windowLabel(win)} · ${t('plant time')} · ${year ?? ''}`}
        summary={summary}
        table={{ head: [t('Area'), t('Code'), t('Reason'), t('Start'), t('End'), t('Hours'), t('Class')], rows: tableRows(groups) }}
        footnote={t('Hours count only the part of a stop inside the window. A stop that continues past the window edge is cut there and marked.')}
      >
        {(width) => {
          const track = trackWidth(span, width - labelW);
          const msPerPx = (win.toMs - win.fromMs) / track;
          const px = (ms: number): number => (ms - win.fromMs) / msPerPx;
          const step = span === 'day' ? track / 24 : track / 7;
          const ticks = ticksFor(win, track);
          return (
            <>
              <Legend />
              {blocked.undrawable > 0 && (
                <p className="callout tl-note" role="status" data-testid="tl-undrawable">
                  {tn(blocked.undrawable, '{n} record in this window cannot be drawn', '{n} records in this window cannot be drawn')}
                  {' ('}{t('see ')}<Link to="/validate" data-testid="tl-validate-link">{t('Validate')}</Link>{')'}
                </p>
              )}
              {rowCount === 0 ? (
                <p className="callout tl-note" role="status" data-testid="tl-empty">{t('No stops in this window. Use Previous, Next or the date to look at another {unit}, or Latest event.', { unit: span === 'day' ? t('day') : t('week') })}</p>
              ) : (
                <div className="tl-scroll" data-testid="tl-scroll" tabIndex={-1}>
                  <div className="tl" style={{ width: labelW + track, ['--tl-label' as string]: `${labelW}px`, ['--tl-step' as string]: `${step}px`, ['--tl-lane' as string]: `${LANE_PX}px` }} role="group" aria-label={t('Stops by area, {w}', { w: windowLabel(win) })}>
                    <div className="tl-axis">
                      <div className="tl-label tl-label--axis"><span className="tl-axis-title">{span === 'day' ? t('Hour') : t('Day')}</span></div>
                      <div className="tl-track tl-track--axis" style={{ width: track }} aria-hidden="true">
                        {ticks.map((k) => (
                          <span key={k.ms} className={k.major ? 'tl-tick tl-tick--major' : 'tl-tick'} style={{ left: px(k.ms) }}>{k.label}</span>
                        ))}
                      </div>
                    </div>
                    {groups.map((g) => (
                      <div key={g.lineId} className="tl-group" data-testid="tl-group">
                        <div className="tl-group-head"><span>{g.name}</span></div>
                        {g.rows.map((r) => (
                          <div key={r.areaId} className="tl-row" data-testid="tl-row" data-area={r.areaId} style={{ height: r.lanes * LANE_PX }}>
                            <div className="tl-label" title={`${r.areaId} · ${r.name}`}>
                              <b>{r.areaId}</b>
                              <span>{r.name}</span>
                            </div>
                            <div className="tl-track" style={{ width: track }}>
                              {r.bars.map((b) => {
                                const box = barBox(px(b.fromMs), px(b.toMs), track);
                                const cls = ['tl-bar', b.key === sel ? 'is-selected' : '', otherKeys.has(b.key) ? 'is-overlap' : ''].filter(Boolean).join(' ');
                                const vis = ['tl-vis', `tl-vis--${b.kind}`, b.areaLevel ? 'tl-vis--na' : '', b.blocked ? 'tl-vis--blocked' : '', b.continuesBefore ? 'tl-vis--cut-l' : '', b.continuesAfter ? 'tl-vis--cut-r' : ''].filter(Boolean).join(' ');
                                return (
                                  <button
                                    key={b.key} type="button" className={cls} data-testid="timeline-bar" data-key={b.key} data-area={b.areaId} data-kind={b.kind}
                                    data-arealevel={b.areaLevel ? 'true' : 'false'} data-blocked={b.blocked ? 'true' : 'false'} data-overlap={otherKeys.has(b.key) ? 'true' : 'false'}
                                    data-selected={b.key === sel ? 'true' : 'false'} data-continues={b.continuesBefore || b.continuesAfter ? 'true' : 'false'}
                                    aria-label={barLabel(b)}
                                    style={{ left: box.hitLeft, width: box.hitWidth, top: b.lane * LANE_PX, height: LANE_PX }}
                                    onPointerEnter={(e) => e.pointerType === 'mouse' && showTip(b.key, e.currentTarget, { x: e.clientX, y: 0 })}
                                    onPointerLeave={(e) => e.pointerType === 'mouse' && setTip(null)}
                                    onFocus={(e) => { setSel(b.key); if (e.currentTarget.matches(':focus-visible')) showTip(b.key, e.currentTarget); }}
                                    onBlur={() => setTip(null)}
                                    onClick={() => { setSel(b.key); setTip(null); onOpen(b.key); }}
                                  >
                                    <span className={vis} style={{ left: box.barLeft, width: box.barWidth }}>
                                      {b.blocked && box.barWidth >= 14 && <span className="tl-glyph" aria-hidden="true">◆</span>}
                                      {b.areaLevel && box.barWidth >= 34 && <span className="tl-glyph tl-glyph--na" aria-hidden="true">N/A</span>}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="tl-readout" role="status" aria-live="polite" data-testid="tl-readout">
                {selected ? (
                  <>
                    <p className="tl-selected" data-testid="tl-selected"><b>{selText}</b></p>
                    <p className="tl-overlap" data-testid="tl-overlap-line">{overlapSentence(others)}</p>
                  </>
                ) : (
                  <p className="tl-hint" data-testid="tl-overlap-line">{t('Select a stop to see which stops in other areas overlap it in time. This shows timing only, not cause.')}</p>
                )}
              </div>
            </>
          );
        }}
      </ChartCard>

      {tip && tipBar && (
          <div className="chart-tip tl-tip" aria-hidden="true" style={{ left: Math.max(0, Math.min(tip.x - 100, (wrapRef.current?.clientWidth ?? 600) - 260)), top: tip.y }} data-testid="tl-tip">
            <b className="chart-tip-title">{tipBar.areaId} · {tipBar.code}</b>
            <div className="chart-tip-row"><span>{t('Reason')}</span><b>{tipBar.reason || t('(blank)')}</b></div>
            <div className="chart-tip-row"><span>{t('Time')}</span><b>{timeSpanText(tipBar)}</b></div>
            <div className="chart-tip-row"><span>{t('Duration')}</span><b>{duration(tipBar.totalHours * 3600)}</b></div>
            <div className="chart-tip-row"><span>{t('Class')}</span><b>{tipBar.classification} · {kindLabel(tipBar.kind)}</b></div>
            {tipBar.areaLevel && <div className="chart-tip-row"><span>{t('Scope')}</span><b>{t('Whole area stopped')}</b></div>}
            {(tipBar.continuesBefore || tipBar.continuesAfter) && <div className="chart-tip-row"><span>{t('Window')}</span><b>{tipBar.continuesBefore ? t('continues from before') : t('continues after')}</b></div>}
            {tipBar.blocked && <div className="chart-tip-row"><span>{t('Data')}</span><b>{tipBar.flags.map(flagLabel).join(', ')}</b></div>}
          </div>
      )}
    </div>
  );
}
