import { useState, useEffect, useRef, useCallback } from 'react';
import { api, orgApi, ApiRequestError } from '../api';
import type { Track, QueueView, Bundle, PurchaseIntent } from '../api';
import { StripeCheckout } from './StripeCheckout';

export interface PendingAction {
  track: Track;
  tier: 'queue' | 'boost' | 'play_next';
  idempotencyKey: string;
}

interface ConfirmModalProps {
  action: PendingAction;
  queueView: QueueView;
  creditBalance: number;
  bundles: Bundle[];
  eventSlug: string;
  orgSlug: string;
  onSuccess: (update: { queueView: QueueView; creditBalance: number }) => void;
  onCancel: () => void;
}

type Phase = 'confirm' | 'insufficient' | 'bundles' | 'purchasing' | 'payment' | 'processing' | 'success' | 'error';

function fmtCents(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function tierLabel(tier: 'queue' | 'boost' | 'play_next') {
  return tier === 'queue' ? 'Add to Queue' : tier === 'boost' ? 'Boost' : 'Play Next';
}

export function ConfirmModal({
  action,
  queueView,
  creditBalance: initialBalance,
  bundles,
  eventSlug,
  orgSlug,
  onSuccess,
  onCancel,
}: ConfirmModalProps) {
  const { track, tier, idempotencyKey } = action;
  const cost = tier === 'queue'
    ? queueView.pricing.queue
    : tier === 'boost'
    ? queueView.pricing.boost
    : queueView.pricing.playNext;

  const [phase, setPhase] = useState<Phase>(
    initialBalance < cost ? 'insufficient' : 'confirm'
  );
  const [currentBalance, setCurrentBalance] = useState(initialBalance);
  const [errorMsg, setErrorMsg] = useState('');
  const [selectedBundle, setSelectedBundle] = useState<Bundle | null>(null);
  const [intent, setIntent] = useState<PurchaseIntent | null>(null);
  const firstFocusRef = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Focus first interactive element on open
  useEffect(() => {
    const t = setTimeout(() => firstFocusRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [phase]);

  // Escape to cancel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  // Re-evaluate phase if balance changes (after buying credits)
  useEffect(() => {
    if (phase === 'insufficient' && currentBalance >= cost) {
      setPhase('confirm');
    }
  }, [currentBalance, cost, phase]);

  const handleConfirm = useCallback(async () => {
    setPhase('processing');
    try {
      const result = await api.request(eventSlug, track.id, tier, idempotencyKey);
      setPhase('success');
      setTimeout(() => {
        onSuccess({ queueView: result.queueView, creditBalance: result.creditBalance });
      }, 900);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.code === 'insufficient_credits') {
          setCurrentBalance(err.extra.balance ?? currentBalance);
          setPhase('insufficient');
        } else if (err.code === 'play_next_unavailable') {
          setErrorMsg('The Play Next slot was just taken by someone else.');
          setPhase('error');
        } else {
          setErrorMsg(err.message);
          setPhase('error');
        }
      } else {
        setErrorMsg('An unexpected error occurred. Please try again.');
        setPhase('error');
      }
    }
  }, [eventSlug, track.id, tier, idempotencyKey, currentBalance, onSuccess]);

  const handlePurchase = useCallback(async () => {
    if (!selectedBundle) return;
    setPhase('purchasing');
    const clientRequestId = crypto.randomUUID();
    try {
      // Preferred path (#86): real Connect destination charge via Stripe Payment Element.
      const purchaseIntent = await orgApi.purchase(orgSlug, selectedBundle.id, clientRequestId);
      setIntent(purchaseIntent);
      setPhase('payment');
    } catch (err) {
      // Dev/keyless fallback: when the org hasn't completed Stripe onboarding the
      // purchase endpoint returns 402 payments_unavailable — use the stub so local
      // demos still work end-to-end. Any other error surfaces normally.
      if (err instanceof ApiRequestError && err.code === 'payments_unavailable') {
        const checkoutKey = `checkout-${selectedBundle.id}-${clientRequestId}`;
        try {
          const session = await api.checkoutSession(selectedBundle.id);
          const result = await api.checkoutComplete(session.sessionId, checkoutKey);
          setCurrentBalance(result.creditBalance);
          setSelectedBundle(null);
          setPhase(result.creditBalance >= cost ? 'confirm' : 'insufficient');
        } catch (stubErr) {
          setErrorMsg(stubErr instanceof Error ? stubErr.message : 'Checkout failed. Try again.');
          setPhase('error');
        }
        return;
      }
      setErrorMsg(err instanceof Error ? err.message : 'Checkout failed. Try again.');
      setPhase('error');
    }
  }, [selectedBundle, cost, orgSlug]);

  // After a successful card confirmation, credits are granted asynchronously by the
  // Stripe webhook. Poll the org-scoped queue balance until it reflects the grant.
  const handlePaid = useCallback(async () => {
    setPhase('processing');
    const before = currentBalance;
    for (let i = 0; i < 12; i++) {
      try {
        const view = await api.queue(eventSlug);
        if (view.creditBalance > before) {
          setCurrentBalance(view.creditBalance);
          setSelectedBundle(null);
          setIntent(null);
          setPhase(view.creditBalance >= cost ? 'confirm' : 'insufficient');
          return;
        }
      } catch {
        // transient — keep polling
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    // Grant hasn't landed yet (webhook delay). Optimistically credit the purchased amount.
    const granted = before + (intent?.credits ?? 0);
    setCurrentBalance(granted);
    setSelectedBundle(null);
    setIntent(null);
    setPhase(granted >= cost ? 'confirm' : 'insufficient');
  }, [currentBalance, eventSlug, cost, intent]);

  const resultingBalance = currentBalance - cost;

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4"
      onClick={(e) => { if (e.target === overlayRef.current) onCancel(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" aria-hidden />

      {/* Card */}
      <div className="relative w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl overflow-hidden">

        {/* ── CONFIRM ─────────────────────────────────────── */}
        {phase === 'confirm' && (
          <>
            <div className="p-5 border-b border-zinc-800">
              <div className="flex items-center gap-3">
                <img
                  src={track.artworkUrl}
                  alt={track.title}
                  className="w-14 h-14 rounded-lg object-cover flex-shrink-0"
                />
                <div className="min-w-0">
                  <p id="modal-title" className="text-white font-bold truncate">{track.title}</p>
                  <p className="text-zinc-400 text-sm truncate">{track.artist}</p>
                </div>
              </div>
            </div>

            <div className="p-5 space-y-3">
              <div className="bg-zinc-800/60 rounded-xl p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-400">Action</span>
                  <span className="text-white font-medium">{tierLabel(tier)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-400">Cost</span>
                  <span className={cost === 0 ? 'text-green-400 font-medium' : 'text-white font-medium'}>
                    {cost === 0 ? 'Free' : `${cost} credit${cost !== 1 ? 's' : ''}`}
                  </span>
                </div>
                <div className="border-t border-zinc-700 pt-2 flex justify-between text-sm">
                  <span className="text-zinc-400">Balance after</span>
                  <span className={`font-bold ${resultingBalance < 0 ? 'text-red-400' : 'text-violet-300'}`}>
                    {resultingBalance} credits
                  </span>
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  onClick={onCancel}
                  className="flex-1 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  ref={firstFocusRef}
                  onClick={() => void handleConfirm()}
                  className="flex-1 py-3 rounded-xl bg-violet-700 hover:bg-violet-600 text-white text-sm font-bold transition-colors"
                >
                  Confirm
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── PROCESSING ──────────────────────────────────── */}
        {(phase === 'processing' || phase === 'purchasing') && (
          <div className="p-10 flex flex-col items-center gap-4" role="status" aria-live="polite">
            <div className="w-10 h-10 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-zinc-400 text-sm">
              {phase === 'processing' ? 'Requesting track…' : 'Processing payment…'}
            </p>
          </div>
        )}

        {/* ── SUCCESS ─────────────────────────────────────── */}
        {phase === 'success' && (
          <div className="p-10 flex flex-col items-center gap-3" role="status" aria-live="polite">
            <div className="w-14 h-14 rounded-full bg-green-900/50 flex items-center justify-center">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-green-400">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <p className="text-white font-bold text-lg">
              {tier === 'queue' ? 'Added to queue!' : tier === 'boost' ? 'Boosted!' : "You're next!"}
            </p>
            <p className="text-zinc-400 text-sm text-center">{track.title}</p>
          </div>
        )}

        {/* ── INSUFFICIENT CREDITS ────────────────────────── */}
        {phase === 'insufficient' && (
          <>
            <div className="p-5 border-b border-zinc-800">
              <p id="modal-title" className="text-white font-bold text-lg">Not enough credits</p>
              <p className="text-zinc-400 text-sm mt-1">
                {tierLabel(tier)} costs <strong className="text-white">{cost}</strong> credit{cost !== 1 ? 's' : ''} but
                you have <strong className="text-violet-300">{currentBalance}</strong>.
              </p>
            </div>
            <div className="p-5 flex gap-2">
              <button onClick={onCancel} className="flex-1 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-colors">
                Cancel
              </button>
              <button
                ref={firstFocusRef}
                onClick={() => setPhase('bundles')}
                className="flex-1 py-3 rounded-xl bg-violet-700 hover:bg-violet-600 text-white text-sm font-bold transition-colors"
              >
                Buy credits
              </button>
            </div>
          </>
        )}

        {/* ── BUNDLES ─────────────────────────────────────── */}
        {phase === 'bundles' && (
          <>
            <div className="p-5 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <p id="modal-title" className="text-white font-bold text-lg">Buy credits</p>
                <p className="text-zinc-500 text-xs mt-0.5">
                  You need {cost - currentBalance} more to {tierLabel(tier).toLowerCase()}
                </p>
              </div>
              <button onClick={() => setPhase('insufficient')} className="text-zinc-500 hover:text-zinc-300 transition-colors" aria-label="Back">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </button>
            </div>

            <div className="p-4 space-y-2.5">
              {bundles.map((b) => {
                const totalCredits = b.credits + b.bonusCredits;
                const isSelected = selectedBundle?.id === b.id;
                return (
                  <button
                    key={b.id}
                    onClick={() => setSelectedBundle(isSelected ? null : b)}
                    className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all text-left ${
                      isSelected
                        ? 'bg-violet-900/50 border-violet-500'
                        : 'bg-zinc-800/60 border-zinc-700 hover:border-zinc-600'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-white font-bold">{b.label}</span>
                        {b.discountPct > 0 && (
                          <span className="bg-green-900/60 text-green-400 text-xs font-bold px-1.5 py-0.5 rounded-full">
                            SAVE {Math.round(b.discountPct)}%
                          </span>
                        )}
                      </div>
                      <div className="text-zinc-400 text-sm mt-0.5">
                        {b.credits} credits
                        {b.bonusCredits > 0 && (
                          <span className="text-green-400"> + {b.bonusCredits} bonus</span>
                        )}
                        <span className="text-zinc-600"> = {totalCredits} total</span>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0 ml-4">
                      <p className="text-white font-black text-lg">{fmtCents(b.priceCents)}</p>
                      <p className="text-zinc-500 text-xs">
                        {(b.priceCents / totalCredits / 100).toFixed(3)}/cr
                      </p>
                    </div>
                  </button>
                );
              })}

              <button
                ref={firstFocusRef}
                onClick={() => void handlePurchase()}
                disabled={!selectedBundle}
                className="w-full py-3.5 rounded-xl bg-violet-700 hover:bg-violet-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold transition-colors mt-2"
              >
                {selectedBundle ? `Purchase ${selectedBundle.label} — ${fmtCents(selectedBundle.priceCents)}` : 'Select a bundle'}
              </button>

              <p className="text-center text-zinc-600 text-xs">
                Secure checkout — card details are processed by Stripe
              </p>
            </div>
          </>
        )}

        {/* ── PAYMENT (Stripe Payment Element, #86) ───────── */}
        {phase === 'payment' && intent && selectedBundle && (
          <>
            <div className="p-5 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <p id="modal-title" className="text-white font-bold text-lg">Checkout</p>
                <p className="text-zinc-500 text-xs mt-0.5">
                  {selectedBundle.label} — {selectedBundle.credits + selectedBundle.bonusCredits} credits
                </p>
              </div>
              <button onClick={() => { setIntent(null); setPhase('bundles'); }} className="text-zinc-500 hover:text-zinc-300 transition-colors" aria-label="Back">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </button>
            </div>
            <div className="p-5">
              <StripeCheckout
                clientSecret={intent.clientSecret}
                publishableKey={intent.publishableKey}
                amountLabel={fmtCents(intent.amountCents)}
                onPaid={() => void handlePaid()}
                onCancel={() => { setIntent(null); setPhase('bundles'); }}
              />
            </div>
          </>
        )}

        {/* ── ERROR ───────────────────────────────────────── */}
        {phase === 'error' && (
          <div className="p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-red-900/50 flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-400">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 8v4m0 4h.01" />
                </svg>
              </div>
              <div>
                <p id="modal-title" className="text-white font-bold">Something went wrong</p>
                <p className="text-zinc-400 text-sm mt-1">{errorMsg}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={onCancel} className="flex-1 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-colors">
                Dismiss
              </button>
              <button
                ref={firstFocusRef}
                onClick={() => setPhase('confirm')}
                className="flex-1 py-3 rounded-xl bg-violet-700 hover:bg-violet-600 text-white text-sm font-bold transition-colors"
              >
                Try again
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
