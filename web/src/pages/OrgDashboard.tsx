import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { orgApi } from '../api';
import type { OrgEvent, ConnectStatus, OrgPaymentsSummary } from '../api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertTriangle, ArrowRight, CheckCircle2, Music2 } from 'lucide-react';

function dollars(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function OrgDashboard() {
  const { orgSlug = '' } = useParams();
  const navigate = useNavigate();
  const [events, setEvents] = useState<OrgEvent[] | null>(null);
  const [connect, setConnect] = useState<ConnectStatus | null>(null);
  const [summary, setSummary] = useState<OrgPaymentsSummary | null>(null);
  const [logoUrl, setLogoUrl] = useState('');
  const [heroUrl, setHeroUrl] = useState('');
  const [brandingSaving, setBrandingSaving] = useState(false);
  const [brandingMessage, setBrandingMessage] = useState<string | null>(null);
  const [brandingError, setBrandingError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [ev, cs, pay, org] = await Promise.all([
        orgApi.listEvents(orgSlug).catch(() => ({ events: [] })),
        orgApi.connectStatus(orgSlug).catch(() => null),
        orgApi.payments(orgSlug).catch(() => null),
        orgApi.getOrg(orgSlug).catch(() => null),
      ]);
      if (!active) return;
      setEvents(ev.events);
      setConnect(cs);
      setSummary(pay?.summary ?? null);
      setLogoUrl(org?.organization.logoUrl ?? '');
      setHeroUrl(org?.organization.heroUrl ?? '');
    })();
    return () => { active = false; };
  }, [orgSlug]);

  const liveEvents = events?.filter((e) => e.status === 'live').length ?? 0;
  const firstLiveEvent = events?.find((e) => e.status === 'live');

  async function handleBrandingSave() {
    setBrandingSaving(true);
    setBrandingError(null);
    setBrandingMessage(null);
    try {
      const updated = await orgApi.updateOrg(orgSlug, {
        logoUrl: logoUrl.trim() || null,
        heroUrl: heroUrl.trim() || null,
      });
      setLogoUrl(updated.organization.logoUrl ?? '');
      setHeroUrl(updated.organization.heroUrl ?? '');
      setBrandingMessage('Branding saved.');
    } catch (err) {
      setBrandingError(err instanceof Error ? err.message : 'Could not save branding.');
    } finally {
      setBrandingSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <div className="flex gap-2">
          {firstLiveEvent && (
            <Button
              asChild
              variant="outline"
              size="sm"
              data-testid="dashboard-console-shortcut"
            >
              <Link to={`/o/${orgSlug}/events/${firstLiveEvent.slug}/console`}>
                <Music2 className="mr-1.5 h-4 w-4" /> Console
              </Link>
            </Button>
          )}
          <Button asChild>
            <Link to={`/o/${orgSlug}/events`}>Manage events</Link>
          </Button>
        </div>
      </div>

      {connect && !connect.chargesEnabled && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />
            <div className="flex-1 text-sm">
              <p className="font-medium">Finish Stripe setup to accept payments</p>
              <p className="text-muted-foreground">
                Guests can't purchase credits until your payouts are enabled.
              </p>
            </div>
            <Button asChild size="sm">
              <Link to={`/o/${orgSlug}/earnings`}>Set up <ArrowRight className="ml-1 h-4 w-4" /></Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Events" value={events ? String(events.length) : null} hint={`${liveEvents} live now`} />
        <StatCard label="Net earnings" value={summary ? dollars(summary.netCents) : null} hint={summary ? `${summary.count} payments` : ''} />
        <StatCard label="Gross sales" value={summary ? dollars(summary.grossCents) : null} hint={summary ? `${dollars(summary.feeCents)} fees` : ''} />
        <StatCard
          label="Payments"
          value={connect ? (connect.chargesEnabled ? 'Active' : 'Setup') : null}
          hint={connect?.chargesEnabled ? 'Charges enabled' : 'Needs Stripe'}
          ok={connect?.chargesEnabled}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Branding</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="settings-logo-url">Logo image link</Label>
              <Input
                id="settings-logo-url"
                data-testid="settings-logo-url"
                type="url"
                inputMode="url"
                placeholder="Paste logo image link"
                value={logoUrl}
                onChange={(event) => setLogoUrl(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="settings-hero-url">Hero image link</Label>
              <Input
                id="settings-hero-url"
                data-testid="settings-hero-url"
                type="url"
                inputMode="url"
                placeholder="Paste hero image link"
                value={heroUrl}
                onChange={(event) => setHeroUrl(event.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              data-testid="settings-branding-save"
              onClick={handleBrandingSave}
              disabled={brandingSaving}
            >
              {brandingSaving ? 'Saving…' : 'Save branding'}
            </Button>
            {brandingMessage && <p className="text-sm text-emerald-600">{brandingMessage}</p>}
            {brandingError && <p className="text-sm text-destructive">{brandingError}</p>}
          </div>
          <p className="text-xs text-muted-foreground">
            Use secure image links. Leave either field blank to remove that image.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent events</CardTitle>
        </CardHeader>
        <CardContent>
          {!events ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : events.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No events yet.{' '}
              <Link className="text-primary underline" to={`/o/${orgSlug}/events`}>Create your first event</Link>.
            </div>
          ) : (
            <ul className="divide-y">
              {events.slice(0, 5).map((e) => (
                <li
                  key={e.id}
                  data-testid="recent-event-row"
                  className="flex cursor-pointer items-center justify-between py-3 transition-colors hover:bg-muted/50 -mx-6 px-6 rounded-md"
                  onClick={() => navigate(`/o/${orgSlug}/events/${e.slug}/manage`)}
                  onKeyDown={(evt) => {
                    if (evt.key === 'Enter' || evt.key === ' ') {
                      evt.preventDefault();
                      navigate(`/o/${orgSlug}/events/${e.slug}/manage`);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open ${e.name} event`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{e.name}</p>
                    <p className="text-xs text-muted-foreground">{e.areaCount} area{e.areaCount === 1 ? '' : 's'}</p>
                  </div>
                  <Badge variant={e.status === 'live' ? 'default' : 'secondary'} className="capitalize">{e.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, hint, ok }: { label: string; value: string | null; hint?: string; ok?: boolean }) {
  return (
    <Card>
      <CardContent className="py-5">
        <p className="text-sm text-muted-foreground">{label}</p>
        {value === null ? (
          <Skeleton className="mt-2 h-8 w-20" />
        ) : (
          <p className="mt-1 flex items-center gap-1.5 text-2xl font-semibold">
            {ok && <CheckCircle2 className="h-5 w-5 text-emerald-500" />}
            {value}
          </p>
        )}
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
