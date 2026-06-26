import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { orgApi, ApiRequestError } from '../api';
import { useSession } from '../context/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ThemeToggle } from '../components/ThemeToggle';

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}

export default function Onboarding() {
  const { refresh } = useSession();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugDirty, setSlugDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveSlug = slugDirty ? slug : slugify(name);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { organization } = await orgApi.createOrg(effectiveSlug, name.trim());
      await refresh();
      navigate(`/o/${organization.slug}/dashboard`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not create organization');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Create your organization</CardTitle>
          <CardDescription>This is the brand guests see at your events.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="name">Organization name</Label>
              <Input
                id="name"
                value={name}
                autoFocus
                placeholder="Sunset Sounds DJ Co."
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="slug">Public slug</Label>
              <Input
                id="slug"
                value={effectiveSlug}
                placeholder="sunset-sounds"
                onChange={(e) => { setSlugDirty(true); setSlug(slugify(e.target.value)); }}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy || !name.trim() || !effectiveSlug}>
              {busy ? 'Creating…' : 'Create organization'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
