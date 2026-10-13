// The report as pages: cover, table of contents, then the sections laid out on A4 pages. The page layout is measured in
// the browser (every block is rendered once off screen, its height read) and decided by the pure paginate() function,
// so what is on screen is exactly what is printed: the same fixed-size pages, header, footer and page numbers. On a
// narrow screen the pages are scaled down to the width (CSS transform on screen only).
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMeasure } from '../charts/ChartKit';
import { dayLabel } from '../dashboard/format';
import { t } from '../i18n/t';
import { APP_NAME } from '../config';
import { anchorId, periodText, sectionBlocks, type Block, type SectionBlocks } from './blocks';
import type { ReportModel } from './model';
import { paginate, type PageSpec, type Sizes, type TableSize } from './paginate';
import ReportTableView from './ReportTableView';
import { SECTION_BY_ID, SECTION_GROUPS } from './sections';

export const PAGE_W = 794;
export const PAGE_H = 1123;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '2026-10-13 11:00' -> '13 Oct 2026, 11:00' */
export function generatedText(ts: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2})/.exec(ts);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}, ${m[4]}` : ts;
}

// ---------------------------------------------------------------- cover and contents

function Cover({ m }: { m: ReportModel }) {
  const base = import.meta.env.BASE_URL;
  const period = m.effective && (m.effective.from !== m.range.from || m.effective.to !== m.range.to) ? m.effective : m.range;
  const rows: [string, string][] = [
    [t('Period'), periodText(m.range)],
    [t('Compared with'), m.compare.on && m.compare.range ? `${m.compare.label}: ${periodText(m.compare.range)}` : t('No comparison')],
    [t('Filters'), m.filterSummary],
    [t('Data coverage'), m.coverage ? t('Data covers {a} to {b}', { a: dayLabel(m.coverage.from), b: dayLabel(m.coverage.to) }) : t('No data has been loaded')],
    [t('Generated'), `${generatedText(m.generatedAt)} ${t('by')} ${m.generatedBy}`],
  ];
  return (
    <div className="rpt-cover" data-testid="rpt-cover">
      <img className="rpt-cover-logo" src={`${base}brand/acc-logo-full.png`} alt={t('Arabian Cement Company')} width={150} height={79} />
      <div className="rpt-cover-main">
        <p className="rpt-cover-eyebrow">{APP_NAME} · {t('{p} Plant', { p: m.plant })}</p>
        <h1 className="rpt-cover-title" data-testid="rpt-title">{m.title}</h1>
        <p className="rpt-cover-period">{periodText(period)}</p>
        <div className="rpt-cover-rule" aria-hidden="true" />
        <dl className="rpt-cover-facts">
          {rows.map(([k, v]) => (
            <Fragment key={k}>
              <dt>{k}</dt>
              <dd data-testid={`rpt-cover-${k.toLowerCase().replace(/\W+/g, '-')}`}>{v}</dd>
            </Fragment>
          ))}
        </dl>
      </div>
      <p className="rpt-cover-foot">{t('Arabian Cement Company')} · {t('{p} Plant', { p: m.plant })}</p>
    </div>
  );
}

function scrollToSection(e: React.MouseEvent, id: string) {
  e.preventDefault();
  document.getElementById(anchorId(id))?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function Toc({ entries }: { entries: { id: string; title: string; page: number }[] }) {
  const groups = SECTION_GROUPS.map((g) => ({ g, items: entries.filter((e) => SECTION_BY_ID[e.id as keyof typeof SECTION_BY_ID]?.group === g.id) })).filter((x) => x.items.length > 0);
  return (
    <div className="rpt-toc" data-testid="rpt-toc">
      <header className="rpt-sec-head">
        <p className="rpt-eyebrow">{t('Report')}</p>
        <h2 className="rpt-h2" id="rpt-toc-title">{t('Contents')}</h2>
      </header>
      {groups.map(({ g, items }) => (
        <div key={g.id} className="rpt-toc-group">
          <p className="rpt-toc-gh">{t(g.label)}</p>
          <ol>
            {items.map((e) => (
              <li key={e.id}>
                <a href={`#${anchorId(e.id)}`} onClick={(ev) => scrollToSection(ev, e.id)} data-testid="rpt-toc-link" data-section={e.id}>
                  <span className="rpt-toc-name">{e.title}</span>
                  <span className="rpt-toc-leader" aria-hidden="true" />
                  <span className="rpt-toc-page">{e.page}</span>
                </a>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- measuring

