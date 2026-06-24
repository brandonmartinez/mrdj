import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useSession } from './context/session';
import { OrgShell } from './components/OrgShell';
import GuestJukebox from './pages/GuestJukebox';
import Login from './pages/Login';
import Onboarding from './pages/Onboarding';
import OrgDashboard from './pages/OrgDashboard';
import EventsList from './pages/EventsList';
import EventManage from './pages/EventManage';
import DJConsole from './pages/DJConsole';
import Members from './pages/Members';
import Pricing from './pages/Pricing';
import Earnings from './pages/Earnings';

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
      <Route path="/login" element={<Login />} />
      <Route path="/onboarding" element={<RequireAuth><Onboarding /></RequireAuth>} />

      {/* Public guest jukebox — lives outside the management shell. */}
      <Route path="/o/:orgSlug/events/:eventSlug" element={<GuestJukebox />} />

      {/* Org management shell. */}
      <Route
        path="/o/:orgSlug"
        element={<RequireAuth><OrgShell /></RequireAuth>}
      >
        <Route index element={<OrgIndexRedirect />} />
        <Route path="dashboard" element={<OrgDashboard />} />
        <Route path="events" element={<EventsList />} />
        <Route path="events/:eventSlug/manage" element={<EventManage />} />
        <Route path="events/:eventSlug/console" element={<DJConsole />} />
        <Route path="members" element={<Members />} />
        <Route path="pricing" element={<Pricing />} />
        <Route path="earnings" element={<Earnings />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function OrgIndexRedirect() {
  const { orgSlug } = useParams();
  return <Navigate to={`/o/${orgSlug}/dashboard`} replace />;
}
