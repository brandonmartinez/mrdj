import { useEffect, useState, useCallback, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, orgApi } from '../api';
import type { QueueView, OrgArea } from '../api';
import { useQueueStream } from '../hooks/useQueueStream';
import { AdminConsole } from '../components/AdminConsole';
import { Toast } from '../components/Toast';
import type { ToastState } from '../components/Toast';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

export default function DJConsole() {
  const { orgSlug = '', eventSlug = '' } = useParams();
  const [queueView, setQueueView] = useState<QueueView | null>(null);
  const [areas, setAreas] = useState<OrgArea[]>([]);
  const [areaId, setAreaId] = useState<string>('');
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

  useQueueStream(eventSlug, setQueueView);

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

      {areas.length > 1 && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="mr-2">Beta</Badge>
          This event has multiple areas, but the live queue is currently shared across the event.
          Per-area queue routing is coming soon.
        </p>
      )}

      {!queueView ? (
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
          onCreditsGranted={() => { void api.queue(eventSlug).then(setQueueView); }}
          showToast={showToast}
        />
      )}

      {toast && <Toast toast={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