function renderBlockForMeasure(b: Block): ReactNode {
  if (b.kind === 'node') return b.node;
  return <ReportTableView table={b.table} caption={b.caption} cell={b.cell} className={b.className} />;
}

/** Reads the height of every block (and of every row of every table) from the off-screen copy. */
function measure(root: HTMLElement, sections: SectionBlocks[]): { sizes: Sizes; pageHeight: number } | null {
  const ref = root.querySelector<HTMLElement>('.rpt-ref');
  if (!ref) return null;
  const sizes: Sizes = new Map();
  for (const sec of sections) {
    for (const b of sec.blocks) {
      const el = root.querySelector<HTMLElement>(`[data-mk="${CSS.escape(b.key)}"]`);
      if (!el) return null;
      const h = el.getBoundingClientRect().height;
      if (b.kind === 'node') { sizes.set(b.key, h); continue; }
      const cap = el.querySelector<HTMLElement>('.rpt-tcap')?.getBoundingClientRect().height ?? 0;
      const head = el.querySelector<HTMLElement>('thead')?.getBoundingClientRect().height ?? 0;
      const rows = [...el.querySelectorAll<HTMLElement>('tbody tr')].map((r) => r.getBoundingClientRect().height);
      const cols = [...el.querySelectorAll<HTMLElement>('thead th')].map((c) => c.getBoundingClientRect().width);
      const pad = Math.max(0, h - cap - head - rows.reduce((a, x) => a + x, 0));
      const size: TableSize = { caption: cap, head, rows, pad, cols };
      sizes.set(b.key, size);
    }
  }
  return { sizes, pageHeight: ref.getBoundingClientRect().height };
}

// ---------------------------------------------------------------- the document

export interface DocumentInfo { pages: number; sections: number }

