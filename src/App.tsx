import { useEffect, useState } from 'react';
import { HashRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import RequireAuth from './auth/RequireAuth';
import RequireTab from './auth/RequireTab';
import BottomNav from './components/BottomNav';
import { InstallBanner } from './components/InstallGuide';
import OfflineBanner from './components/OfflineBanner';
import PageTabs from './components/PageTabs';
import SaveBlockedToast from './components/SaveBlockedToast';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import { Tile } from './components/Tile';
import { ENV_LABEL } from './config';
import { useIsMobile } from './hooks/useIsMobile';
import { useVisiblePages } from './hooks/useVisiblePages';
import { t } from './i18n/t';
import MoreSheet, { OPEN_MORE_EVENT } from './mobile/MoreSheet';
import ScrollKeeper from './mobile/ScrollKeeper';
import ChangePassword from './pages/ChangePassword';
import EventExplorer from './pages/EventExplorer';
import Login from './pages/Login';
import Master from './pages/Master';
import Dashboard from './pages/Dashboard';
import Pareto from './pages/Pareto';
import Reliability from './pages/Reliability';
import Reports from './pages/Reports';
import Repeats from './pages/Repeats';
import Settings from './pages/Settings';
import Upload from './pages/Upload';
import Validate from './pages/Validate';
import { NotificationsProvider } from './notifications/NotificationsContext';
import { ValidationProvider } from './validate/ValidationContext';
import { ThemeProvider, useTheme } from './theme/ThemeContext';
import UpdateBanner from './update/UpdateBanner';
import './App.css';

// Signed in: the shell (left rail, top bar, page tabs, phone bottom bar) around the page.
function ShellLayout() {
  const mobile = useIsMobile();
  const { dark } = useTheme();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

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
    <div className="app-shell">
      {!mobile && <Sidebar />}
      <div className="app-shell-right">
        <TopBar />
        <PageTabs />
        <OfflineBanner />
        <main className="shell-page-content" id="main">
          <Outlet />
        </main>
        {mobile && <BottomNav onOpenMore={() => setMoreOpen(true)} moreOpen={moreOpen} />}
        {mobile && <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />}
        <ScrollKeeper />
        {mobile && <InstallBanner />}
      </div>
      <SaveBlockedToast />
    </div>
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
