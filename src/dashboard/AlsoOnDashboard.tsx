// A chart that repeats a Dashboard card, on another page: folded under a one-line header (its title, 'Also on the
// Dashboard' and a chevron) that is closed every time the page opens (owner: "make it collapse always, if wanted just
// open it"). The chart is only built when opened.
import { useId, useState, type ReactNode } from 'react';
import { t } from '../i18n/t';
import { Icon } from '../icons';

export default function AlsoOnDashboard({ title, testid, children }: { title: string; testid: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <section className="dup-sec" data-testid={testid} data-open={open ? 'yes' : 'no'}>
      <button type="button" className="more-head dup-head" aria-expanded={open} aria-controls={`${id}-body`} onClick={() => setOpen((x) => !x)} data-testid={`${testid}-toggle`}>
        <span className="dup-text"><span className="dup-title">{title}</span> <small className="dup-note">{t('Also on the Dashboard')}</small></span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={16} />
      </button>
      {open && <div id={`${id}-body`} className="dup-body">{children}</div>}
    </section>
  );
}
