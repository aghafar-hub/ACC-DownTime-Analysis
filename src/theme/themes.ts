import type { CSSProperties } from "react";

export type Tokens = {
  appBg: string; sidebarBg: string; cardBg: string; topbarBg: string; border: string; border2: string; inputBg: string; metricBg: string;
  textPrimary: string; textSecondary: string; sidebarText: string; sidebarTextSecondary: string; textMuted: string; textHighlight: string;
  textSubtle: string; accent: string; accentText: string;
  /** ACC orange, the secondary accent: primary calls to action and the active filter pill (fill, text on it, soft tint, orange as text) */
  brand: string; brandText: string; brandSoft: string; brandInk: string; tableHead: string; tableRow: string; tableRowAlt: string; scrollThumb: string;
  cardSubBg: string; infoBarBg: string; codeBg: string; codeText: string; danger: string; warning: string; alert: string; alertBg: string;
  success: string; info: string; dangerBg: string; warningBg: string; successBg: string; navActive: string; tableHover: string;
  pillDanger: string; pillWarning: string; pillSuccess: string; pillInfo: string; purple: string; purpleBg: string; pillPurple: string;
  lvNormal: string; lvCaution: string; lvAlert: string; lvDanger: string; lvNormalBg: string; lvCautionBg: string; lvAlertBg: string; lvDangerBg: string;
};

