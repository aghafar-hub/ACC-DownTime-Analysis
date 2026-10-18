// The page tabs of Actions (docs/actions-mockups/tasks/01, 07, 08, 13): Actions · Tasks · Shutdown list, each with its count
// (Tasks also says how many are overdue). They are addresses (/actions, /actions/tasks, /actions/shutdown), so Back and a
// shared link bring the same tab back. The open action (?id=…&task=…) is shown over whichever tab it was opened from.
import { useCallback, useMemo } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useLiveSearchParams } from '../hooks/useLiveSearchParams';
import { isTaskOpen, isTerminalStatus } from '../api/types';
import { tapHaptic } from '../haptics';
import { useIsMobile } from '../hooks/useIsMobile';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { useActions } from './ActionsContext';
import { todayLocal } from './model';
import { buildTaskViews } from './tasks';

/** The open action of the page address and how to open and close it (Back closes it when it was opened here). */
export function useActionOpener() {
  const [sp, setSp] = useLiveSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const openId = sp.get('id');
  const taskId = sp.get('task');
  const open = useCallback((id: string, task?: string) => {
    const n = new URLSearchParams(sp);
    n.set('id', id);
    if (task) n.set('task', task); else n.delete('task');
    navigate({ pathname: location.pathname, search: n.toString() }, { state: { actionOpen: true } });
  }, [sp, navigate, location.pathname]);
  const close = useCallback(() => {
    if ((location.state as { actionOpen?: boolean } | null)?.actionOpen) navigate(-1);
    else {
      setSp((cur) => {
        const n = new URLSearchParams(cur);
        n.delete('id');
        n.delete('task');
        return n;
      }, { replace: true });
    }
  }, [location.state, navigate, setSp]);
  return { openId, taskId, open, close };
}

export default function ActionsTabs() {
  const acts = useActions();
  const mobile = useIsMobile();
  const p = acts.payload;
  const counts = useMemo(() => {
    if (!p) return null;
    const views = buildTaskViews(p.actions, p.tasks ?? [], p.logs, todayLocal());
    const open = views.filter(isTaskOpen);
    return {
      actions: p.actions.filter((a) => !isTerminalStatus(a.status)).length,
      tasks: open.length, overdue: open.filter((v) => v.overdue).length, stop: open.filter((v) => v.needs_stop).length,
    };
  }, [p]);
  const tabs = [
    { to: '/actions', end: true, icon: 'target', label: t('Actions'), n: counts?.actions, id: 'actions' },
    { to: '/actions/tasks', end: false, icon: 'list', label: t('Tasks'), n: counts?.tasks, id: 'tasks' },
    { to: '/actions/shutdown', end: false, icon: 'clock', label: mobile ? t('Shutdown') : t('Shutdown list'), n: counts?.stop, id: 'shutdown' },
  ];
  return (
    <nav className={mobile ? 'act-ptabs act-ptabs--phone' : 'act-ptabs'} aria-label={t('Actions pages')} data-testid="actions-page-tabs">
      {tabs.map((x) => (
        <NavLink key={x.id} to={x.to} end={x.end} onClick={mobile ? tapHaptic : undefined}
          className={({ isActive }) => (isActive ? 'act-ptab act-ptab--on' : 'act-ptab')} data-testid={`ptab-${x.id}`}>
          {!mobile && <Icon name={x.icon} size={15} />}
          <span>{x.label}</span>
          {x.n !== undefined && <b className="act-ptab-n">{x.n}</b>}
          {x.id === 'tasks' && !!counts?.overdue && !mobile && <span className="act-ptab-od" data-testid="ptab-tasks-overdue">{t('{n} overdue', { n: counts.overdue })}</span>}
        </NavLink>
      ))}
    </nav>
  );
}
