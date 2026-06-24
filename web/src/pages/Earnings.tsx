import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { orgApi, ApiRequestError } from '../api';
import type { ConnectStatus, OrgPayment, OrgPaymentsSummary } from '../api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react';

function dollars(cents: number) { return `$${(cents / 100).toFixed(2)}`; }

export default function Earnings() {
  const { orgSlug = '' } = useParams();
  const [connect, setConnect] = useState<ConnectStatus | null>(null);
  const [payments, setPayments] = useState<OrgPayment[] | null>(null);
  const [summary, setSummary] = useState<OrgPaymentsSummary | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [cs, pay] = await Promise.all([
      orgApi.connectStatus(orgSlug).catch(() => null),
      orgApi.payments(orgSlug).catch(() => null),
    ]);
    setConnect(cs);
    setPayments(pay?.payments ?? []);
    setSummary(pay?.summary ?? null);
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [orgSlug]);

  async function startConnect() {
    setConnecting(true); setError(null);
    try {
      const { url } = await orgApi.connectStart(orgSlug);
      window.location.href = url;
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not start Stripe onboarding');
      setConnecting(false);
    }
  }

  async function refund(p: OrgPayment) {
    setError(null);
    try {
      await orgApi.refund(orgSlug, p.id, 'money');
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Refund failed');
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Earnings</h1>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader><CardTitle className="text-lg">Payment setup</CardTitle></CardHeader>
        <CardContent>
          {!connect ? (
            <Skeleton className="h-12 w-full" />
          ) : connect.chargesEnabled ? (
            <div className="flex items-center gap-3 text-sm">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              <div>
                <p className="font-medium">Stripe connected</p>
                <p className="text-muted-foreground">
                  Charges enabled · Payouts {connect.payoutsEnabled ? 'enabled' : 'pending'}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              <div className="flex-1 text-sm">
                <p className="font-medium">Connect Stripe to accept payments</p>
                <p className="text-muted-foreground">Guests can't buy credits until onboarding is complete.</p>
              </div>
              <Button onClick={startConnect} disabled={connecting}>
                {connecting ? 'Redirecting…' : <>Set up Stripe <ExternalLink className="ml-1 h-4 w-4" /></>}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <Summary label="Net earnings" value={summary ? dollars(summary.netCents) : null} />
        <Summary label="Gross sales" value={summary ? dollars(summary.grossCents) : null} />
        <Summary label="Platform fees" value={summary ? dollars(summary.feeCents) : null} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-lg">Payments</CardTitle></CardHeader>
        <CardContent>
          {!payments ? (
            <Skeleton className="h-40 w-full" />
          ) : payments.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No payments yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  <TableHead className="text-right">Credits</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="text-muted-foreground">{new Date(p.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right">{dollars(p.amountCents)}</TableCell>
                    <TableCell className="text-right">{dollars(p.netCents)}</TableCell>
                    <TableCell className="text-right">{p.creditsGranted}</TableCell>
                    <TableCell>
                      <Badge variant={p.status === 'succeeded' ? 'default' : 'secondary'} className="capitalize">{p.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {p.status === 'succeeded' && (
                        <Button variant="ghost" size="sm" onClick={() => refund(p)}>Refund</Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string | null }) {
  return (
    <Card>
      <CardContent className="py-5">
        <p className="text-sm text-muted-foreground">{label}</p>
        {value === null ? <Skeleton className="mt-2 h-8 w-24" /> : <p className="mt-1 text-2xl font-semibold">{value}</p>}
      </CardContent>
    </Card>
  );
}