export default function ReportDocument({ model, onLayout }: { model: ReportModel; onLayout?: (info: DocumentInfo) => void }) {
  const hasCover = model.sections.some((s) => s.id === 'cover');
  const sections = useMemo(() => model.sections.filter((s) => s.id !== 'cover').map((s) => sectionBlocks(s, model)), [model]);
  const hasToc = sections.length >= 2;
  const measureRef = useRef<HTMLDivElement>(null);
  const [fontsTick, setFontsTick] = useState(0);
  const [layout, setLayout] = useState<{ pages: PageSpec[]; sizes: Sizes; token: object } | null>(null);
  const [wrapRef, wrapW] = useMeasure<HTMLDivElement>();

  // fonts arriving later change text widths: lay out again
  useEffect(() => {
    let live = true;
    const bump = () => live && setFontsTick((n) => n + 1);
    void document.fonts?.ready.then(bump);
    document.fonts?.addEventListener?.('loadingdone', bump);
    return () => {
      live = false;
      document.fonts?.removeEventListener?.('loadingdone', bump);
    };
  }, []);

  // The off-screen copy exists only while measuring (a second copy of every chart would also double every test id). A
  // layout belongs to one token (the sections and the font state it was measured with); a new token means measure again.
  const token = useMemo(() => ({}), [sections, fontsTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const measuring = !layout || layout.token !== token;
  useLayoutEffect(() => {
    const root = measureRef.current;
    if (!measuring || !root) return;
    const m = measure(root, sections);
    if (!m) return;
    setLayout({
      token, sizes: m.sizes,
      pages: paginate(sections.map((s) => ({ id: s.id, blocks: s.blocks.map((b) => ({ key: b.key, kind: b.kind, keepNext: b.keepNext })) })), m.sizes, m.pageHeight),
    });
  }, [sections, measuring, token]);

  const front = (hasCover ? 1 : 0) + (hasToc ? 1 : 0);
  const pages = layout && !measuring ? layout.pages : [];
  const total = pages.length + front;
  const startPage = useMemo(() => {
    const first = new Map<string, number>();
    pages.forEach((p, i) => { if (p.first) first.set(p.sectionId, i + 1 + front); });
    return first;
  }, [pages, front]);

  useEffect(() => {
    if (layout && !measuring) onLayout?.({ pages: total, sections: sections.length });
  }, [layout, measuring, total, sections.length, onLayout]);

  // images (the logo) must be decoded before the page is called ready, or a PDF taken right away misses them
  const [imagesReady, setImagesReady] = useState(false);
  useEffect(() => {
    if (!layout) return;
    let live = true;
    const imgs = [...(wrapRef.current?.querySelectorAll('img') ?? [])] as HTMLImageElement[];
    void Promise.all(imgs.map((i) => (i.complete ? Promise.resolve() : i.decode().catch(() => undefined)))).then(() => live && setImagesReady(true));
    return () => { live = false; };
  }, [layout, wrapRef]);

  const scale = wrapW > 0 ? Math.min(1, wrapW / PAGE_W) : 1;
  const byKey = useMemo(() => {
    const m = new Map<string, Block>();
    for (const s of sections) for (const b of s.blocks) m.set(b.key, b);
    return m;
  }, [sections]);

  const frame = (n: number, kind: 'cover' | 'toc' | 'section', body: ReactNode) => (
    <div key={n} className="rpt-frame" style={{ width: PAGE_W * scale, height: PAGE_H * scale }}>
      <article className={`rpt-page rpt-page--${kind}`} data-testid="rpt-page" data-page={n} data-kind={kind} style={{ transform: `scale(${scale})` }}>
        {kind !== 'cover' && (
          <header className="rpt-ph">
            <span className="rpt-ph-title"><b>{model.title}</b> · {t('{p} Plant', { p: model.plant })}</span>
            <span>{periodText(model.range)}</span>
          </header>
        )}
        {body}
        {kind !== 'cover' && (
          <footer className="rpt-pf">
            <span>{t('Generated {when} by {who}', { when: generatedText(model.generatedAt), who: model.generatedBy })}</span>
            <span data-testid="rpt-page-no">{t('Page {n} of {m}', { n, m: total })}</span>
          </footer>
        )}
      </article>
    </div>
  );

  const tocEntries = sections.map((s) => ({ id: s.id, title: s.title, page: startPage.get(s.id) ?? 0 }));
  let pageNo = 0;
  const out: ReactNode[] = [];
  if (layout && !measuring) {
    if (hasCover) out.push(frame(++pageNo, 'cover', <div className="rpt-pb rpt-pb--cover"><Cover m={model} /></div>));
    if (hasToc) out.push(frame(++pageNo, 'toc', <div className="rpt-pb"><Toc entries={tocEntries} /></div>));
    for (const p of pages) {
      out.push(frame(++pageNo, 'section', (
        <div className="rpt-pb" data-section={p.sectionId}>
          {p.items.map((it) => {
            const b = byKey.get(it.key);
            if (!b) return null;
            if (b.kind === 'node') return <div key={it.key} className="rpt-b">{b.node}</div>;
            const size = layout.sizes.get(b.key) as TableSize | undefined;
            if (!size) return null;
            return (
              <div key={`${it.key}:${it.rows?.[0] ?? 0}`} className="rpt-b rpt-b--table">
                <ReportTableView table={b.table} rows={it.rows} widths={size.cols} caption={b.caption} continued={it.continued} cell={b.cell} className={b.className} testid="rpt-table" />
              </div>
            );
          })}
        </div>
      )));
    }
  }

  return (
    <div className="rpt-doc" ref={wrapRef} data-testid="report" data-ready={layout && imagesReady && !measuring ? 'true' : 'false'} data-pages={layout ? total : undefined} data-sections={sections.length + (hasCover ? 1 : 0)}>
      <div className="rpt-sheets">{out}</div>
      {/* off-screen copy used to measure; never printed */}
      {measuring && (
        <div className="rpt-measure rpt-page" ref={measureRef} aria-hidden="true">
          <div className="rpt-pb rpt-ref" />
          <div className="rpt-mcol">
            {sections.flatMap((s) => s.blocks.map((b) => <div key={b.key} data-mk={b.key} className="rpt-b">{renderBlockForMeasure(b)}</div>))}
          </div>
        </div>
      )}
    </div>
  );
}
