import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import type { MeResponse, QueueView, Track, Bundle, PublicOrg, Area } from '../api.ts';
import { api, orgApi } from '../api.ts';
import { useQueueStream } from '../hooks/useQueueStream.ts';
import { useDebounced } from '../hooks/useDebounced.ts';
import { Header } from '../components/Header.tsx';
import { CoverFlow } from '../components/CoverFlow.tsx';
import { SearchBar } from '../components/SearchBar.tsx';
import { TrackRow } from '../components/TrackRow.tsx';
import { ConfirmModal } from '../components/ConfirmModal.tsx';
import type { PendingAction } from '../components/ConfirmModal.tsx';
import { AdminConsole } from '../components/AdminConsole.tsx';
import { Toast } from '../components/Toast.tsx';
import type { ToastState } from '../components/Toast.tsx';
import { HeroBanner } from '../components/HeroBanner.tsx';


export default function GuestJukebox() {
  // Route: /o/:orgSlug/events/:eventSlug — falls back to the seeded demo event
  // so the legacy single-event flow keeps working during the Epic 7 transition.
  const params = useParams<{ orgSlug?: string; eventSlug?: string }>();
  const eventSlug = params.eventSlug ?? 'demo';
  const orgSlug = params.orgSlug ?? 'demo';

  const [me, setMe] = useState<MeResponse | null>(null);
  const [org, setOrg] = useState<PublicOrg['organization'] | null>(null);
  const [queueView, setQueueView] = useState<QueueView | null>(null);
  const [creditBalance, setCreditBalance] = useState(0);
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);

  // Per-area queue (#70/#91): the roster of areas + the one the guest is viewing.
  // undefined selection = the event's default area (server-resolved).
  const [areas, setAreas] = useState<Area[]>([]);
  const [selectedAreaId, setSelectedAreaId] = useState<string | undefined>(undefined);

  const [searchQuery, setSearchQuery] = useState('');
  const debouncedQuery = useDebounced(searchQuery, 220);
  const [searchResults, setSearchResults] = useState<Track[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchOverlayOpen, setSearchOverlayOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Modal state
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  // Admin view toggle: guest jukebox vs DJ console (no router — in-app view state).
  const [view, setView] = useState<'guest' | 'console'>('guest');

  // Toast
  const toastCounter = useRef(0);
  const [toast, setToast] = useState<ToastState | null>(null);

  // Remember the guest user ID for admin credit grants
  const guestUserIdRef = useRef<string | null>(null);

  // ── Initial load ────────────────────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      try {
        const [meData, bundleData] = await Promise.all([
          api.me(),
          api.bundles(),
        ]);
        setMe(meData);
        setBundles(bundleData);
        if (meData.user.role === 'guest') {
          guestUserIdRef.current = meData.user.id;
        }
        // Area roster for the per-area selector (non-fatal; default area used otherwise).
        try {
          const areaData = await api.areas(eventSlug);
          setAreas(areaData.areas);
          const def = areaData.areas.find((a) => a.isDefault) ?? areaData.areas[0];
          if (def) setSelectedAreaId(def.id);
        } catch {
          /* areas endpoint unavailable — fall back to the server default area */
        }
        // Org branding + org-scoped bundles (non-fatal if unavailable).
        try {
          const pub = await orgApi.publicOrg(orgSlug);
          setOrg(pub.organization);
          if (pub.bundles.length > 0) setBundles(pub.bundles);
        } catch {
          /* public org endpoint unavailable — fall back to defaults */
        }
      } catch (e) {
        setApiError(e instanceof Error ? e.message : 'Unknown error');
        setLoading(false);
      }
    }
    void init();
  }, [orgSlug, eventSlug]);

  // ── Queue realtime (SSE + fallback poll) ─────────────────────────────────────
  const handleQueueUpdate = useCallback((view: QueueView) => {
    setQueueView(view);
    setCreditBalance(view.creditBalance);
    setQueueError(null);
    setLoading(false);
  }, []);

  const queueStream = useQueueStream(eventSlug, handleQueueUpdate, undefined, selectedAreaId, {
    onInitialError: (err) => {
      setQueueError(err instanceof Error ? err.message : 'Could not load queue');
      setLoading(false);
    },
    onInitialSuccess: () => setQueueError(null),
  });

  // ── Search ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    // Cancel any in-flight request
    abortRef.current?.abort();
    const q = debouncedQuery.trim();
    if (!q) {
      setSearchBusy(false);
      setSearchResults([]);
      return;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setSearchBusy(true);
    api.search(q, ctrl.signal)
      .then((data) => {
        setSearchResults(data.results);
        setSearchBusy(false);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return; // stale, ignore
        setSearchBusy(false);
      });

    return () => ctrl.abort();
  }, [debouncedQuery]);

  // Open overlay when user starts typing
  useEffect(() => {
    if (searchQuery.trim()) {
      setSearchOverlayOpen(true);
    }
  }, [searchQuery]);

  // Escape to close overlay
  useEffect(() => {
    if (!searchOverlayOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSearchOverlayOpen(false);
        setSearchQuery('');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [searchOverlayOpen]);

  // ── Role switch ─────────────────────────────────────────────────────────────
  async function handleRoleSwitch(role: 'guest' | 'admin') {
    try {
      await api.actAs(role);
      const meData = await api.me();
      setMe(meData);
      if (role === 'guest') {
        guestUserIdRef.current = meData.user.id;
        setView('guest'); // guests never see the console
      }
      // Immediately refresh balance from a fresh queue poll
      const qData = await api.queue(eventSlug, selectedAreaId);
      setQueueView(qData);
      setCreditBalance(qData.creditBalance);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Role switch failed', 'error');
    }
  }

  // ── Action handlers ─────────────────────────────────────────────────────────
  function handleTrackAction(track: Track, tier: 'queue' | 'boost' | 'play_next') {
    const idempotencyKey = crypto.randomUUID();
    setPendingAction({ track, tier, idempotencyKey });
  }

  function handleBuyCredits() {
    // Open the insufficient-credits modal with a dummy track to trigger the buy flow
    if (!queueView) return;
    const dummyTrack: Track = {
      id: 'buy-credits-flow',
      title: 'Buy Credits',
      artist: '',
      album: '',
      artworkUrl: '',
      durationMs: 0,
      provider: 'spotify',
      providerId: '',
    };
    setPendingAction({
      track: dummyTrack,
      tier: 'boost', // Use a paid tier to trigger insufficient flow
      idempotencyKey: crypto.randomUUID(),
    });
  }

  function handleModalSuccess(update: { queueView: QueueView; creditBalance: number }) {
    setQueueView(update.queueView);
    setCreditBalance(update.creditBalance);
    setPendingAction(null);
    const tier = pendingAction?.tier;
    const msg =
      tier === 'queue' ? 'Added to queue!' :
      tier === 'boost' ? 'Boosted to top!' :
      "You're next — Play Next locked!";
    showToast(msg, 'success');
  }

  // ── Toast helper ─────────────────────────────────────────────────────────────
  function showToast(msg: string, type: 'success' | 'error') {
    toastCounter.current += 1;
    setToast({ id: toastCounter.current, msg, type });
  }

  // ── Loading / error screens ─────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-black">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-zinc-400 text-sm animate-pulse">Loading mrdj…</p>
        </div>
      </div>
    );
  }

  if (apiError || queueError) {
    const message = apiError ?? queueError ?? 'Unknown error';
    return (
      <div className="flex h-screen items-center justify-center bg-black p-6">
        <div className="rounded-2xl bg-red-950/40 border border-red-800 p-6 max-w-md text-center">
          <p className="text-2xl mb-3">⚠️</p>
          <p className="text-red-300 font-semibold mb-2">
            {queueError ? 'Could not load the queue' : 'Could not connect to API'}
          </p>
          <p className="text-red-400 text-sm">{message}</p>
          <button
            type="button"
            className="mt-4 rounded-lg bg-red-800 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
            onClick={() => {
              setApiError(null);
              setQueueError(null);
              if (queueError) {
                setLoading(true);
                void queueStream.retry();
              } else {
                window.location.reload();
              }
            }}
          >
            {queueError ? 'Retry queue' : 'Reload'}
          </button>
        </div>
      </div>
    );
  }

  const isAdmin = me?.user.role === 'admin';

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Fixed header */}
      <Header
        eventName={me?.event.name ?? ''}
        displayName={me?.user.displayName ?? ''}
        role={me?.user.role ?? 'guest'}
        creditBalance={creditBalance}
        onRoleSwitch={handleRoleSwitch}
        view={view}
        onToggleView={() => setView((v) => (v === 'console' ? 'guest' : 'console'))}
        orgName={org?.name}
        logoUrl={org?.logoUrl}
        accentColor={org?.accentColor}
        onBuyCredits={handleBuyCredits}
      />

      {/* ── DJ Console (admin-only view) ──────────────────────────── */}
      {isAdmin && view === 'console' && queueView ? (
        <main
          style={{ paddingTop: 'calc(var(--header-h, 64px) + 16px)' }}
          className="max-w-3xl mx-auto pb-24"
        >
          <AdminConsole
            eventSlug={eventSlug}
            queueView={queueView}
            guestUserId={guestUserIdRef.current}
            onQueueUpdated={(v) => { setQueueView(v); setCreditBalance(v.creditBalance); }}
            onCreditsGranted={() => {
              // A console grant targets another user (usually the guest); it does NOT change the
              // admin's own wallet. Re-fetch /me so the header always reflects the admin's true
              // balance instead of momentarily showing the grantee's.
              void api.me().then((m) => setCreditBalance(m.creditBalance)).catch(() => {});
            }}
            showToast={showToast}
            areaId={selectedAreaId}
          />
        </main>
      ) : (
      /* Main content — padded below fixed header */
      <main
        style={{ paddingTop: 'calc(var(--header-h, 64px) + 16px)' }}
        className="max-w-7xl mx-auto pb-24 px-4"
      >
        {org?.heroUrl && (
          <section className="mb-6 overflow-hidden rounded-[2rem]">
            <HeroBanner
              heroUrl={org.heroUrl}
              accent={org.accentColor ?? '#7c3aed'}
              alt={`${org.name} hero`}
              className="h-44 sm:h-56"
              testId="org-hero"
            />
            <div className="relative z-10 -mt-16 flex items-end gap-3 px-5 pb-5">
              {org.logoUrl && (
                <img
                  src={org.logoUrl}
                  alt={org.name}
                  className="h-16 w-16 rounded-2xl border border-white/20 bg-zinc-950 object-cover shadow-xl"
                />
              )}
              <div className="min-w-0 pb-1">
                <p className="truncate text-xs font-semibold uppercase tracking-widest text-white/70">{org.name}</p>
                <h1 className="truncate text-2xl font-black tracking-tight">{me?.event.name ?? ''}</h1>
              </div>
            </div>
          </section>
        )}

        {/* ── Area selector (#70) — only when the event has multiple areas ── */}
        {areas.length > 1 && (
          <section aria-label="Choose area" className="mb-6">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2">Area</p>
            <div className="flex flex-wrap gap-2">
              {areas.map((area) => {
                const active = area.id === selectedAreaId;
                return (
                  <button
                    key={area.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSelectedAreaId(area.id)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                      active
                        ? 'bg-violet-600 border-violet-500 text-white'
                        : 'bg-zinc-900/60 border-zinc-800 text-zinc-300 hover:border-zinc-600'
                    }`}
                  >
                    {area.name}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Cover Flow — hero on top ─────────────────────────────── */}
        {queueView && (
          <section aria-label="Now playing queue" className="mb-8">
            <CoverFlow queueView={queueView} />
          </section>
        )}

        {/* ── Two-column layout (desktop) or stacked (mobile) ────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* ── LEFT COLUMN: Coming up queue ─────────────────────────── */}
          <section aria-label="Coming up queue">
            {queueView && (
              <>
                <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-3">
                  Coming up ({queueView.upcoming.length})
                </p>
                <div className="space-y-2">
                  {/* Play Next preview — ghosted when available, solid when locked */}
                  {queueView.playNext.status === 'available' && (
                    <button
                      onClick={() => {
                        // Open search if empty, or encourage clicking a track
                        setSearchQuery('');
                      }}
                      data-testid="play-next-cta"
                      className="w-full flex items-center gap-3 bg-yellow-900/10 border border-yellow-700/30 border-dashed rounded-xl p-3 opacity-50 hover:opacity-70 transition-all group cursor-pointer"
                    >
                      <div className="w-12 h-12 rounded-lg bg-yellow-900/20 flex items-center justify-center flex-shrink-0">
                        <span className="text-yellow-400 text-lg">★</span>
                      </div>
                      <div className="min-w-0 flex-1 text-left">
                        <p className="text-yellow-200 text-sm font-semibold">Play Next Available</p>
                        <p className="text-yellow-400/70 text-xs">
                          Jump the queue — {queueView.pricing.playNext}cr
                        </p>
                      </div>
                      <span className="text-yellow-400 text-xs font-bold flex-shrink-0">Buy slot →</span>
                    </button>
                  )}

                  {queueView.upcoming.length > 0 && queueView.upcoming.map((item) => (
                    <div key={item.id} className="flex items-center gap-3 bg-zinc-900/40 border border-zinc-800/60 rounded-xl p-3">
                      <img
                        src={item.track.artworkUrl}
                        alt={item.track.title}
                        className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-white text-sm font-semibold truncate">{item.track.title}</p>
                        <p className="text-zinc-400 text-xs truncate">{item.track.artist}</p>
                      </div>
                      {item.isPlayNext && (
                        <span className="text-xs font-bold text-yellow-400 flex-shrink-0 bg-yellow-900/30 px-2 py-0.5 rounded-full">★ NEXT</span>
                      )}
                      <span className="text-zinc-600 text-xs flex-shrink-0">#{item.position}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>

          {/* ── RIGHT COLUMN: Search and Results ─────────────────────── */}
          <section aria-label="Search tracks">
            <button
              data-testid="search-trigger"
              onClick={() => setSearchOverlayOpen(true)}
              className="w-full px-4 py-3 bg-zinc-900/60 border border-zinc-800 rounded-xl text-left text-zinc-500 hover:border-zinc-700 hover:bg-zinc-900 transition-colors"
            >
              <span className="text-sm">🔍 Search tracks...</span>
            </button>
          </section>
        </div>
      </main>
      )}

      {/* ── Confirm / buy modal ──────────────────────────────────── */}
      {pendingAction && queueView && (
        <ConfirmModal
          action={pendingAction}
          queueView={queueView}
          creditBalance={creditBalance}
          bundles={bundles}
          eventSlug={eventSlug}
          orgSlug={orgSlug}
          areaId={selectedAreaId}
          onSuccess={handleModalSuccess}
          onCancel={() => setPendingAction(null)}
        />
      )}

      {/* ── Toast notifications ──────────────────────────────────── */}
      {toast && (
        <Toast toast={toast} onDismiss={() => setToast(null)} />
      )}

      {/* ── Search overlay (#123) ───────────────────────────────── */}
      {searchOverlayOpen && (
        <div
          data-testid="search-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="search-overlay-title"
          className="fixed inset-0 z-[90] flex items-start justify-center p-4 pt-20"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setSearchOverlayOpen(false);
              setSearchQuery('');
            }
          }}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" aria-hidden />

          {/* Search panel */}
          <div className="relative w-full max-w-2xl bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-zinc-800 flex items-center gap-3">
              <SearchBar
                value={searchQuery}
                onChange={setSearchQuery}
                autoFocus
              />
              <button
                onClick={() => {
                  setSearchOverlayOpen(false);
                  setSearchQuery('');
                }}
                data-testid="search-overlay-close"
                className="text-zinc-500 hover:text-zinc-300 transition-colors flex-shrink-0"
                aria-label="Close search"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Results */}
            <div className="max-h-[60vh] overflow-y-auto p-4">
              {searchBusy && !searchResults.length && (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-20 rounded-xl bg-zinc-900/50 animate-pulse" />
                  ))}
                </div>
              )}

              {!searchBusy && searchResults.length === 0 && debouncedQuery.trim().length > 0 && (
                <div className="text-center py-10">
                  <p className="text-zinc-500 text-sm">No tracks found for "{debouncedQuery}"</p>
                </div>
              )}

              {!searchBusy && searchResults.length === 0 && !debouncedQuery.trim() && (
                <div className="text-center py-10">
                  <p className="text-zinc-500 text-sm">Start typing to search tracks...</p>
                </div>
              )}

              {searchResults.length > 0 && debouncedQuery.trim() && queueView && (
                <>
                  <p id="search-overlay-title" className="text-zinc-500 text-xs mb-3">
                    {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} for "{debouncedQuery}"
                  </p>
                  <div className="space-y-2">
                    {searchResults.map((track) => (
                      <TrackRow
                        key={track.id}
                        track={track}
                        queueView={queueView}
                        creditBalance={creditBalance}
                        onAction={(t, tier) => {
                          handleTrackAction(t, tier);
                          setSearchOverlayOpen(false);
                          setSearchQuery('');
                        }}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
