import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { orgApi, ApiRequestError } from '../api';
import type { OrgBundle } from '../api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Plus, Pencil, Trash2 } from 'lucide-react';

function dollars(cents: number) { return `$${(cents / 100).toFixed(2)}`; }

interface Draft {
  label: string; credits: number; bonusCredits: number; priceCents: number; sortOrder: number; active: boolean;
}
const EMPTY: Draft = { label: '', credits: 5, bonusCredits: 0, priceCents: 500, sortOrder: 0, active: true };

export default function Pricing() {
  const { orgSlug = '' } = useParams();
  const [bundles, setBundles] = useState<OrgBundle[] | null>(null);
  const [editing, setEditing] = useState<OrgBundle | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setBundles(await orgApi.listBundles(orgSlug).catch(() => []));
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [orgSlug]);

  function openCreate() {
    setEditing(null);
    setDraft({ ...EMPTY, sortOrder: (bundles?.length ?? 0) + 1 });
    setError(null);
    setOpen(true);
  }
  function openEdit(b: OrgBundle) {
    setEditing(b);
    setDraft({
      label: b.label, credits: b.credits, bonusCredits: b.bonusCredits,
      priceCents: b.priceCents, sortOrder: b.sortOrder, active: b.active,
    });
    setError(null);
    setOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      if (editing) {
        await orgApi.updateBundle(orgSlug, editing.id, draft);
      } else {
        await orgApi.createBundle(orgSlug, draft);
      }
      setOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save bundle');
    } finally {
      setBusy(false);
    }
  }

  async function remove(b: OrgBundle) {
    try {
      await orgApi.deleteBundle(orgSlug, b.id);
      setBundles((cur) => cur?.filter((x) => x.id !== b.id) ?? null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not delete bundle');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Pricing</h1>
        <Button onClick={openCreate}><Plus className="mr-1 h-4 w-4" /> New bundle</Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader><CardTitle className="text-lg">Credit bundles</CardTitle></CardHeader>
        <CardContent>
          {!bundles ? (
            <Skeleton className="h-40 w-full" />
          ) : bundles.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No bundles configured.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead className="text-right">Credits</TableHead>
                  <TableHead className="text-right">Bonus</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {bundles.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.label}</TableCell>
                    <TableCell className="text-right">{b.credits}</TableCell>
                    <TableCell className="text-right">{b.bonusCredits ? `+${b.bonusCredits}` : '—'}</TableCell>
                    <TableCell className="text-right">{dollars(b.priceCents)}</TableCell>
                    <TableCell>
                      <Badge variant={b.active ? 'default' : 'secondary'}>{b.active ? 'Active' : 'Hidden'}</Badge>
                    </TableCell>
                    <TableCell className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(b)} aria-label="Edit">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => remove(b)} aria-label="Delete">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger className="hidden" />
        <DialogContent>
          <form onSubmit={save}>
            <DialogHeader>
              <DialogTitle>{editing ? 'Edit bundle' : 'New bundle'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="b-label">Label</Label>
                <Input id="b-label" value={draft.label} autoFocus
                  onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="b-credits">Credits</Label>
                  <Input id="b-credits" type="number" min={0} value={draft.credits}
                    onChange={(e) => setDraft({ ...draft, credits: Number(e.target.value) })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="b-bonus">Bonus credits</Label>
                  <Input id="b-bonus" type="number" min={0} value={draft.bonusCredits}
                    onChange={(e) => setDraft({ ...draft, bonusCredits: Number(e.target.value) })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="b-price">Price (cents)</Label>
                  <Input id="b-price" type="number" min={1} value={draft.priceCents}
                    onChange={(e) => setDraft({ ...draft, priceCents: Number(e.target.value) })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="b-sort">Sort order</Label>
                  <Input id="b-sort" type="number" value={draft.sortOrder}
                    onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) })} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={draft.active}
                  onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
                Visible to guests
              </label>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <DialogFooter>
              <Button type="submit" disabled={busy || !draft.label.trim()}>
                {busy ? 'Saving…' : 'Save bundle'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
