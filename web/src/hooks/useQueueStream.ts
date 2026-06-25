import { useEffect, useRef, useCallback } from 'react';
import { api } from '../api';
import type { QueueView } from '../api';

/**
 * Realtime queue sync via SSE (resolves O3).
 *
 * Invalidation-signal pattern: the server stream only signals "the queue changed"; this hook
 * responds by re-fetching GET /events/:slug/queue, which is already the authoritative per-user
 * view (balances, pricing). We never trust queue data carried in the stream itself.
 *
 *  - EventSource auto-reconnects on drop (native behaviour).
 *  - A low-frequency fallback poll (default 15s) covers any missed signal or a stream outage,
 *    so correctness never depends solely on SSE.
 *  - JSON-diff dedup avoids re-rendering when nothing actually changed.
 */
export function useQueueStream(
  slug: string,
  onUpdate: (view: QueueView) => void,
  fallbackMs = 15_000,
  areaId?: string,
) {
  const lastData = useRef<string>('');
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const fetchQueue = useCallback(async () => {
    try {
      const data = await api.queue(slug, areaId);
      const serialized = JSON.stringify(data);
      if (serialized !== lastData.current) {
        lastData.current = serialized;
        onUpdateRef.current(data);
      }
    } catch {
      // Ignore transient fetch errors; the next signal or fallback tick retries.
    }
  }, [slug, areaId]);

  useEffect(() => {
    // Switching area is a fresh view — drop the dedup cache so the first fetch always fires.
    lastData.current = '';
    // Prime once on mount/slug/area change.
    void fetchQueue();

    // SSE: re-fetch on every queue:changed signal for this area's channel.
    const es = new EventSource(api.streamUrl(slug, areaId), { withCredentials: true });
    const onSignal = () => { void fetchQueue(); };
    es.addEventListener('queue', onSignal);

    // Fallback poll — resilience if the stream is unavailable or a signal is missed.
    const fallback = setInterval(() => { void fetchQueue(); }, fallbackMs);

    return () => {
      es.removeEventListener('queue', onSignal);
      es.close();
      clearInterval(fallback);
    };
  }, [fetchQueue, slug, fallbackMs, areaId]);
}