// The platform's five themes (design system, D1): three light (ACC Light —
// the default —, Warm Paper, High Contrast) and two dark (Navy Dark, Carbon
// Dark). The same five are defined in the shell (frontend/src/theme.ts) and
// the other module, generated from one list so they never drift. Only
// surfaces and text change between themes: danger / warning / success always
// mean Alert / Caution / Normal, accent is the one action colour (buttons,
// links), and every text/background pair meets WCAG AA (4.5:1).
export const THEMES: Record<string, Tokens> = {
  "ACC Light": {
    appBg: "#F3F5F8",
    sidebarBg: "#0B1B2E",
    cardBg: "#FFFFFF",
    topbarBg: "#FFFFFF",
    border: "#D9E0E8",
    border2: "#E8EDF2",
    inputBg: "#FFFFFF",
    metricBg: "#FFFFFF",
    textPrimary: "#0F1B2D",
    textSecondary: "#4A5A70",
    sidebarText: "#E8F0F8",
    sidebarTextSecondary: "#A9B8CC",
    textMuted: "#5F6D82",
    textHighlight: "#0B1B2E",
    textSubtle: "#3D4B60",
    accent: "#1E5BB8",
    accentText: "#FFFFFF",
    brand: "#B45309",
    brandText: "#FFFFFF",
    brandSoft: "#FDF0E3",
    brandInk: "#9A4507",
    tableHead: "#F5F7FA",
    tableRow: "#FFFFFF",
    tableRowAlt: "#FAFBFC",
    scrollThumb: "#C3CEDC",
    cardSubBg: "#F5F7FA",
    infoBarBg: "#EEF3FA",
    codeBg: "#EEF1F6",
    codeText: "#1E4A8F",
    danger: "#C42B2B",
    warning: "#9A5500",
    // Vibration Alert = red text (same as danger); Danger level is purple.
    alert: "#C42B2B",
    alertBg: "#FBE9E9",
    success: "#18734A",
    info: "#0E7490",
    dangerBg: "#FBEAEA",
    warningBg: "#FFF3E0",
    successBg: "#E7F5EE",
    navActive: "rgba(30,91,184,0.1)",
    tableHover: "rgba(30,91,184,0.05)",
    pillDanger: "#C42B2B",
    pillWarning: "#9A5500",
    pillSuccess: "#18734A",
    pillInfo: "#0E7490",
    purple: "#6D28D9",
    purpleBg: "rgba(109,40,217,0.16)",
    pillPurple: "#6D28D9",
    // Vibration levels (validated for colour-blind separation): Normal green,
    // Caution amber, Alert red, Danger purple. Marks use these; text uses
    // success / warning / danger / purple for contrast.
    lvNormal: "#18734A",
    lvCaution: "#B58900",
    lvAlert: "#C42B2B",
    lvDanger: "#6D28D9",
    lvNormalBg: "#E7F5EE",
    lvCautionBg: "#FFF4CC",
    lvAlertBg: "#FBE9E9",
    lvDangerBg: "rgba(109,40,217,0.12)",
  },
  "Warm Paper": {
    appBg: "#F5F1E8",
    sidebarBg: "#2B2620",
    cardBg: "#FFFDF7",
    topbarBg: "#FFFDF7",
    border: "#E2D9C6",
    border2: "#EDE6D8",
    inputBg: "#FFFEFA",
    metricBg: "#FFFDF7",
    textPrimary: "#2A2418",
    textSecondary: "#5A4E3C",
    sidebarText: "#F3ECDD",
    sidebarTextSecondary: "#BFB29A",
    textMuted: "#716553",
    textHighlight: "#1E1A12",
    textSubtle: "#4F4535",
    accent: "#1F58A8",
    accentText: "#FFFFFF",
    brand: "#B45309",
    brandText: "#FFFFFF",
    brandSoft: "#FBEBD8",
    brandInk: "#94420A",
    tableHead: "#F7F2E7",
    tableRow: "#FFFDF7",
    tableRowAlt: "#FBF7EE",
    scrollThumb: "#D6CBB3",
    cardSubBg: "#F7F2E7",
    infoBarBg: "#F2EDE1",
    codeBg: "#F1EBDD",
    codeText: "#1F4E8F",
    danger: "#B8322A",
    warning: "#995500",
    // Vibration Alert = red text (same as danger); Danger level is purple.
    alert: "#B8322A",
    alertBg: "#F8E6E4",
    success: "#1E7346",
    info: "#0E6F86",
    dangerBg: "#F8E6E2",
    warningBg: "#FBEBD2",
    successBg: "#E3F1E6",
    navActive: "rgba(31,88,168,0.1)",
    tableHover: "rgba(31,88,168,0.05)",
    pillDanger: "#B8322A",
    pillWarning: "#995500",
    pillSuccess: "#1E7346",
    pillInfo: "#0E6F86",
    purple: "#6D28D9",
    purpleBg: "rgba(109,40,217,0.16)",
    pillPurple: "#6D28D9",
    // Vibration levels (validated for colour-blind separation): Normal green,
    // Caution amber, Alert red, Danger purple. Marks use these; text uses
    // success / warning / danger / purple for contrast.
    lvNormal: "#1E7346",
    lvCaution: "#B58900",
    lvAlert: "#B8322A",
    lvDanger: "#6D28D9",
    lvNormalBg: "#E6F2EA",
    lvCautionBg: "#FFF2C7",
    lvAlertBg: "#F8E6E4",
    lvDangerBg: "rgba(109,40,217,0.12)",
  },
  "High Contrast": {
    appBg: "#FFFFFF",
    sidebarBg: "#000000",
    cardBg: "#FFFFFF",
    topbarBg: "#000000",
    border: "#1A1A1A",
    border2: "#4D4D4D",
    inputBg: "#FFFFFF",
    metricBg: "#FFFFFF",
    textPrimary: "#000000",
    textSecondary: "#1A1A1A",
    sidebarText: "#FFFFFF",
    sidebarTextSecondary: "#E0E0E0",
    textMuted: "#333333",
    textHighlight: "#000000",
    textSubtle: "#1A1A1A",
    accent: "#0A3A8C",
    accentText: "#FFFFFF",
    brand: "#8A3A06",
    brandText: "#FFFFFF",
    brandSoft: "#FFF0E0",
    brandInk: "#7A3305",
    tableHead: "#EDEDED",
    tableRow: "#FFFFFF",
    tableRowAlt: "#F5F5F5",
    scrollThumb: "#555555",
    cardSubBg: "#F2F2F2",
    infoBarBg: "#EEF2FA",
    codeBg: "#F0F0F0",
    codeText: "#0A3A8C",
    danger: "#A80000",
    warning: "#7A4300",
    // Vibration Alert = red text (same as danger); Danger level is purple.
    alert: "#A80000",
    alertBg: "#F7DEDE",
    success: "#00602E",
    info: "#00546B",
    dangerBg: "#FFE5E5",
    warningBg: "#FFEFD6",
    successBg: "#E0F3E8",
    navActive: "rgba(10,58,140,0.1)",
    tableHover: "rgba(10,58,140,0.05)",
    pillDanger: "#A80000",
    pillWarning: "#7A4300",
    pillSuccess: "#00602E",
    pillInfo: "#00546B",
    purple: "#4C1D95",
    purpleBg: "rgba(76,29,149,0.16)",
    pillPurple: "#4C1D95",
    // Vibration levels (validated for colour-blind separation): Normal green,
    // Caution amber, Alert red, Danger purple. Marks use these; text uses
    // success / warning / danger / purple for contrast.
    lvNormal: "#00602E",
    lvCaution: "#946C00",
    lvAlert: "#A80000",
    lvDanger: "#4C1D95",
    lvNormalBg: "#E2F0E7",
    lvCautionBg: "#FFF0C2",
    lvAlertBg: "#F7DEDE",
    lvDangerBg: "rgba(76,29,149,0.12)",
  },
  "Navy Dark": {
    appBg: "#0A1628",
    sidebarBg: "#0D1E35",
    cardBg: "#0F2138",
    topbarBg: "#0D1E35",
    border: "#1F3A5C",
    border2: "#19304D",
    inputBg: "#0A1628",
    metricBg: "#0F2138",
    textPrimary: "#E8F1FA",
    textSecondary: "#B6C7DA",
    sidebarText: "#E8F1FA",
    sidebarTextSecondary: "#9FB4CB",
    textMuted: "#8AA2BC",
    textHighlight: "#FFFFFF",
    textSubtle: "#C8D6E6",
    accent: "#4C9BFF",
    accentText: "#06142A",
    brand: "#F39A4C",
    brandText: "#1A0D02",
    brandSoft: "rgba(243,154,76,0.16)",
    brandInk: "#F6A25A",
    tableHead: "#0B1A2E",
    tableRow: "#0F2138",
    tableRowAlt: "#0C1C31",
    scrollThumb: "#1F3A5C",
    cardSubBg: "#0B1A2E",
    infoBarBg: "#0C2036",
    codeBg: "#060E1A",
    codeText: "#6BCF9E",
    danger: "#FF6B6B",
    warning: "#F2A541",
    // Vibration Alert = red text (same as danger); Danger level is purple.
    alert: "#FF6B6B",
    alertBg: "rgba(255,107,107,0.16)",
    success: "#4CC38A",
    info: "#38BDF8",
    dangerBg: "#3A1A1F",
    warningBg: "#3A2A12",
    successBg: "#10301F",
    navActive: "rgba(76,155,255,0.14)",
    tableHover: "rgba(76,155,255,0.08)",
    pillDanger: "#FF6B6B",
    pillWarning: "#F2A541",
    pillSuccess: "#4CC38A",
    pillInfo: "#38BDF8",
    purple: "#A78BFA",
    purpleBg: "rgba(167,139,250,0.16)",
    pillPurple: "#A78BFA",
    // Vibration levels (validated for colour-blind separation): Normal green,
    // Caution amber, Alert red, Danger purple. Marks use these; text uses
    // success / warning / danger / purple for contrast.
    lvNormal: "#2FA36B",
    lvCaution: "#BE8A12",
    lvAlert: "#E0484D",
    lvDanger: "#9B7BF0",
    lvNormalBg: "rgba(47,163,107,0.16)",
    lvCautionBg: "rgba(190,138,18,0.18)",
    lvAlertBg: "rgba(224,72,77,0.16)",
    lvDangerBg: "rgba(155,123,240,0.18)",
  },
  "Carbon Dark": {
    appBg: "#0E0F11",
    sidebarBg: "#141619",
    cardBg: "#17191C",
    topbarBg: "#141619",
    border: "#2A2E33",
    border2: "#22262A",
    inputBg: "#101114",
    metricBg: "#17191C",
    textPrimary: "#ECEDEE",
    textSecondary: "#BFC3C8",
    sidebarText: "#ECEDEE",
    sidebarTextSecondary: "#A4AAB1",
    textMuted: "#8E949B",
    textHighlight: "#FFFFFF",
    textSubtle: "#D0D3D7",
    accent: "#5B9BFF",
    accentText: "#0B1424",
    brand: "#F39A4C",
    brandText: "#1A0D02",
    brandSoft: "rgba(243,154,76,0.16)",
    brandInk: "#F6A25A",
    tableHead: "#121417",
    tableRow: "#17191C",
    tableRowAlt: "#141619",
    scrollThumb: "#3A3F45",
    cardSubBg: "#121417",
    infoBarBg: "#151A22",
    codeBg: "#0B0C0E",
    codeText: "#7EE2A8",
    danger: "#FF6B6B",
    warning: "#F2A541",
    // Vibration Alert = red text (same as danger); Danger level is purple.
    alert: "#FF6B6B",
    alertBg: "rgba(255,107,107,0.16)",
    success: "#4CC38A",
    info: "#38BDF8",
    dangerBg: "#3A1A1C",
    warningBg: "#3A2A12",
    successBg: "#10301F",
    navActive: "rgba(91,155,255,0.14)",
    tableHover: "rgba(91,155,255,0.08)",
    pillDanger: "#FF6B6B",
    pillWarning: "#F2A541",
    pillSuccess: "#4CC38A",
    pillInfo: "#38BDF8",
    purple: "#A78BFA",
    purpleBg: "rgba(167,139,250,0.16)",
    pillPurple: "#A78BFA",
    // Vibration levels (validated for colour-blind separation): Normal green,
    // Caution amber, Alert red, Danger purple. Marks use these; text uses
    // success / warning / danger / purple for contrast.
    lvNormal: "#2FA36B",
    lvCaution: "#BE8A12",
    lvAlert: "#E0484D",
    lvDanger: "#9B7BF0",
    lvNormalBg: "rgba(47,163,107,0.16)",
    lvCautionBg: "rgba(190,138,18,0.18)",
    lvAlertBg: "rgba(224,72,77,0.16)",
    lvDangerBg: "rgba(155,123,240,0.18)",
  },
};

