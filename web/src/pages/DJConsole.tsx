import { useEffect, useState, useCallback, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, orgApi } from '../api';
import type { QueueView, OrgArea } from '../api';
import { useQueueStream } from '../hooks/useQueueStream';
import { AdminConsole } from '../components/AdminConsole';
import { Toast } from '../components/Toast';
import type { ToastState } from '../components/Toast';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

export default function DJConsole() {
  const { orgSlug = '', eventSlug = '' } = useParams();
  const [queueView, setQueueView] = useState<QueueView | null>(null);
  const [areas, setAreas] = useState<OrgArea[]>([]);
  const [areaId, setAreaId] = useState<string>('');
  const [queueError, setQueueError] = useState<string | null>(null);
  const toastCounter = useRef(0);
  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = useCallback((msg: string, type: 'success' | 'error') => {
    toastCounter.current += 1;
    setToast({ id: toastCounter.current, msg, type });
  }, []);

  useEffect(() => {
    void loadAreas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgSlug, eventSlug]);

  async function loadAreas() {
    const { areas } = await orgApi.listAreas(orgSlug, eventSlug).catch(() => ({ areas: [] as OrgArea[] }));
    setAreas(areas);
    const def = areas.find((a) => a.isDefault) ?? areas[0];
    if (def) setAreaId(def.id);
  }

  const queueStream = useQueueStream(
    eventSlug,
    (view) => {
      setQueueView(view);
      setQueueError(null);
    },
    undefined,
    areaId || undefined,
    {
      onInitialError: (err) => setQueueError(err instanceof Error ? err.message : 'Could not load queue'),
      onInitialSuccess: () => setQueueError(null),
    },
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to={`/o/${orgSlug}/events/${eventSlug}/manage`} className="text-sm text-muted-foreground hover:underline">← {eventSlug}</Link>
          <h1 className="text-2xl font-semibold">DJ Console</h1>
        </div>
        {areas.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Area</span>
            <Select value={areaId} onValueChange={setAreaId}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                {areas.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}{a.isDefault ? ' (default)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {queueError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3">
          <p className="text-sm font-medium text-destructive">Could not load queue</p>
          <p className="mt-1 text-xs text-muted-foreground">{queueError}</p>
          <button
            type="button"
            className="mt-3 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent"
            onClick={() => {
              setQueueError(null);
              void queueStream.retry();
            }}
          >
            Retry
          </button>
        </div>
      ) : !queueView ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <AdminConsole
          eventSlug={eventSlug}
          queueView={queueView}
          guestUserId={null}
          onQueueUpdated={setQueueView}
          onCreditsGranted={() => { void api.queue(eventSlug, areaId || undefined).then(setQueueView); }}
          showToast={showToast}
          areaId={areaId || undefined}
        />
      )}

      {toast && <Toast toast={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
