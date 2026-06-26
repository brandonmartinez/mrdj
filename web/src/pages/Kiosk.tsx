import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { ExternalLink } from 'lucide-react';
import { orgApi } from '../api';
import { Skeleton } from '@/components/ui/skeleton';

interface KioskBranding {
  orgName: string;
  orgLogoUrl: string | null;
  eventName: string;
}

export default function Kiosk() {
  const { orgSlug = '', eventSlug = '' } = useParams();
  const guestUrl = `${window.location.origin}/o/${orgSlug}/events/${eventSlug}`;
  const [branding, setBranding] = useState<KioskBranding | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      const [publicOrgResult, eventResult] = await Promise.allSettled([
        orgApi.publicOrg(orgSlug),
        orgApi.getEvent(orgSlug, eventSlug),
      ]);

      if (!active) return;

      const publicOrg = publicOrgResult.status === 'fulfilled' ? publicOrgResult.value : null;
      const eventDetail = eventResult.status === 'fulfilled' ? eventResult.value.event : null;
      const publicEvent = publicOrg?.events.find((event) => event.slug === eventSlug);

      if (!publicOrg && !eventDetail) {
        setError('Could not load this kiosk screen. The QR code is still available below.');
      }

      setBranding({
        orgName: publicOrg?.organization.name ?? orgSlug,
        orgLogoUrl: publicOrg?.organization.logoUrl ?? null,
        eventName: eventDetail?.name ?? publicEvent?.name ?? 'This event',
      });
      setLoading(false);
    }

    void load().catch(() => {
      if (!active) return;
      setError('Could not load this kiosk screen. The QR code is still available below.');
      setBranding({ orgName: orgSlug, orgLogoUrl: null, eventName: 'This event' });
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [orgSlug, eventSlug]);

  return (
    <main className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,_hsl(var(--primary)/0.28),_transparent_34rem),linear-gradient(135deg,_hsl(var(--background)),_hsl(var(--muted)))] text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col items-center justify-center gap-8 px-5 py-8 text-center sm:px-8 lg:grid lg:grid-cols-[1fr_minmax(360px,520px)] lg:gap-12 lg:text-left">
        <section className="space-y-6">
          {loading ? (
            <>
              <Skeleton className="mx-auto h-20 w-20 rounded-3xl lg:mx-0" />
              <Skeleton className="mx-auto h-14 w-72 max-w-full lg:mx-0" />
              <Skeleton className="mx-auto h-24 w-[34rem] max-w-full lg:mx-0" />
            </>
          ) : (
            <>
              <div className="flex justify-center lg:justify-start">
                {branding?.orgLogoUrl ? (
                  <img
                    src={branding.orgLogoUrl}
                    alt={`${branding.orgName} logo`}
                    className="h-20 w-20 rounded-3xl border bg-background object-cover shadow-lg"
                  />
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded-3xl border bg-card text-3xl font-black uppercase shadow-lg">
                    {(branding?.orgName ?? orgSlug).slice(0, 1)}
                  </div>
                )}
              </div>
              <div>
                <p className="mx-auto max-w-full truncate text-lg font-semibold uppercase tracking-[0.32em] text-primary lg:mx-0">
                  {branding?.orgName ?? orgSlug}
                </p>
                <h1 className="mt-3 text-5xl font-black tracking-tight sm:text-7xl lg:text-8xl">
                  Scan to request
                </h1>
                <p className="mx-auto mt-4 max-w-3xl line-clamp-2 text-2xl font-semibold text-muted-foreground sm:text-3xl lg:mx-0">
                  {branding?.eventName ?? 'This event'}
                </p>
              </div>
              {error && <p className="max-w-xl text-sm text-destructive">{error}</p>}
            </>
          )}
        </section>

        <section className="w-full max-w-[520px] space-y-5">
          <div data-testid="kiosk-qr" className="rounded-[2rem] border bg-white p-5 shadow-2xl sm:p-8">
            <QRCodeSVG value={guestUrl} size={480} level="M" className="h-full w-full" />
          </div>
          <div className="space-y-3 text-center">
            <p className="rounded-full border bg-background/80 px-4 py-3 text-sm text-muted-foreground shadow-sm backdrop-blur">
              Scan the code or open the guest jukebox.
            </p>
            <Link
              to={`/o/${orgSlug}/events/${eventSlug}`}
              className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
            >
              Open guest jukebox <ExternalLink className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