export const LEGACY_THEME_NAMES: Record<string, string> = {
  "Midnight Blue": "Navy Dark",
  "Forest Green": "Navy Dark",
  "Vivid Spectrum": "Navy Dark",
  "Slate Light": "ACC Light",
  "Pearl White": "ACC Light",
  "Sky Blue": "ACC Light",
  "Mint Fresh": "ACC Light",
  "ACC Corporate": "ACC Light",
  "Vivid Spectrum Light": "ACC Light",
  "Warm Sand": "Warm Paper",
  "Rose Light": "Warm Paper",
};

export const DEFAULT_THEME = "ACC Light";
export const THEME_NAMES = Object.keys(THEMES);

// A stored theme name from before the five-theme set (e.g. "ACC Corporate",
// "Rose Light") maps to its nearest new theme — light to light, dark to dark.
export function resolveThemeName(name: string | null | undefined): string {
  if (name && THEMES[name]) return name;
  if (name && LEGACY_THEME_NAMES[name]) return LEGACY_THEME_NAMES[name];
  return DEFAULT_THEME;
}


// Fallback used before the ThemeProvider has resolved a stored theme name
// (e.g. very first paint) and by any legacy call site not yet passed
// through useTheme().
export const T: Tokens = THEMES[DEFAULT_THEME];

