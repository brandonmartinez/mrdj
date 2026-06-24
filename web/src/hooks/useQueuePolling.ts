import { useEffect, useRef, useCallback } from 'react';
import { api } from '../api';
import type { QueueView } from '../api';

export function useQueuePolling(
  slug: string,
  onUpdate: (view: QueueView) => void,
  intervalMs = 1500,
) {
  const lastData = useRef<string>('');
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const fetchQueue = useCallback(async () => {
    try {
      const data = await api.queue(slug);
      const serialized = JSON.stringify(data);
      if (serialized !== lastData.current) {
        lastData.current = serialized;
        onUpdateRef.current(data);
      }
    } catch {
      // silently ignore transient polling errors
    }
  }, [slug]);

  useEffect(() => {
    fetchQueue();
    const id = setInterval(fetchQueue, intervalMs);
    return () => clearInterval(id);
  }, [fetchQueue, intervalMs]);
}
