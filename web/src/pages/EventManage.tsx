import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { orgApi, ApiRequestError } from '../api';
import type { EventDetail, OrgArea } from '../api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Plus, Trash2, SlidersHorizontal, ExternalLink, Save, QrCode, Printer } from 'lucide-react';

type Status = 'draft' | 'live' | 'ended';

export default function EventManage() {
  const { orgSlug = '', eventSlug = '' } = useParams();
  const guestUrl = `${window.location.origin}/o/${orgSlug}/events/${eventSlug}`;
  const kioskPath = `/o/${orgSlug}/events/${eventSlug}/kiosk`;
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [areas, setAreas] = useState<OrgArea[] | null>(null);
  const [name, setName] = useState('');
  const [status, setStatus] = useState<Status>('draft');
  const [savingMeta, setSavingMeta] = useState(false);
  const [newArea, setNewArea] = useState('');
  const [busyArea, setBusyArea] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [ev, ar] = await Promise.all([
      orgApi.getEvent(orgSlug, eventSlug),
      orgApi.listAreas(orgSlug, eventSlug).catch(() => ({ areas: [] })),
    ]);
    setEvent(ev.event);
    setName(ev.event.name);
    setStatus(ev.event.status);
    setAreas(ar.areas);
  }
  useEffect(() => { void load().catch(() => setError('Could not load event')); /* eslint-disable-next-line */ }, [orgSlug, eventSlug]);

  async function saveMeta() {
    setSavingMeta(true);
    setError(null);
    try {
      const { event } = await orgApi.updateEvent(orgSlug, eventSlug, { name: name.trim(), status });
      setEvent(event);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save');
    } finally {
      setSavingMeta(false);
    }
  }

  async function addArea(e: React.FormEvent) {
    e.preventDefault();
    if (!newArea.trim()) return;
    setBusyArea(true);
    try {
      await orgApi.createArea(orgSlug, eventSlug, newArea.trim());
      setNewArea('');
      const { areas } = await orgApi.listAreas(orgSlug, eventSlug);
      setAreas(areas);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not add area');
    } finally {
      setBusyArea(false);
    }
  }

  async function removeArea(id: string) {
    try {
      await orgApi.deleteArea(orgSlug, eventSlug, id);
      setAreas((cur) => cur?.filter((a) => a.id !== id) ?? null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not delete area');
    }
  }

  if (!event) {
    return <div className="space-y-4"><Skeleton className="h-9 w-64" /><Skeleton className="h-40 w-full" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to={`/o/${orgSlug}/events`} className="text-sm text-muted-foreground hover:underline">← Events</Link>
          <h1 className="flex min-w-0 items-center gap-2 text-2xl font-semibold">
            <span className="min-w-0 truncate">{event.name}</span>
            <Badge variant={event.status === 'live' ? 'default' : 'secondary'} className="capitalize">{event.status}</Badge>
          </h1>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to={`/o/${orgSlug}/events/${eventSlug}/console`}>
              <SlidersHorizontal className="mr-1 h-4 w-4" /> DJ console
            </Link>
          </Button>
          <Button asChild variant="ghost">
            <Link to={`/o/${orgSlug}/events/${eventSlug}`} target="_blank">
              <ExternalLink className="mr-1 h-4 w-4" /> Guest view
            </Link>
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader><CardTitle className="text-lg">Event settings</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="live">Live</SelectItem>
                  <SelectItem value="ended">Ended</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button onClick={saveMeta} disabled={savingMeta || !name.trim()}>
            <Save className="mr-1 h-4 w-4" /> {savingMeta ? 'Saving…' : 'Save changes'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <QrCode className="h-5 w-5" /> Guest QR code
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 md:grid-cols-[220px_1fr]">
          <div data-testid="event-qr" className="rounded-2xl border bg-white p-4 shadow-sm">
            <QRCodeSVG value={guestUrl} size={188} level="M" className="h-full w-full" />
          </div>
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium text-foreground">Guests scan this to request songs.</p>
              <p className="mt-1 text-sm text-muted-foreground">Guest link is encoded in the QR code.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline">
                    <QrCode className="mr-1 h-4 w-4" /> Enlarge / print
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-xl">
                  <DialogHeader>
                    <DialogTitle>{event.name} guest QR</DialogTitle>
                    <DialogDescription>Print or project this code so guests can open the jukebox.</DialogDescription>
                  </DialogHeader>
                  <div className="mx-auto rounded-3xl border bg-white p-6">
                    <QRCodeSVG value={guestUrl} size={360} level="M" className="h-full w-full" />
                  </div>
                  <Button onClick={() => window.print()}>
                    <Printer className="mr-1 h-4 w-4" /> Print
                  </Button>
                </DialogContent>
              </Dialog>
              <Button asChild variant="secondary">
                <Link data-testid="open-kiosk" to={kioskPath} target="_blank">
                  <ExternalLink className="mr-1 h-4 w-4" /> Open kiosk
                </Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Areas</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {!areas ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <ul className="divide-y rounded-md border">
              {areas.map((a) => (
                <li key={a.id} className="flex items-center justify-between px-3 py-2.5">
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="min-w-0 truncate">{a.name}</span>
                    {a.isDefault && <Badge variant="outline">Default</Badge>}
                  </span>
                  {!a.isDefault && (
                    <Button variant="ghost" size="icon" onClick={() => removeArea(a.id)} aria-label="Delete area">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <form className="flex gap-2" onSubmit={addArea}>
            <Input placeholder="Add an area (e.g. Patio)" value={newArea} onChange={(e) => setNewArea(e.target.value)} />
            <Button type="submit" disabled={busyArea || !newArea.trim()}>
              <Plus className="mr-1 h-4 w-4" /> Add
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
