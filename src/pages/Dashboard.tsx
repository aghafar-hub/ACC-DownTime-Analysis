// The Dashboard (docs/redesign R2): the KPI row and twelve question cards in a fixed order, then Month vs month,
// Data quality and the Areas table as compact sections. Every card names its scope and opens exactly its records.
import { useCallback, useMemo, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { typePaints } from '../charts/palette';
import { useIsMobile } from '../hooks/useIsMobile';
import DashTop from '../dashboard/DashTop';
import { compareShort, kpiSparks } from '../dashboard/dashModels';
import MonthCompare from '../dashboard/MonthCompare';
import { overviewModel } from '../dashboard/models';
import { EMPTY_SCOPE_TAKEAWAY, EmptyScope, NoData, rowsInRange, useDrill } from '../dashboard/parts';
import { overviewTakeaway } from '../dashboard/takeaways';
import { useDash } from '../dashboard/useDash';
import KpiRow from '../dashboard/cards/KpiRow';
import TrendCard from '../dashboard/cards/TrendCard';
import { AreaDownCard, AreaTargetCard, ClassCard, LossesCard, PlannedCard } from '../dashboard/cards/BreakdownCards';
import { AttentionCard, DailyCard, FailMttrCard, HeatCard, RepeatsCard } from '../dashboard/cards/ReliabilityCards';
import { AreasSection, QualitySection } from '../dashboard/cards/Sections';
import type { OpenSpec } from '../dashboard/cards/DashCard';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import SinceLastVisit from '../notifications/SinceLastVisit';
import { useTheme } from '../theme/ThemeContext';
import { monthShort, monthText } from '../util/dates';
import '../components/ui.css';
import '../dashboard/dashboard.css';
import '../dashboard/cards/dashcards.css';

export default function Dashboard() {
  const dash = useDash();
  const { ctx } = dash;
  const { dark } = useTheme();
  const mobile = useIsMobile();
  const navigate = useNavigate();
  const drill = useDrill(dash, 'Dashboard');
  const onOpen = useCallback((s: OpenSpec) => drill(s.label, { eventIds: s.ids }), [drill]);
  const model = useMemo(() => (ctx ? overviewModel(ctx) : null), [ctx]);
  const sparks = useMemo(() => (ctx ? kpiSparks(ctx) : null), [ctx]);
  const rows = useMemo(() => (ctx ? rowsInRange(ctx.scope, ctx.win.range) : null), [ctx]);
  const kpi = model?.kpi ?? null;
  const basis = ctx?.master.settings.availabilityBasis ?? 'B';
  const classNames = useMemo(() => new Map((dash.startup?.classifications ?? []).map((c) => [c.code as string, c.name])), [dash.startup]);
  const paints = typePaints(dark);
  const vars = { '--dt-inc': paints[0]!.color, '--dt-pl': paints[1]!.color, '--dt-cir': paints[2]!.color } as CSSProperties;

  // the filters leave no record in the range: no figures computed from nothing
  const empty = !!kpi && rows !== null && rows.length === 0;
  const takeaway = !ctx || !model
    ? t('Loading…')
    : empty ? t(EMPTY_SCOPE_TAKEAWAY) : overviewTakeaway({
      kpi: kpi ? { downtimeHours: kpi.total.downtimeHours, topArea: kpi.topArea } : null,
      noDataReason: model.noDataReason, downtimeChange: model.downtimeChange, compare: model.compare,
    });
  const cmpLabel = ctx ? (compareShort(ctx) || t('vs previous period')) : '';
  const c = ctx?.win.compareRange ?? null;
  const prevLabel = c && c.from.slice(0, 7) === c.to.slice(0, 7) ? monthShort(c.from) : '';
  const lines = ctx ? new Set(ctx.base.areaIds.map((a) => ctx.master.index.areaById.get(a)?.line_id ?? '')).size : 0;
  const right = ctx && (
    <span className="dash-head-right">
      {!mobile && (
        <span className="dash-compared" data-testid="dash-compared">
          {c ? `${t('Compared with')} ${c.from.slice(0, 7) === c.to.slice(0, 7) ? monthText(c.from) : t('the previous period')} · ` : ''}
          {t('{n} areas', { n: ctx.base.areaIds.length })} · {t('{n} lines', { n: lines })}
        </span>
      )}
      <button type="button" className="btn btn-sm" onClick={dash.reload} disabled={dash.data.state.refreshing || dash.data.state.loading} data-testid="refresh">
        <Icon name="sync" size={14} /> {dash.data.state.refreshing ? t('Refreshing…') : t('Refresh')}
      </button>
    </span>
  );

  return (
    <div className="page dash-page dash-v2" data-testid="page-overview" style={vars}>
      <DashTop title={t('Dashboard')} takeaway={takeaway} dash={dash} eventCount={rows ? rows.length : null} belowTakeaway={<SinceLastVisit />} right={right} />
      {ctx && model && !kpi && <NoData reason={model.noDataReason ?? t('No data')} />}
      {empty && <><EmptyScope dash={dash} /><MonthCompare dash={dash} page="overview" compact /></>}
      {ctx && model && kpi && !empty && (
        <>
          <KpiRow model={model} sparks={sparks} basis={basis} cmpLabel={cmpLabel} prevLabel={prevLabel} dark={dark} />
          <div className="dcards" data-testid="dash-cards">
            <TrendCard ctx={ctx} filters={dash.filters} dark={dark} classNames={classNames} onOpen={onOpen} />
            <ClassCard ctx={ctx} filters={dash.filters} dark={dark} classNames={classNames} onOpen={onOpen} />
            <LossesCard ctx={ctx} filters={dash.filters} onOpen={onOpen} />
            <PlannedCard ctx={ctx} filters={dash.filters} dark={dark} onOpen={onOpen} />
            <AreaDownCard ctx={ctx} filters={dash.filters} dark={dark} onOpen={onOpen} />
            <AreaTargetCard ctx={ctx} filters={dash.filters} onOpen={onOpen} />
            <FailMttrCard ctx={ctx} filters={dash.filters} onOpen={onOpen} />
            <AttentionCard ctx={ctx} filters={dash.filters} onOpen={onOpen} />
            <RepeatsCard ctx={ctx} filters={dash.filters} onOpen={onOpen} onAll={() => navigate('/repeats')} />
            <HeatCard ctx={ctx} filters={dash.filters} onOpen={onOpen} />
            <DailyCard ctx={ctx} model={model} filters={dash.filters} dark={dark} onOpen={onOpen} />
          </div>
          <div className="dsecs">
            <MonthCompare dash={dash} page="overview" compact />
            <QualitySection />
            <AreasSection ctx={ctx} filters={dash.filters} onOpen={onOpen} />
          </div>
        </>
      )}
    </div>
  );
}
