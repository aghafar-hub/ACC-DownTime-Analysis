import type { CSSProperties, ReactNode } from 'react';
import { Icon } from '../icons';
import { useTheme } from '../theme/ThemeContext';

// The platform's page pieces, kept with the same shapes and values as the
// reference app (Tile.jsx): PageHeader, Tile, TabBar.

/** Number tile: icon square, big number, label, sub-line; a coloured left edge when it needs attention. */
export function Tile({ icon, label, value, sub, tone, onClick, testid, compact }: {
  icon: string; label: string; value: ReactNode; sub?: ReactNode; tone?: string; onClick?: () => void; testid?: string;
  /** smaller padding and number, no icon square: for strips of secondary figures */
  compact?: boolean;
}) {
  const { T, s } = useTheme();
  const c = tone || T.accent;
  const style: CSSProperties = {
    ...s.card, marginBottom: 0, padding: compact ? '8px 12px' : '14px 16px', display: 'flex', gap: 12, alignItems: 'center', width: '100%', boxSizing: 'border-box',
    textAlign: 'left', font: 'inherit', cursor: onClick ? 'pointer' : 'default', minWidth: 0,
    borderLeft: `3px solid ${tone && tone !== T.accent ? tone : T.border}`,
  };
  const body = (
    <>
      {!compact && (
        <span style={{ width: 38, height: 38, borderRadius: 10, background: c + '1A', color: c, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon name={icon} size={19} />
        </span>
      )}
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: compact ? 18 : 22, fontWeight: 800, color: tone || T.textPrimary, lineHeight: 1.15, fontFamily: 'var(--mono)' }}>{value}</span>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: T.textSecondary }}>{label}</span>
        {sub && <span style={{ display: 'block', fontSize: 12, color: T.textMuted }}>{sub}</span>}
      </span>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} data-testid={testid} style={style}>{body}</button>
  ) : (
    <div data-testid={testid} style={style}>{body}</div>
  );
}

/** Page header: a title (a <p>, never an <h1>), a one-line subtitle with live numbers, controls on the right. */
export function PageHeader({ title, subtitle, right, testid, big }: { title: string; subtitle?: ReactNode; right?: ReactNode; testid?: string; big?: boolean }) {
  const { T, s } = useTheme();
  return (
    <div data-testid={testid} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
      <div style={{ minWidth: 0, flex: '1 1 240px' }}>
        <p data-testid="page-title" style={{ ...s.sectionTitle, margin: 0, ...(big ? { fontSize: 26 } : null) }}>{title}</p>
        {subtitle && <p data-testid="page-subtitle" style={{ fontSize: big ? 14 : 12.5, color: T.textSecondary, margin: big ? '4px 0 0' : '2px 0 0' }}>{subtitle}</p>}
      </div>
      {right && <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>{right}</div>}
    </div>
  );
}

/** Underlined sub-page tabs with optional counts. */
export function TabBar({ tabs, value, onChange, testid }: {
  tabs: { id: string; label: string; count?: number; tone?: string }[]; value: string; onChange: (id: string) => void; testid?: string;
}) {
  const { T } = useTheme();
  return (
    <div role="group" data-testid={testid} style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: `1px solid ${T.border}`, overflowX: 'auto' }}>
      {tabs.map((tab) => {
        const on = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(tab.id)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 14px', minHeight: 44, border: 0,
              borderBottom: `3px solid ${on ? T.accent : 'transparent'}`, marginBottom: -1, background: 'none',
              color: on ? T.accent : T.textSecondary, fontWeight: on ? 700 : 600, fontSize: 13.5, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            {tab.label}
            {tab.count != null && (
              <span style={{ fontSize: 12, fontWeight: 700, padding: '1px 7px', borderRadius: 999, background: tab.tone ? tab.tone + '1F' : T.cardSubBg, color: tab.tone || T.textSecondary }}>{tab.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
