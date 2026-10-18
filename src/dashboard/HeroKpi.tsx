// The four hero KPI cards and the dialog behind their (i) buttons.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Sparkline from '../charts/Sparkline';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { useBackClose } from '../mobile/useBackClose';
import { trapTab } from '../util/focusTrap';
import type { KpiInfo } from './kpiInfo';
import '../help/help.css';

/** A small centred dialog with the explanation; Escape, the Close button, the backdrop and Back close it. */
function InfoDialog({ info, onClose, testid = 'kpi-info' }: { info: KpiInfo; onClose: () => void; testid?: string }) {
  useBackClose(true, onClose);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else trapTab(e, ref.current); // Tab stays inside the dialog
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.({ preventScroll: true });
    };
  }, [onClose]);
  return createPortal(
    <div className="info-shade" onClick={onClose}>
      <div className="info-box" role="dialog" aria-modal="true" aria-label={info.title} tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()} data-testid={testid} data-help-id={info.id}>
        <div className="info-head">
          <p className="info-title">{info.title}</p>
          <button type="button" className="info-close" onClick={onClose} aria-label={t('Close')} data-testid="kpi-info-close"><Icon name="close" size={16} /></button>
        </div>
        {info.paragraphs.map((p) => <p key={p} className="info-p">{p}</p>)}
        {info.sections?.map((sec) => (
          <section key={sec.heading} className="info-sec" data-testid={`info-sec-${sec.kind}`}>
            <h3 className="info-h">{sec.heading}</h3>
            {sec.kind === 'formula'
              ? sec.items.map((x) => <p key={x} className="info-formula" data-testid="info-formula">{x}</p>)
              : sec.items.length === 1 ? <p className={sec.kind === 'example' ? 'info-p info-example' : 'info-p'}>{sec.items[0]}</p>
                : <ul className="info-list">{sec.items.map((x) => <li key={x}>{x}</li>)}</ul>}
          </section>
        ))}
      </div>
    </div>,
    document.body,
  );
}

export function InfoButton({ info, testid, dialogTestid, className, title: name }: {
  /** the text, or a function that builds it when the dialog opens (live numbers) */
  info: KpiInfo | (() => KpiInfo); testid?: string; dialogTestid?: string; className?: string;
  /** what the button explains (its accessible name), when `info` is a function */
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const title = name ?? (typeof info === 'function' ? null : info.title);
  return (
    <>
      <button type="button" className={className ? `info-btn ${className}` : 'info-btn'} onClick={(e) => { e.stopPropagation(); setOpen(true); }} aria-haspopup="dialog" aria-expanded={open}
        aria-label={title ? t('How is {k} calculated?', { k: title }) : t('How is this calculated?')} data-testid={testid}>
        <Icon name="info" size={16} />
      </button>
      {open && <InfoDialog info={typeof info === 'function' ? info() : info} onClose={() => setOpen(false)} testid={dialogTestid} />}
    </>
  );
}

export interface SparkData { values: (number | null)[]; format: (n: number) => string; mode: 'daily' | 'weekly' | 'monthly' }

export function HeroKpi({ id, label, shortLabel, value, unavailable, status, sub, change, tone, info, spark }: {
  id: string; label: string; /** shown instead of `label` on a phone; the full label stays the accessible name */ shortLabel?: string; value: string; unavailable?: boolean; /** target status line right under the value */ status?: ReactNode; sub?: ReactNode; change?: ReactNode; tone?: string; info: KpiInfo; spark: SparkData;
}) {
  return (
    <div className="hero-kpi" data-testid={`kpi-${id}`} style={tone ? { borderLeftColor: tone } : undefined}>
      <div className="hero-head">
        <span className="hero-label" title={shortLabel ? label : undefined}>
          {shortLabel ? (<><span className="hl-full">{label}</span><span className="hl-short" aria-hidden="true">{shortLabel}</span></>) : label}
        </span>
        <InfoButton info={info} testid={`kpi-${id}-info`} />
      </div>
      <span className={unavailable ? 'hero-value hero-value--na' : 'hero-value'} style={tone ? { color: tone } : undefined} data-testid={`kpi-${id}-value`}>{value}</span>
      {status}
      {sub && <span className="kpi-sub">{sub}</span>}
      {change}
      <Sparkline values={spark.values} label={label} format={spark.format} unitLabel={spark.mode === 'daily' ? t('daily') : spark.mode === 'weekly' ? t('weekly') : t('monthly')} />
    </div>
  );
}
