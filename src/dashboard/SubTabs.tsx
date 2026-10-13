// Sub-pages of an analysis page as one segmented control (tabs): 44 px tall, arrow keys move between them, the
// choice lives in the address so a view can be linked to.
import { useRef, type KeyboardEvent } from 'react';
import './cards/dashcards.css';

export default function SubTabs<T extends string>({ value, options, onChange, label, testid }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string; testid: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent, i: number) => {
    const k = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : k ? (i + k + options.length) % options.length : -1;
    if (to < 0) return;
    e.preventDefault();
    onChange(options[to]!.value);
    ref.current?.querySelectorAll<HTMLButtonElement>('[role=tab]')[to]?.focus();
  };
  return (
    <div className="subtabs" role="tablist" aria-label={label} ref={ref} data-testid={testid}>
      {options.map((o, i) => (
        <button
          key={o.value} type="button" role="tab" id={`${testid}-${o.value}`} aria-selected={o.value === value} aria-controls={`${testid}-${o.value}-panel`}
          tabIndex={o.value === value ? 0 : -1} className="subtab" onClick={() => onChange(o.value)} onKeyDown={(e) => onKey(e, i)} data-testid={`${testid}-${o.value}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
