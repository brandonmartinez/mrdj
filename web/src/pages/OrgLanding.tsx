import { useEffect, useState } from 'react';
import { useParams, Link, Navigate } from 'react-router-dom';
import { orgApi } from '../api.ts';
import type { PublicOrg } from '../api.ts';
import { useSession } from '../context/session';
import { HeroBanner } from '../components/HeroBanner.tsx';

/**
 * Public org landing (#65) at /o/:orgSlug.
 * Shows org branding + joinable events. Authenticated members of this org are
 * redirected to their management dashboard so the route stays useful for both.
 */
export default function OrgLanding() {
  const { orgSlug = '' } = useParams();
  const { loading: sessionLoading, isAuthed, orgs } = useSession();

  const [data, setData] = useState<PublicOrg | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    orgApi
      .publicOrg(orgSlug)
      .then((d) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Unknown error');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [orgSlug]);

  // Authed members of this org go to management; everyone else sees the landing.
  if (!sessionLoading && isAuthed && orgs.some((o) => o.slug === orgSlug)) {
    return <Navigate to={`/o/${orgSlug}/dashboard`} replace />;
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0a0a0a]">
        <div className="w-12 h-12 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0a0a0a] p-6">
        <div className="rounded-2xl bg-red-950/40 border border-red-800 p-6 max-w-md text-center">
          <p className="text-2xl mb-3">⚠️</p>
          <p className="text-red-300 font-semibold mb-2">Organization not found</p>
          <p className="text-red-400 text-sm">{error ?? 'This organization is unavailable.'}</p>
        </div>
      </div>
    );
  }

  const { organization, events } = data;
  const accent = organization.accentColor ?? '#7c3aed';
  const joinable = events.filter((e) => e.status !== 'ended');
  const past = events.filter((e) => e.status === 'ended');

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="max-w-2xl mx-auto px-5 py-12">
        {/* Brand header */}
        <div className="flex flex-col items-center text-center mb-10">
          <HeroBanner
            heroUrl={organization.heroUrl}
            accent={accent}
            alt={`${organization.name} hero`}
            className="mb-6 w-full"
            testId="org-hero"
          />
          {organization.logoUrl ? (
            <img
              src={organization.logoUrl}
              alt={organization.name}
              className={`h-20 w-20 rounded-2xl object-cover mb-4 ring-2 ${organization.heroUrl ? '-mt-16 relative z-10 bg-zinc-950 shadow-xl' : ''}`}
              style={{ ['--tw-ring-color' as string]: accent }}
            />
          ) : (
            <div
              className={`h-20 w-20 rounded-2xl mb-4 flex items-center justify-center text-3xl font-black ${organization.heroUrl ? '-mt-16 relative z-10 shadow-xl' : ''}`}
              style={{ backgroundColor: accent }}
            >
              {organization.name.charAt(0).toUpperCase()}
            </div>
          )}
          <h1 className="text-3xl font-black tracking-tight">{organization.name}</h1>
          <p className="text-zinc-500 text-sm mt-1">Pick an event to start requesting songs</p>
        </div>

        {/* Joinable events */}
        {joinable.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-8 text-center">
            <p className="text-zinc-400">No live events right now.</p>
            <p className="text-zinc-600 text-sm mt-1">Check back when the party starts.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {joinable.map((e) => (
              <Link
                key={e.id}
                to={`/o/${orgSlug}/events/${e.slug}`}
                className="flex items-center justify-between rounded-2xl border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-900 transition-colors p-5 group"
              >
                <div className="min-w-0">
                  <p className="font-bold text-lg truncate">{e.name}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {e.status === 'live' ? 'Live now' : 'Opening soon'}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {e.status === 'live' && (
                    <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: accent }}>
                      <span className="h-2 w-2 rounded-full animate-pulse" style={{ backgroundColor: accent }} />
                      LIVE
                    </span>
                  )}
                  <span className="text-zinc-600 group-hover:text-white transition-colors" aria-hidden>→</span>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Past events */}
        {past.length > 0 && (
          <div className="mt-10">
            <p className="text-xs uppercase tracking-wide text-zinc-600 mb-3">Past events</p>
            <div className="space-y-2">
              {past.map((e) => (
                <div key={e.id} className="rounded-xl border border-zinc-900 bg-zinc-950 p-4 text-zinc-600">
                  <p className="font-medium truncate">{e.name}</p>
                  <p className="text-xs mt-0.5">Ended</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
