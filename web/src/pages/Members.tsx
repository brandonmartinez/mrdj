import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { orgApi, ApiRequestError } from '../api';
import type { OrgMember, OrgRole } from '../api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Trash2, UserPlus } from 'lucide-react';

const ROLES: OrgRole[] = ['owner', 'manager', 'dj', 'staff'];

export default function Members() {
  const { orgSlug = '' } = useParams();
  const [members, setMembers] = useState<OrgMember[] | null>(null);
  const [accountId, setAccountId] = useState('');
  const [role, setRole] = useState<OrgRole>('dj');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const { members } = await orgApi.listMembers(orgSlug).catch(() => ({ members: [] }));
    setMembers(members);
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [orgSlug]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!accountId.trim()) return;
    setBusy(true); setError(null);
    try {
      await orgApi.addMember(orgSlug, accountId.trim(), role);
      setAccountId('');
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not add member');
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(m: OrgMember, next: OrgRole) {
    try {
      await orgApi.updateMember(orgSlug, m.id, next);
      setMembers((cur) => cur?.map((x) => (x.id === m.id ? { ...x, role: next } : x)) ?? null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not update role');
    }
  }

  async function remove(m: OrgMember) {
    try {
      await orgApi.removeMember(orgSlug, m.id);
      setMembers((cur) => cur?.filter((x) => x.id !== m.id) ?? null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not remove member');
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Members</h1>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader><CardTitle className="text-lg">Team</CardTitle></CardHeader>
        <CardContent>
          {!members ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="w-40">Role</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="max-w-48 truncate font-medium">{m.displayName}</TableCell>
                    <TableCell className="max-w-64 truncate text-muted-foreground">{m.email}</TableCell>
                    <TableCell>
                      <Select value={m.role} onValueChange={(v) => changeRole(m, v as OrgRole)}>
                        <SelectTrigger className="h-8 capitalize"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ROLES.map((r) => <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => remove(m)} aria-label="Remove member">
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

      <Card>
        <CardHeader><CardTitle className="text-lg">Add member</CardTitle></CardHeader>
        <CardContent>
          <form className="flex flex-wrap items-end gap-3" onSubmit={add}>
            <div className="flex-1 space-y-2">
              <Label htmlFor="acct">Member account</Label>
              <Input id="acct" placeholder="Paste account reference" value={accountId} onChange={(e) => setAccountId(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as OrgRole)}>
                <SelectTrigger className="w-36 capitalize"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={busy || !accountId.trim()}>
              <UserPlus className="mr-1 h-4 w-4" /> Add
            </Button>
          </form>
          <p className="mt-3 text-xs text-muted-foreground">
            Email invites are coming soon.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
