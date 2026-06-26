import { Routes, Route, Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useSession } from './context/session';
import { OrgShell } from './components/OrgShell';
import GuestJukebox from './pages/GuestJukebox';
import Kiosk from './pages/Kiosk';
import OrgLanding from './pages/OrgLanding';
import Login from './pages/Login';
import Onboarding from './pages/Onboarding';
import OrgDashboard from './pages/OrgDashboard';
import EventsList from './pages/EventsList';
import EventManage from './pages/EventManage';
import DJConsole from './pages/DJConsole';
import Members from './pages/Members';
import Pricing from './pages/Pricing';
import Earnings from './pages/Earnings';
import { ErrorBoundary } from './components/ErrorBoundary';

function RouteBoundary({ children }: { children: ReactNode }) {
  return <ErrorBoundary title="This page hit a snag">{children}</ErrorBoundary>;
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
      {children}
    </div>
  );
}

/** Sends the user to the right place based on auth + org membership. */
function RootRedirect() {
  const { loading, isAuthed, orgs } = useSession();
  if (loading) return <Centered>Loading…</Centered>;
  if (!isAuthed) return <Navigate to="/login" replace />;
  if (orgs.length === 0) return <Navigate to="/onboarding" replace />;
  return <Navigate to={`/o/${orgs[0].slug}/dashboard`} replace />;
}

/** Gate for authenticated org-management routes. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { loading, isAuthed } = useSession();
  if (loading) return <Centered>Loading…</Centered>;
  if (!isAuthed) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function NotFound() {
  return (
    <Centered>
      <div className="text-center">
        <p className="text-3xl font-semibold text-foreground">404</p>
        <p className="mt-1">This page doesn't exist.</p>
      </div>
    </Centered>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<RouteBoundary><Login /></RouteBoundary>} />
      <Route path="/onboarding" element={<RequireAuth><RouteBoundary><Onboarding /></RouteBoundary></RequireAuth>} />

      {/* Public guest jukebox + org landing — live outside the management shell. */}
      <Route path="/o/:orgSlug/events/:eventSlug" element={<RouteBoundary><GuestJukebox /></RouteBoundary>} />
      <Route path="/o/:orgSlug/events/:eventSlug/kiosk" element={<RouteBoundary><Kiosk /></RouteBoundary>} />
      <Route path="/o/:orgSlug" element={<RouteBoundary><OrgLanding /></RouteBoundary>} />

      {/* Org management shell. */}
      <Route
        path="/o/:orgSlug"
        element={<RequireAuth><OrgShell /></RequireAuth>}
      >
        <Route path="dashboard" element={<RouteBoundary><OrgDashboard /></RouteBoundary>} />
        <Route path="events" element={<RouteBoundary><EventsList /></RouteBoundary>} />
        <Route path="events/:eventSlug/manage" element={<RouteBoundary><EventManage /></RouteBoundary>} />
        <Route path="events/:eventSlug/console" element={<RouteBoundary><DJConsole /></RouteBoundary>} />
        <Route path="members" element={<RouteBoundary><Members /></RouteBoundary>} />
        <Route path="pricing" element={<RouteBoundary><Pricing /></RouteBoundary>} />
        <Route path="earnings" element={<RouteBoundary><Earnings /></RouteBoundary>} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
