import { useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './auth/AuthProvider';
import { useMe } from './lib/queries';
import { lastOrg } from './lib/prefs';
import { OrgLayout } from './components/Layout';
import { FullPageMessage, Loading, Toasts } from './components/ui';
import { LoginPage } from './pages/LoginPage';
import { NewOrgPage } from './pages/NewOrgPage';
import { InvitePage } from './pages/InvitePage';
import { DashboardPage } from './pages/DashboardPage';
import { ProjectPage } from './pages/ProjectPage';
import { SuitePage } from './pages/SuitePage';
import { RunPage } from './pages/RunPage';
import { SettingsPage } from './pages/SettingsPage';
import { MembersPage } from './pages/MembersPage';

export function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/callback" element={<Loading />} />
        <Route path="/invite/:token" element={<RequireAuth><InvitePage /></RequireAuth>} />
        <Route path="/" element={<RequireAuth><HomeRedirect /></RequireAuth>} />
        <Route path="/new" element={<RequireAuth><NewOrgPage /></RequireAuth>} />
        <Route path="/:org" element={<RequireAuth><OrgLayout /></RequireAuth>}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="projects/:projectId" element={<ProjectPage />} />
          <Route path="suites/:suiteId" element={<SuitePage />} />
          <Route path="runs/:runId" element={<RunPage />} />
          <Route path="members" element={<MembersPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
      <Toasts />
    </>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <Loading />;
  if (status === 'signedOut') {
    const returnTo = location.pathname + location.search;
    return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }
  return <>{children}</>;
}

function HomeRedirect() {
  const me = useMe();
  const navigate = useNavigate();
  useEffect(() => {
    if (!me.data) return;
    const orgs = me.data.orgs;
    if (orgs.length === 0) return navigate('/new', { replace: true });
    const last = lastOrg();
    const target = orgs.find((o) => o.slug === last) ?? orgs[0];
    navigate(`/${target.slug}/dashboard`, { replace: true });
  }, [me.data, navigate]);
  if (me.isError) return <FullPageMessage title="Couldn't load your account">{me.error.message}</FullPageMessage>;
  return <Loading />;
}

function NotFound() {
  return <FullPageMessage title="Page not found">Check the address, or use the menu to find your way.</FullPageMessage>;
}