// Builds the small set of reusable inline-style shapes the original app
// derives from the active palette (background/border/radius/padding
// combos for cards, buttons, inputs, etc). In the original bundle these are
// served by a `new Proxy({}, { get(target, key) {...} })` keyed on the
// *current* theme object, so switching themes updates every already-mounted
// component without those components re-deriving anything themselves. A
// React accessor object serves the same purpose more idiomatically:
// ThemeContext recomputes this once per theme change (see ThemeContext.jsx)
// and every component reads from the resulting `s` object.
export function buildStyles(T: Tokens): Record<string, CSSProperties> {
  // Same values as Oil Lubrication's buildStyles (apps/oil-analysis/src/
  // theme.js) so both modules look the same: card, btn, btnPrimary, select,
  // input, label, table, th, td, sectionTitle, metricCard, infoBar. The
  // extra keys below are Vibration's names for the same shapes.
  const btn: CSSProperties = {
    background: T.cardSubBg,
    border: `1px solid ${T.border}`,
    color: T.textPrimary,
    borderRadius: 6,
    padding: "8px 14px",
    fontSize: 13,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  };
  const btnPrimary: CSSProperties = {
    background: T.accent,
    border: "none",
    color: T.accentText,
    borderRadius: 6,
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  };
  return {
    page: { background: T.appBg, minHeight: "100%", color: T.textPrimary },
    sectionTitle: {
      fontFamily: "'Space Grotesk','IBM Plex Sans',sans-serif",
      fontSize: 22,
      fontWeight: 700,
      color: T.textPrimary,
      margin: "0 0 16px",
    },
    metricCard: { background: T.metricBg, border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 14px" },
    metric: { background: T.metricBg, border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 14px" },
    infoBar: { background: T.infoBarBg, border: `1px solid ${T.border2}`, borderRadius: 8, padding: "10px 14px" },
    select: {
      background: T.inputBg,
      border: `1px solid ${T.border}`,
      color: T.textPrimary,
      borderRadius: 6,
      padding: "8px 10px",
      cursor: "pointer",
    },
    card: { background: T.cardBg, border: `1px solid ${T.border}`, borderRadius: 10, padding: 20, marginBottom: 20 },
    cardSub: { background: T.cardSubBg, border: `1px solid ${T.border2}`, borderRadius: 8, padding: 12 },
    btn,
    btnPrimary,
    // Vibration names for Oil's two button shapes
    btnGhost: btn,
    btnSecondary: btn,
    btnDanger: { ...btn, background: "transparent", color: T.danger, border: `1px solid ${T.danger}`, fontWeight: 600 },
    btnSm: { ...btnPrimary, padding: "5px 10px", fontSize: 12 },
    input: {
      width: "100%",
      background: T.inputBg,
      border: `1px solid ${T.border}`,
      color: T.textPrimary,
      borderRadius: 6,
      padding: "8px 10px",
      boxSizing: "border-box" as const,
    },
    // Oil sets 12px / 600 on its form labels (ModalShell forms); same here.
    label: { display: "block", color: T.textSecondary, marginBottom: 4, fontSize: 12, fontWeight: 600 },
    table: { width: "100%", borderCollapse: "collapse" as const },
    th: { textAlign: "left" as const, padding: "8px 10px", borderBottom: `1px solid ${T.border}`, color: T.textSecondary, fontWeight: 600 },
    td: { padding: "8px 10px", borderBottom: `1px solid ${T.border}`, color: T.textPrimary },
  };
}

// Small pill/badge helper shared by status chips (StatusBadge, count
// badges in the sidebar) — `color + "22"` appends a ~13% alpha hex suffix
// for the background, exactly as the original's `Gn()` helper does.
export function pillStyle(color: string): CSSProperties {
  return {
    background: color + "22",
    color,
    borderRadius: 999,
    padding: "2px 10px",
    fontSize: 12,
    fontWeight: 700,
    display: "inline-block",
    whiteSpace: "nowrap",
  };
}
