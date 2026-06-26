import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import type { QueueView, QueueItem, EventStats } from '../api';

const GUEST_SEED_ID = '00000000-0000-0000-0000-000000000003';

interface AdminConsoleProps {
  eventSlug:        string;
  queueView:        QueueView;
  guestUserId:      string | null;
  onQueueUpdated:   (view: QueueView) => void;
  onCreditsGranted: (balance: number) => void;
  showToast:        (msg: string, type: 'success' | 'error') => void;
  areaId?:          string;
}

export function AdminConsole({
  eventSlug,
  queueView,
  guestUserId,
  onQueueUpdated,
  onCreditsGranted,
  showToast,
  areaId,
}: AdminConsoleProps) {
  const [stats, setStats] = useState<EventStats | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [advanceBusy, setAdvanceBusy] = useState(false);

  // Grant form
  const [targetUserId, setTargetUserId] = useState(guestUserId ?? GUEST_SEED_ID);
  const [amount, setAmount] = useState(10);
  const [grantBusy, setGrantBusy] = useState(false);

  const refreshStats = useCallback(async () => {
    try {
      const { stats } = await api.adminStats(eventSlug, areaId);
      setStats(stats);
    } catch {
      // non-fatal — stats panel just stays stale
    }
  }, [eventSlug, areaId]);

  // Refresh stats on mount, area changes, and whenever the queue changes (a change = new aggregates).
  useEffect(() => { void refreshStats(); }, [refreshStats, queueView]);

  async function handleAdvance() {
    setAdvanceBusy(true);
    try {
      const { queueView: view } = await api.adminAdvance(eventSlug, areaId);
      onQueueUpdated(view);
      showToast('Skipped to next track', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Skip failed', 'error');
    } finally {
      setAdvanceBusy(false);
    }
  }

  async function handleReorder(item: QueueItem, direction: 'up' | 'down') {
    setBusyId(item.id);
    try {
      const { queueView: view } = await api.adminReorder(eventSlug, item.id, direction, areaId);
      onQueueUpdated(view);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Reorder failed', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function handleRemove(item: QueueItem) {
    setBusyId(item.id);
    try {
      const { queueView: view, refund } = await api.adminRemove(eventSlug, item.id, areaId);
      onQueueUpdated(view);
      showToast(
        refund ? `Removed — refunded ${refund.amount} credit${refund.amount !== 1 ? 's' : ''}` : 'Removed from queue',
        'success',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Remove failed', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function handleGrant() {
    if (!targetUserId.trim() || amount <= 0) return;
    setGrantBusy(true);
    try {
      const result = await api.adminGrant(targetUserId.trim(), amount, 'DJ console grant', crypto.randomUUID());
      onCreditsGranted(result.balance);
      showToast(`Granted ${amount} credits (balance ${result.balance})`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Grant failed', 'error');
    } finally {
      setGrantBusy(false);
    }
  }

  const upcoming = queueView.upcoming;

  return (
    <div className="px-4 space-y-6">
      {/* ── Now playing + Skip ─────────────────────────────────────── */}
      <section className="rounded-2xl border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Now Playing</h2>
          <button
            onClick={() => void handleAdvance()}
            disabled={advanceBusy}
            className="px-3 py-1.5 rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-xs font-bold transition-colors"
          >
            {advanceBusy ? 'Skipping…' : '⏭ Skip'}
          </button>
        </div>
        <div className="p-4">
          {queueView.nowPlaying ? (
            <div className="flex items-center gap-3">
              <img src={queueView.nowPlaying.track.artworkUrl} alt="" className="w-14 h-14 rounded-lg object-cover" />
              <div className="min-w-0">
                <p className="text-foreground font-bold truncate">{queueView.nowPlaying.track.title}</p>
                <p className="text-muted-foreground text-sm truncate">{queueView.nowPlaying.track.artist}</p>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">Nothing playing.</p>
          )}
        </div>
      </section>

      {/* ── Upcoming queue with controls ───────────────────────────── */}
      <section className="rounded-2xl border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b">
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
            Upcoming ({upcoming.length})
          </h2>
        </div>
        <div className="divide-y">
          {upcoming.length === 0 && (
            <p className="text-muted-foreground text-sm p-4">Queue is empty.</p>
          )}
          {upcoming.map((item, idx) => {
            const isHolder = item.isPlayNext;
            const aboveIsHolder = idx > 0 && upcoming[idx - 1].isPlayNext;
            const canUp   = !isHolder && idx > 0 && !aboveIsHolder;
            const canDown = !isHolder && idx < upcoming.length - 1;
            const rowBusy = busyId === item.id;
            return (
              <div key={item.id} className="flex items-center gap-3 p-3">
                <span className="text-muted-foreground/50 text-xs w-5 text-center tabular-nums">{item.position}</span>
                <img src={item.track.artworkUrl} alt="" className="w-11 h-11 rounded-lg object-cover flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-foreground text-sm font-semibold truncate">{item.track.title}</p>
                  <p className="text-muted-foreground text-xs truncate">{item.track.artist}</p>
                </div>
                {isHolder && (
                  <span className="text-xs font-bold text-yellow-400 bg-yellow-900/30 px-2 py-0.5 rounded-full flex-shrink-0" aria-label="Play Next holder, pinned to top">
                    ★ NEXT
                  </span>
                )}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => void handleReorder(item, 'up')}
                    disabled={!canUp || rowBusy}
                    aria-label={`Move ${item.track.title} up`}
                    className="w-7 h-7 rounded-md bg-muted hover:bg-muted/80 disabled:opacity-30 disabled:cursor-not-allowed text-foreground text-sm flex items-center justify-center transition-colors"
                  >▲</button>
                  <button
                    onClick={() => void handleReorder(item, 'down')}
                    disabled={!canDown || rowBusy}
                    aria-label={`Move ${item.track.title} down`}
                    className="w-7 h-7 rounded-md bg-muted hover:bg-muted/80 disabled:opacity-30 disabled:cursor-not-allowed text-foreground text-sm flex items-center justify-center transition-colors"
                  >▼</button>
                  <button
                    onClick={() => void handleRemove(item)}
                    disabled={rowBusy}
                    aria-label={`Remove ${item.track.title} from queue`}
                    className="w-7 h-7 rounded-md bg-destructive/20 hover:bg-destructive/30 disabled:opacity-40 text-destructive text-sm flex items-center justify-center transition-colors"
                  >✕</button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Stats ──────────────────────────────────────────────────── */}
      <section className="rounded-2xl border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b">
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Event Stats</h2>
        </div>
        <div className="p-4">
          {stats ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat label="Requests" value={stats.requestCount} />
                <Stat label="Paid" value={stats.paidRequestCount} />
                <Stat label="Credits spent" value={stats.creditsSpent} />
                <Stat label="Refunded" value={stats.creditsRefunded} />
              </div>
              {stats.topRequesters.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Top requesters</p>
                  <div className="space-y-1">
                    {stats.topRequesters.map((r) => (
                      <div key={r.userId} className="flex items-center justify-between text-sm">
                        <span className="text-foreground truncate">{r.displayName}</span>
                        <span className="text-muted-foreground text-xs tabular-nums">
                          {r.requests} req · {r.spent} cr
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-muted-foreground text-sm">Loading stats…</p>
          )}
        </div>
      </section>

      {/* ── Grant credits ──────────────────────────────────────────── */}
      <section className="rounded-2xl border border-primary/30 bg-accent/50 overflow-hidden">
        <div className="px-4 py-3 border-b border-primary/20">
          <h2 className="text-sm font-bold uppercase tracking-widest text-accent-foreground">Grant Credits</h2>
        </div>
        <div className="p-4 space-y-2">
          <input
            type="text"
            value={targetUserId}
            onChange={(e) => setTargetUserId(e.target.value)}
            placeholder="Target user ID (UUID)"
            aria-label="Target user ID"
            className="w-full bg-background border rounded-lg px-3 py-2 text-foreground text-xs font-mono placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
          />
          <div className="flex gap-2">
            <input
              type="number"
              value={amount}
              min={1}
              max={1000}
              onChange={(e) => setAmount(Math.max(1, parseInt(e.target.value) || 1))}
              aria-label="Credit amount"
              className="w-24 bg-background border rounded-lg px-3 py-2 text-foreground text-sm text-center focus:outline-none focus:border-primary transition-colors"
            />
            <button
              onClick={() => void handleGrant()}
              disabled={grantBusy}
              data-testid="console-grant-cta"
              className="flex-1 py-2.5 rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-sm font-bold transition-colors"
            >
              {grantBusy ? 'Granting…' : `Grant ${amount} Credits`}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-muted/50 border px-3 py-2.5">
      <p className="text-2xl font-black text-foreground tabular-nums leading-none">{value}</p>
      <p className="text-muted-foreground text-xs mt-1">{label}</p>
    </div>
  );
}
