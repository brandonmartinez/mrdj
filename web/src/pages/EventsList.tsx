import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { orgApi, ApiRequestError } from '../api';
import type { OrgEvent } from '../api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Plus, Settings, ExternalLink } from 'lucide-react';

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}

export default function EventsList() {
  const { orgSlug = '' } = useParams();
  const [events, setEvents] = useState<OrgEvent[] | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugDirty, setSlugDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveSlug = slugDirty ? slug : slugify(name);

  async function load() {
    const { events } = await orgApi.listEvents(orgSlug).catch(() => ({ events: [] }));
    setEvents(events);
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [orgSlug]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await orgApi.createEvent(orgSlug, { slug: effectiveSlug, name: name.trim() });
      setOpen(false);
      setName(''); setSlug(''); setSlugDirty(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not create event');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Events</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-1 h-4 w-4" /> New event</Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={create}>
              <DialogHeader>
                <DialogTitle>Create event</DialogTitle>
                <DialogDescription>A default “Main Floor” area is created automatically.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="ev-name">Event name</Label>
                  <Input id="ev-name" autoFocus value={name} placeholder="Saturday Night"
                    onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ev-slug">Public slug</Label>
                  <Input id="ev-slug" value={effectiveSlug} placeholder="saturday-night"
                    onChange={(e) => { setSlugDirty(true); setSlug(slugify(e.target.value)); }} />
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
              </div>
              <DialogFooter>
                <Button type="submit" disabled={busy || !name.trim() || !effectiveSlug}>
                  {busy ? 'Creating…' : 'Create event'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {!events ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : events.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
          No events yet. Create your first one to get started.
        </CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {events.map((e) => (
            <Card key={e.id}>
              <CardContent className="flex items-center gap-4 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{e.name}</span>
                    <Badge variant={e.status === 'live' ? 'default' : 'secondary'} className="capitalize">{e.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Guest page ready · {e.areaCount} area{e.areaCount === 1 ? '' : 's'}
                  </p>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link to={`/o/${orgSlug}/events/${e.slug}/manage`}><Settings className="mr-1 h-4 w-4" /> Manage</Link>
                </Button>
                <Button asChild variant="ghost" size="sm">
                  <Link to={`/o/${orgSlug}/events/${e.slug}`} target="_blank">
                    <ExternalLink className="mr-1 h-4 w-4" /> Guest view
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
