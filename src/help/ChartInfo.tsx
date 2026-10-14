// The (i) button of a chart or table card: the same button and dialog as the KPI tiles, with the card's text from
// chartHelp.ts and the numbers the card shows.
import { InfoButton } from '../dashboard/HeroKpi';
import { t } from '../i18n/t';
import { chartHelp, CHART_HELP, type ChartHelpId, type HelpVars } from './chartHelp';

export interface HelpRef {
  id: ChartHelpId;
  /** numbers for the live example (and {b} = the availability basis) */
  vars?: HelpVars;
}

export default function ChartInfo({ help, title }: { help: HelpRef; title?: string }) {
  return (
    <InfoButton
      info={() => chartHelp(help.id, help.vars)} title={title ?? t(CHART_HELP[help.id].title)}
      testid="chart-info" dialogTestid="chart-info-dialog" className="info-btn--card"
    />
  );
}
