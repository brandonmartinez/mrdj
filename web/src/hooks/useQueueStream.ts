import { useEffect, useRef, useCallback } from 'react';
import { api } from '../api';
import type { QueueView } from '../api';

interface QueueStreamOptions {
  onInitialError?: (error: unknown) => void;
  onInitialSuccess?: () => void;
}

/**
 * Realtime queue sync via SSE (resolves O3).
 *
 * Invalidation-signal pattern: the server stream only signals "the queue changed"; this hook
 * responds by re-fetching GET /events/:slug/queue, which is already the authoritative per-user
 * view (balances, pricing). We never trust queue data carried in the stream itself.
 *
 *  - EventSource auto-reconnects on drop (native behaviour).
 *  - Reconnect state-sync (#28): the server replays no missed signals, so on every (re)connect
 *    `onopen` triggers a full REST re-fetch. This catches any queue:changed signals that fired
 *    while the connection was down — no missed updates, and the full-view replace means no dups.
 *  - A low-frequency fallback poll (default 15s) covers any missed signal or a stream outage,
 *    so correctness never depends solely on SSE.
 *  - JSON-diff dedup avoids re-rendering when nothing actually changed.
 */
export function useQueueStream(
  slug: string,
  onUpdate: (view: QueueView) => void,
  fallbackMs = 15_000,
  areaId?: string,
  options: QueueStreamOptions = {},
) {
  const lastData = useRef<string>('');
  const onUpdateRef = useRef(onUpdate);
  const optionsRef = useRef(options);
  const loadedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  onUpdateRef.current = onUpdate;
  optionsRef.current = options;

  const fetchQueue = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const data = await api.queue(slug, areaId, ctrl.signal);
      const serialized = JSON.stringify(data);
      if (serialized !== lastData.current) {
        lastData.current = serialized;
        onUpdateRef.current(data);
      }
      if (!loadedRef.current) {
        loadedRef.current = true;
        optionsRef.current.onInitialSuccess?.();
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      if (!loadedRef.current) {
        optionsRef.current.onInitialError?.(error);
      }
    }
  }, [slug, areaId]);

  useEffect(() => {
    // Switching area is a fresh view — drop the dedup cache so the first fetch always fires.
    lastData.current = '';
    loadedRef.current = false;
    // Prime once on mount/slug/area change.
    void fetchQueue();

    // SSE: re-fetch on every queue:changed signal for this area's channel.
    const es = new EventSource(api.streamUrl(slug, areaId), { withCredentials: true });
    const onSignal = () => { void fetchQueue(); };
    es.addEventListener('queue', onSignal);

    // Reconnect state-sync (#28): EventSource fires `onopen` on the initial connect AND after
    // every automatic reconnect. Re-fetching here closes the gap for any signals missed while
    // the stream was down (the server replays nothing). The initial-connect double-fetch is a
    // no-op thanks to JSON-diff dedup.
    es.onopen = () => { void fetchQueue(); };

    // Fallback poll — resilience if the stream is unavailable or a signal is missed.
    const fallback = setInterval(() => { void fetchQueue(); }, fallbackMs);

    return () => {
      es.removeEventListener('queue', onSignal);
      es.onopen = null;
      es.close();
      clearInterval(fallback);
      abortRef.current?.abort();
    };
  }, [fetchQueue, slug, fallbackMs, areaId]);

  return { retry: fetchQueue };
}
