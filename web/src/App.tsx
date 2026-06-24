import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from './api.ts';
import type { MeResponse, QueueView, Track, Bundle } from './api.ts';
import { useQueuePolling } from './hooks/useQueuePolling.ts';
import { useDebounced } from './hooks/useDebounced.ts';
import { Header } from './components/Header.tsx';
import { CoverFlow } from './components/CoverFlow.tsx';
import { SearchBar } from './components/SearchBar.tsx';
import { TrackRow } from './components/TrackRow.tsx';
import { ConfirmModal } from './components/ConfirmModal.tsx';
import type { PendingAction } from './components/ConfirmModal.tsx';
import { AdminPanel } from './components/AdminPanel.tsx';
import { Toast } from './components/Toast.tsx';
import type { ToastState } from './components/Toast.tsx';

const EVENT_SLUG = 'demo';

export default function App() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [queueView, setQueueView] = useState<QueueView | null>(null);
  const [creditBalance, setCreditBalance] = useState(0);
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedQuery = useDebounced(searchQuery, 220);
  const [searchResults, setSearchResults] = useState<Track[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Modal state
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

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
      } catch (e) {
        setApiError(e instanceof Error ? e.message : 'Unknown error');
        setLoading(false);
      }
    }
    void init();
  }, []);

  // ── Queue polling ────────────────────────────────────────────────────────────
  const handleQueueUpdate = useCallback((view: QueueView) => {
    setQueueView(view);
    setCreditBalance(view.creditBalance);
    setLoading(false);
  }, []);

  useQueuePolling(EVENT_SLUG, handleQueueUpdate);

  // ── Search ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    // Cancel any in-flight request
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setSearchBusy(true);
    api.search(debouncedQuery, ctrl.signal)
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

  // ── Role switch ─────────────────────────────────────────────────────────────
  async function handleRoleSwitch(role: 'guest' | 'admin') {
    try {
      await api.actAs(role);
      const meData = await api.me();
      setMe(meData);
      if (role === 'guest') {
        guestUserIdRef.current = meData.user.id;
      }
      // Immediately refresh balance from a fresh queue poll
      const qData = await api.queue(EVENT_SLUG);
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

  if (apiError) {
    return (
      <div className="flex h-screen items-center justify-center bg-black p-6">
        <div className="rounded-2xl bg-red-950/40 border border-red-800 p-6 max-w-md text-center">
          <p className="text-2xl mb-3">⚠️</p>
          <p className="text-red-300 font-semibold mb-2">Could not connect to API</p>
          <p className="text-red-400 text-sm">{apiError}</p>
          <p className="text-zinc-600 text-xs mt-3">
            Make sure the backend is running: <code className="bg-zinc-900 px-1 py-0.5 rounded">npm run dev</code>
          </p>
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
      />

      {/* Main content — padded below fixed header */}
      <main
        style={{ paddingTop: 'calc(var(--header-h, 64px) + 16px)' }}
        className="max-w-3xl mx-auto pb-24"
      >
        {/* ── Cover Flow ──────────────────────────────────────────────── */}
        {queueView && (
          <section aria-label="Now playing queue" className="mb-8">
            <CoverFlow queueView={queueView} />
          </section>
        )}

        {/* ── Play Next status bar ─────────────────────────────────── */}
        {queueView && (
          <div className="mx-4 mb-6 flex items-center justify-between bg-zinc-900/60 border border-zinc-800 rounded-xl px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-yellow-400 text-sm">★</span>
              <span className="text-zinc-300 text-sm font-medium">Play Next</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                queueView.playNext.status === 'available'
                  ? 'bg-green-900/50 text-green-400'
                  : queueView.playNext.status === 'locked'
                  ? 'bg-yellow-900/50 text-yellow-400'
                  : 'bg-zinc-800 text-zinc-500'
              }`}>
                {queueView.playNext.status}
              </span>
            </div>
            <span className="text-zinc-500 text-xs">
              {queueView.pricing.playNext}cr
            </span>
          </div>
        )}

        {/* ── Admin panel ──────────────────────────────────────────── */}
        {isAdmin && queueView && (
          <section aria-label="Admin controls" className="mb-6">
            <AdminPanel
              guestUserId={guestUserIdRef.current}
              eventSlug={EVENT_SLUG}
              onCreditsGranted={(balance) => {
                setCreditBalance(balance);
              }}
              onQueueAdvanced={(view) => {
                setQueueView(view);
                setCreditBalance(view.creditBalance);
              }}
              showToast={showToast}
            />
          </section>
        )}

        {/* ── Search ───────────────────────────────────────────────── */}
        <section aria-label="Search tracks" className="mb-4">
          <SearchBar value={searchQuery} onChange={setSearchQuery} />
        </section>

        {/* ── Results ──────────────────────────────────────────────── */}
        <section aria-label="Search results" className="px-4">
          {searchBusy && !searchResults.length && (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-20 rounded-xl bg-zinc-900/50 animate-pulse" />
              ))}
            </div>
          )}

          {!searchBusy && searchResults.length === 0 && debouncedQuery.length > 0 && (
            <div className="text-center py-10">
              <p className="text-zinc-500 text-sm">No tracks found for "{debouncedQuery}"</p>
            </div>
          )}

          {searchResults.length > 0 && queueView && (
            <>
              {debouncedQuery && (
                <p className="text-zinc-500 text-xs mb-3">
                  {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} for "{debouncedQuery}"
                </p>
              )}
              <div className="space-y-2">
                {searchResults.map((track) => (
                  <TrackRow
                    key={track.id}
                    track={track}
                    queueView={queueView}
                    creditBalance={creditBalance}
                    onAction={handleTrackAction}
                  />
                ))}
              </div>
            </>
          )}

          {/* Upcoming queue — visible when no search query */}
          {!debouncedQuery && queueView && queueView.upcoming.length > 0 && (
            <div className="mt-6">
              <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-3">
                Coming up ({queueView.upcoming.length})
              </p>
              <div className="space-y-2">
                {queueView.upcoming.map((item) => (
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
            </div>
          )}
        </section>
      </main>

      {/* ── Confirm / buy modal ──────────────────────────────────── */}
      {pendingAction && queueView && (
        <ConfirmModal
          action={pendingAction}
          queueView={queueView}
          creditBalance={creditBalance}
          bundles={bundles}
          eventSlug={EVENT_SLUG}
          onSuccess={handleModalSuccess}
          onCancel={() => setPendingAction(null)}
        />
      )}

      {/* ── Toast notifications ──────────────────────────────────── */}
      {toast && (
        <Toast toast={toast} onDismiss={() => setToast(null)} />
      )}
    </div>
  );
}
