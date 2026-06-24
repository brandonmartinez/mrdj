// Placeholder app — proves API wiring + proxy work.
// Linus: replace this with the real Cover Flow guest jukebox UI.
import { useState, useEffect } from 'react';
import { api } from './api.ts';
import type { MeResponse, QueueView, QueueItem } from './api.ts';

function formatMs(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function TrackCard({ item, highlight }: { item: QueueItem; highlight?: string }) {
  const bg =
    highlight === 'playing' ? 'border-2 border-indigo-400 bg-indigo-900/40' :
    highlight === 'played'  ? 'opacity-50 bg-zinc-900' :
    'bg-zinc-800 hover:bg-zinc-700';

  return (
    <div className={`flex items-center gap-3 rounded-lg p-3 transition-all ${bg}`}>
      <img
        src={item.track.artworkUrl}
        alt={item.track.title}
        className="h-12 w-12 rounded-md object-cover flex-shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-sm text-white">{item.track.title}</p>
        <p className="truncate text-xs text-zinc-400">{item.track.artist} — {item.track.album}</p>
      </div>
      <span className="text-xs text-zinc-500 flex-shrink-0">{formatMs(item.track.durationMs)}</span>
      {item.isPlayNext && (
        <span className="text-xs font-bold text-yellow-400 flex-shrink-0">★ NEXT</span>
      )}
    </div>
  );
}

export default function App() {
  const [me, setMe]         = useState<MeResponse | null>(null);
  const [queue, setQueue]   = useState<QueueView | null>(null);
  const [error, setError]   = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [meData, queueData] = await Promise.all([
          api.me(),
          api.queue('demo'),
        ]);
        setMe(meData);
        setQueue(queueData);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 2000); // polling ~2s per D6
    return () => clearInterval(interval);
  }, []);

  async function switchRole(role: 'guest' | 'admin') {
    await api.actAs(role);
    const [meData, queueData] = await Promise.all([api.me(), api.queue('demo')]);
    setMe(meData);
    setQueue(queueData);
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-zinc-400 animate-pulse">Loading mrdj…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="rounded-xl bg-red-900/40 border border-red-700 p-6 max-w-md text-center">
          <p className="text-red-300 font-semibold mb-2">API Error</p>
          <p className="text-red-400 text-sm">{error}</p>
          <p className="text-zinc-500 text-xs mt-3">Is the API running? <code>npm run dev</code></p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-zinc-950/80 backdrop-blur border-b border-zinc-800 px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">🎵 mrdj</h1>
          {me && (
            <p className="text-xs text-zinc-400">
              {me.event.name} — {me.user.displayName}
              <span className={`ml-2 rounded px-1.5 py-0.5 text-xs font-medium ${
                me.user.role === 'admin' ? 'bg-yellow-800 text-yellow-200' : 'bg-zinc-700 text-zinc-300'
              }`}>{me.user.role}</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {me && (
            <div className="text-right">
              <p className="text-xs text-zinc-400">Credits</p>
              <p className="text-lg font-bold text-indigo-300">{me.creditBalance}</p>
            </div>
          )}
          <div className="flex gap-1">
            <button
              onClick={() => switchRole('guest')}
              className="rounded px-2 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 transition-colors"
            >
              Guest
            </button>
            <button
              onClick={() => switchRole('admin')}
              className="rounded px-2 py-1 text-xs bg-yellow-900 hover:bg-yellow-800 transition-colors"
            >
              Admin
            </button>
          </div>
        </div>
      </header>

      {/* Placeholder notice */}
      <div className="bg-indigo-950/50 border-b border-indigo-900 px-4 py-2 text-center">
        <p className="text-xs text-indigo-300">
          <strong>Linus:</strong> replace this placeholder with the real Cover Flow UI — API wiring ✓
        </p>
      </div>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-8">
        {queue && (
          <>
            {/* Now Playing */}
            {queue.nowPlaying && (
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-widest text-indigo-400 mb-3">
                  Now Playing
                </h2>
                <TrackCard item={queue.nowPlaying} highlight="playing" />
              </section>
            )}

            {/* Play Next state */}
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-yellow-500 mb-3">
                Play Next Slot — {queue.playNext.status.toUpperCase()}
              </h2>
              <div className="rounded-lg bg-zinc-900 border border-zinc-700 px-4 py-3 text-sm">
                <p className="text-zinc-300">
                  Status: <strong className={
                    queue.playNext.status === 'available' ? 'text-green-400' :
                    queue.playNext.status === 'locked' ? 'text-yellow-400' : 'text-red-400'
                  }>{queue.playNext.status}</strong>
                </p>
                <p className="text-zinc-400 text-xs mt-1">
                  Cost: {queue.playNext.price} credit{queue.playNext.price !== 1 ? 's' : ''}
                  {' · '}Your balance: {queue.creditBalance} credit{queue.creditBalance !== 1 ? 's' : ''}
                </p>
              </div>
            </section>

            {/* Upcoming */}
            {queue.upcoming.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-3">
                  Up Next ({queue.upcoming.length})
                </h2>
                <div className="space-y-2">
                  {queue.upcoming.map(item => <TrackCard key={item.id} item={item} />)}
                </div>
              </section>
            )}

            {/* Previously Played */}
            {queue.previous.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-600 mb-3">
                  Previously Played
                </h2>
                <div className="space-y-2">
                  {queue.previous.map(item => <TrackCard key={item.id} item={item} highlight="played" />)}
                </div>
              </section>
            )}

            {/* Pricing info */}
            <section className="rounded-lg bg-zinc-900 border border-zinc-800 px-4 py-3 text-xs text-zinc-500">
              <p className="font-semibold text-zinc-400 mb-1">Pricing (server-authoritative)</p>
              <p>Add to queue: {queue.pricing.queue === 0 ? 'Free' : `${queue.pricing.queue} cr`}
                {' · '}Boost: {queue.pricing.boost} cr
                {' · '}Play Next: {queue.pricing.playNext} cr
              </p>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
