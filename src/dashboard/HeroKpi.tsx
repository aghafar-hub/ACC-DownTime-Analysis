// The four hero KPI cards and the dialog behind their (i) buttons.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Sparkline from '../charts/Sparkline';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { useBackClose } from '../mobile/useBackClose';
import type { KpiInfo } from './kpiInfo';

/** A small centred dialog with the explanation; Escape, the Close button, the backdrop and Back close it. */
function InfoDialog({ info, onClose }: { info: KpiInfo; onClose: () => void }) {
  useBackClose(true, onClose);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.({ preventScroll: true });
    };
  }, [onClose]);
  return createPortal(
    <div className="info-shade" onClick={onClose}>
      <div className="info-box" role="dialog" aria-modal="true" aria-label={info.title} tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()} data-testid="kpi-info">
        <div className="info-head">
          <p className="info-title">{info.title}</p>
          <button type="button" className="info-close" onClick={onClose} aria-label={t('Close')} data-testid="kpi-info-close"><Icon name="close" size={16} /></button>
        </div>
        {info.paragraphs.map((p) => <p key={p} className="info-p">{p}</p>)}
      </div>
    </div>,
    document.body,
  );
}

export function InfoButton({ info, testid }: { info: KpiInfo; testid?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="info-btn" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}
        aria-label={t('How is {k} calculated?', { k: info.title })} data-testid={testid}>
        <Icon name="info" size={16} />
      </button>
      {open && <InfoDialog info={info} onClose={() => setOpen(false)} />}
    </>
  );
}

export interface SparkData { values: (number | null)[]; format: (n: number) => string; mode: 'daily' | 'monthly' }

export function HeroKpi({ id, label, value, unavailable, sub, change, tone, info, spark }: {
  id: string; label: string; value: string; unavailable?: boolean; sub?: ReactNode; change?: ReactNode; tone?: string; info: KpiInfo; spark: SparkData;
}) {
  return (
    <div className="hero-kpi" data-testid={`kpi-${id}`} style={tone ? { borderLeftColor: tone } : undefined}>
      <div className="hero-head">
        <span className="hero-label">{label}</span>
        <InfoButton info={info} testid={`kpi-${id}-info`} />
      </div>
      <span className={unavailable ? 'hero-value hero-value--na' : 'hero-value'} style={tone ? { color: tone } : undefined} data-testid={`kpi-${id}-value`}>{value}</span>
      {sub && <span className="kpi-sub">{sub}</span>}
      {change}
      <Sparkline values={spark.values} label={label} format={spark.format} unitLabel={spark.mode === 'daily' ? t('daily') : t('monthly')} />
    </div>
  );
}
