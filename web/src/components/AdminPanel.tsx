import { useState } from 'react';
import { api } from '../api';
import type { QueueView } from '../api';

// Known seed guest user ID — used when admin role is active
const GUEST_SEED_ID = '00000000-0000-0000-0000-000000000003';

interface AdminPanelProps {
  guestUserId: string | null;
  eventSlug: string;
  onCreditsGranted: (balance: number) => void;
  onQueueAdvanced: (queueView: QueueView) => void;
  showToast: (msg: string, type: 'success' | 'error') => void;
}

export function AdminPanel({
  guestUserId,
  eventSlug,
  onCreditsGranted,
  onQueueAdvanced,
  showToast,
}: AdminPanelProps) {
  const [targetUserId, setTargetUserId] = useState(guestUserId ?? GUEST_SEED_ID);
  const [amount, setAmount] = useState(10);
  const [note, setNote] = useState('Admin grant');
  const [grantBusy, setGrantBusy] = useState(false);
  const [advanceBusy, setAdvanceBusy] = useState(false);

  async function handleGrant() {
    if (!targetUserId.trim() || amount <= 0) return;
    setGrantBusy(true);
    try {
      const idempotencyKey = crypto.randomUUID();
      const result = await api.adminGrant(targetUserId.trim(), amount, note || 'Admin grant', idempotencyKey);
      onCreditsGranted(result.balance);
      showToast(`Granted ${amount} credits. New balance: ${result.balance}`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Grant failed', 'error');
    } finally {
      setGrantBusy(false);
    }
  }

  async function handleAdvance() {
    setAdvanceBusy(true);
    try {
      const result = await api.adminAdvance(eventSlug);
      onQueueAdvanced(result.queueView);
      showToast('Queue advanced. Cover Flow updated!', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Advance failed', 'error');
    } finally {
      setAdvanceBusy(false);
    }
  }

  return (
    <div className="mx-4 rounded-2xl border border-yellow-700/40 bg-yellow-950/20 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-yellow-800/30 flex items-center gap-2">
        <span className="text-yellow-500 text-sm" aria-hidden>⚙️</span>
        <h2 className="text-yellow-300 font-bold text-sm tracking-wide uppercase">Admin Panel</h2>
        <span className="text-yellow-700 text-xs ml-auto">dev only</span>
      </div>

      <div className="p-4 space-y-5">
        {/* Grant Credits */}
        <div>
          <p className="text-yellow-400 text-xs font-semibold uppercase tracking-wider mb-3">
            Grant Credits
          </p>
          <div className="space-y-2">
            <input
              type="text"
              value={targetUserId}
              onChange={(e) => setTargetUserId(e.target.value)}
              placeholder="Target user ID (UUID)"
              aria-label="Target user ID"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-xs font-mono placeholder-zinc-600 focus:outline-none focus:border-yellow-600 transition-colors"
            />
            <div className="flex gap-2">
              <input
                type="number"
                value={amount}
                min={1}
                max={1000}
                onChange={(e) => setAmount(Math.max(1, parseInt(e.target.value) || 1))}
                aria-label="Credit amount"
                className="w-24 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm text-center focus:outline-none focus:border-yellow-600 transition-colors"
              />
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Note"
                aria-label="Grant note"
                className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-yellow-600 transition-colors"
              />
            </div>
            <button
              onClick={() => void handleGrant()}
              disabled={grantBusy}
              className="w-full py-2.5 rounded-lg bg-yellow-700 hover:bg-yellow-600 disabled:opacity-50 text-white text-sm font-bold transition-colors flex items-center justify-center gap-2"
            >
              {grantBusy ? (
                <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Granting…</>
              ) : (
                `Grant ${amount} Credits`
              )}
            </button>
          </div>
        </div>

        {/* Advance Queue */}
        <div>
          <p className="text-yellow-400 text-xs font-semibold uppercase tracking-wider mb-3">
            Queue Control
          </p>
          <button
            onClick={() => void handleAdvance()}
            disabled={advanceBusy}
            className="w-full py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white text-sm font-bold transition-colors flex items-center justify-center gap-2 border border-zinc-700"
          >
            {advanceBusy ? (
              <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Advancing…</>
            ) : (
              <>⏭ Advance to Next Track</>
            )}
          </button>
          <p className="text-zinc-600 text-xs mt-1.5 text-center">
            Marks current as played, next song becomes now-playing, Play Next resets
          </p>
        </div>
      </div>
    </div>
  );
}
