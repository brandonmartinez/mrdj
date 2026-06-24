import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useSession } from '../context/session';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ThemeToggle } from '../components/ThemeToggle';
import { Music } from 'lucide-react';

export default function Login() {
  const { refresh } = useSession();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  // Dev convenience: act-as an admin account without Google SSO. 403s in prod.
  async function devSignIn() {
    setBusy(true);
    try {
      await api.actAs('admin');
      await refresh();
      navigate('/');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-2 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <Music className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">Welcome to mrdj</CardTitle>
          <CardDescription>Sign in to manage your events and DJ console.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button asChild className="w-full">
            <a href="/api/auth/google">Continue with Google</a>
          </Button>
          <div className="relative py-1">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">or</span>
            </div>
          </div>
          <Button variant="outline" className="w-full" disabled={busy} onClick={devSignIn}>
            {busy ? 'Signing in…' : 'Dev sign-in (admin)'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
