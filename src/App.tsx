import { Suspense, useEffect, useMemo, useState, type FocusEvent, type PointerEvent } from 'react';
import { HashRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import RequireAuth from './auth/RequireAuth';
import RequireTab from './auth/RequireTab';
import BottomNav from './components/BottomNav';
import DataStatusStrip from './components/DataStatusStrip';
import { InstallBanner } from './components/InstallGuide';
import OfflineBanner from './components/OfflineBanner';
import PageTabs from './components/PageTabs';
import { ScopeSlotContext } from './components/ScopeSlot';
import SaveBlockedToast from './components/SaveBlockedToast';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import { Tile } from './components/Tile';
import { ENV_LABEL } from './config';
import { useIsMobile } from './hooks/useIsMobile';
import { useVisiblePages } from './hooks/useVisiblePages';
import { useRail } from './hooks/useRail';
import { pageForPath } from './navigation';
import { t } from './i18n/t';
import MoreSheet, { OPEN_MORE_EVENT } from './mobile/MoreSheet';
import ScrollKeeper from './mobile/ScrollKeeper';
import ChangePassword from './pages/ChangePassword';
import Login from './pages/Login';
import {
  ActionsPage, DashboardPage, EventExplorerPage, MasterPage, NotificationsPage, ParetoPage, preloadPath, ReliabilityPage, ReportsPage, RepeatsPage,
  SettingsPage, UploadPage, ValidatePage, whenIdle,
} from './routes/lazyPages';
import { ActionsProvider } from './actions/ActionsContext';
import { PageLoadBoundary, PageSkeleton } from './routes/PageFallback';
import { NotificationsProvider } from './notifications/NotificationsContext';
import { ValidationProvider } from './validate/ValidationContext';
import { ThemeProvider, useTheme } from './theme/ThemeContext';
import UpdateBanner from './update/UpdateBanner';
import SharePrompt from './export/SharePrompt';
import './App.css';

const Dashboard = DashboardPage.Component;
const Pareto = ParetoPage.Component;
const Repeats = RepeatsPage.Component;
const Reliability = ReliabilityPage.Component;
const Reports = ReportsPage.Component;
const EventExplorer = EventExplorerPage.Component;
const Validate = ValidatePage.Component;
const Upload = UploadPage.Component;
const Master = MasterPage.Component;
const Settings = SettingsPage.Component;
const ActionsBoard = ActionsPage.Component;
const NotificationsInbox = NotificationsPage.Component;

// Hover, keyboard focus or a touch on any link or menu tile in the shell starts loading that page's code,
// so the page is usually ready by the time the click lands. Links carry their address in href ('#/pareto');
// buttons that navigate (the phone's More tiles) carry it in data-preload.
function preloadFromEvent(e: PointerEvent | FocusEvent) {
  const el = (e.target as Element | null)?.closest?.('a[href], [data-preload]');
  if (!el) return;
  preloadPath(el.getAttribute('data-preload') ?? el.getAttribute('href'));
}

// Signed in: the shell (left rail, top bar, page tabs, phone bottom bar) around the page.
function ShellLayout() {
  const mobile = useIsMobile();
  const { dark } = useTheme();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const { pinned } = useRail();
  // the page's scope bar is drawn into this slot (sticky under the top bar); the data status strip follows it
  const [slotBar, setSlotBar] = useState<HTMLElement | null>(null);
  const [slotInfo, setSlotInfo] = useState<HTMLElement | null>(null);
  const slots = useMemo(() => ({ bar: slotBar, info: slotInfo }), [slotBar, slotInfo]);
  const page = pageForPath(location.pathname);
  const scoped = !!page && (page.group === 'analyze' || page.id === 'events');

  useEffect(() => {
    const on = () => setMoreOpen(true);
    window.addEventListener(OPEN_MORE_EVENT, on);
    return () => window.removeEventListener(OPEN_MORE_EVENT, on);
  }, []);
  useEffect(() => setMoreOpen(false), [location.pathname]);
  useEffect(() => {
    if (!mobile) setMoreOpen(false);
  }, [mobile]);

  // native controls (date pickers, scroll bars) follow the theme; the page behind the shell too
  useEffect(() => {
    const body = document.body;
    body.style.colorScheme = dark ? 'dark' : 'light';
    body.style.background = 'var(--shell-bg)';
    return () => {
      body.style.colorScheme = '';
      body.style.background = '';
    };
  }, [dark]);

  return (
    <ValidationProvider>
    <NotificationsProvider>
    <ActionsProvider>
    <ScopeSlotContext.Provider value={slots}>
    <div
      className={pinned && !mobile ? 'app-shell app-shell--rail-pinned' : 'app-shell'}
      onPointerOver={preloadFromEvent} onPointerDown={preloadFromEvent} onFocus={preloadFromEvent}
    >
      {!mobile && <Sidebar />}
      <div className="app-shell-right">
        <TopBar />
        <PageTabs />
        <div className="scope-slot" ref={setSlotBar} />
        {/* the scope note and range, and the data status, share one thin band */}
        <div className="scope-meta">
          <div className="scope-info-slot" ref={setSlotInfo} />
          {scoped && <DataStatusStrip />}
        </div>
        <OfflineBanner />
        <main className="shell-page-content" id="main">
          <PageLoadBoundary resetKey={location.pathname}>
            <Suspense fallback={<PageSkeleton />}>
              <Outlet />
            </Suspense>
          </PageLoadBoundary>
        </main>
        {mobile && <BottomNav onOpenMore={() => setMoreOpen(true)} moreOpen={moreOpen} />}
        {mobile && <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />}
        <ScrollKeeper />
        {mobile && <InstallBanner />}
      </div>
      <SaveBlockedToast />
    </div>
    </ScopeSlotContext.Provider>
    </ActionsProvider>
    </NotificationsProvider>
    </ValidationProvider>
  );
}

// The Overview is now the Dashboard: old links and bookmarks (/overview?line=L.1) land there with their query.
function OldOverview() {
  const location = useLocation();
  return <Navigate to={{ pathname: '/dashboard', search: location.search }} replace state={location.state} />;
}

// "/" goes to the first page this person may open.
function Home() {
  const pages = useVisiblePages();
  if (pages.length === 0) return <NoPages />;
  return <Navigate to={pages[0].path} replace />;
}

function NoPages() {
  const { logout } = useAuth();
  return (
    <div className="page" data-testid="no-pages">
      <p className="muted" style={{ marginBottom: 12 }}>{t('Your account has no pages yet. Ask an administrator to give you access.')}</p>
      <button type="button" className="btn" onClick={() => logout()}>{t('Sign out')}</button>
    </div>
  );
}

function NotFound() {
  return (
    <div className="page" data-testid="not-found">
      <Tile icon="info" label={t('Page not found')} value="404" sub={t('Use the tabs above to find your page.')} />
    </div>
  );
}

function LoginRoute() {
  const { token, mustChange } = useAuth();
  // the Dashboard is where most people land after signing in: fetch its code once the sign-in screen is
  // fully loaded and the browser is idle, so it never competes with the form itself
  useEffect(() => {
    if (token) return undefined;
    let cancel = () => {};
    const start = () => { cancel = whenIdle(() => preloadPath('/dashboard'), 4000); };
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
    return () => {
      window.removeEventListener('load', start);
      cancel();
    };
  }, [token]);
  if (token) return <Navigate to={mustChange ? '/change-password' : '/'} replace />;
  return <Login />;
}

// Test builds set VITE_ENV_LABEL so a test copy can never be mistaken for the live site.
function EnvRibbon() {
  // the class lets the CSS keep room for the ribbon so it never covers page content
  useEffect(() => {
    if (!ENV_LABEL) return undefined;
    document.body.classList.add('has-env-ribbon');
    return () => document.body.classList.remove('has-env-ribbon');
  }, []);
  if (!ENV_LABEL) return null;
  return (
    <div className="env-ribbon">
      {ENV_LABEL}
      <span className="env-ribbon-extra"> · {t('not live data')}</span>
    </div>
  );
}

export default function App() {
  return (
    <HashRouter>
      <ThemeProvider>
        <UpdateBanner />
        <EnvRibbon />
        <SharePrompt />
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginRoute />} />
            <Route element={<RequireAuth />}>
              <Route path="/change-password" element={<ChangePassword />} />
              <Route element={<ShellLayout />}>
                <Route path="/" element={<Home />} />
                <Route path="/dashboard" element={<RequireTab tab="overview"><Dashboard /></RequireTab>} />
                <Route path="/overview" element={<OldOverview />} />
                <Route path="/pareto" element={<RequireTab tab="pareto"><Pareto /></RequireTab>} />
                <Route path="/repeats" element={<RequireTab tab="repeats"><Repeats /></RequireTab>} />
                <Route path="/reliability" element={<RequireTab tab="reliability"><Reliability /></RequireTab>} />
                <Route path="/reports" element={<RequireTab tab="reports"><Reports /></RequireTab>} />
                <Route path="/actions" element={<RequireTab tab="actions"><ActionsBoard /></RequireTab>} />
                <Route path="/notifications" element={<NotificationsInbox />} />
                <Route path="/events" element={<RequireTab tab="events"><EventExplorer /></RequireTab>} />
                <Route path="/validate" element={<RequireTab tab="events"><Validate /></RequireTab>} />
                <Route path="/upload" element={<RequireTab tab="upload"><Upload /></RequireTab>} />
                <Route path="/master" element={<RequireTab tab="master"><Master /></RequireTab>} />
                <Route path="/settings/:sub?" element={<Settings />} />
                <Route path="/users" element={<Navigate to="/settings/users" replace />} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Route>
          </Routes>
        </AuthProvider>
      </ThemeProvider>
    </HashRouter>
  );
}
