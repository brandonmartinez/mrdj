// Typed API client — all calls go through the Vite /api proxy to localhost:3001

export interface User {
  id:          string;
  type:        string;
  role:        string;
  displayName: string;
}

export interface EventInfo {
  id:   string;
  slug: string;
  name: string;
}

export interface MeResponse {
  user:          User;
  event:         EventInfo;
  creditBalance: number;
}

export interface Track {
  id:         string;
  provider:   string;
  providerId: string;
  title:      string;
  artist:     string;
  album:      string;
  artworkUrl: string;
  durationMs: number;
}

export interface QueueItem {
  id:          string;
  status:      'played' | 'playing' | 'pending';
  position:    number;
  isPlayNext:  boolean;
  track:       Track;
  requesterId: string;
}

export interface PlayNextState {
  status:            'available' | 'locked' | 'cooldown';
  holderQueueItemId: string | null;
  price:             number;
}

export interface QueueView {
  nowPlaying:    QueueItem | null;
  previous:      QueueItem[];
  upcoming:      QueueItem[];
  playNext:      PlayNextState;
  pricing:       { queue: number; boost: number; playNext: number };
  creditBalance: number;
}

export interface Bundle {
  id:           string;
  label:        string;
  credits:      number;
  bonusCredits: number;
  priceCents:   number;
  discountPct:  number;
}

export interface RequestResponse {
  queueItem:     QueueItem;
  creditBalance: number;
  queueView:     QueueView;
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly extra: { required?: number; balance?: number } = {}
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const { headers: extraHeaders, ...rest } = options ?? {};
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(extraHeaders as Record<string, string>) },
    ...rest,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as {
      error?: { code?: string; message?: string; required?: number; balance?: number };
    };
    const err = body?.error ?? {};
    throw new ApiRequestError(
      err.message ?? `HTTP ${res.status}`,
      err.code ?? 'unknown',
      res.status,
      { required: err.required, balance: err.balance }
    );
  }
  return res.json() as Promise<T>;
}

export const api = {
  me: () => apiFetch<MeResponse>('/api/me'),

  queue: (slug: string) => apiFetch<QueueView>(`/api/events/${slug}/queue`),

  actAs: (role: 'guest' | 'admin') =>
    apiFetch<{ ok: boolean; role: string }>('/api/dev/act-as', {
      method: 'POST', body: JSON.stringify({ role }),
    }),

  search: (q: string, signal?: AbortSignal) =>
    apiFetch<{ results: Track[] }>(
      `/api/tracks/search?q=${encodeURIComponent(q)}`,
      { signal }
    ),

  bundles: () => apiFetch<Bundle[]>('/api/credits/bundles'),

  request: (
    slug: string,
    trackId: string,
    tier: 'queue' | 'boost' | 'play_next',
    idempotencyKey: string,
  ) =>
    apiFetch<RequestResponse>(`/api/events/${slug}/requests`, {
      method: 'POST',
      body: JSON.stringify({ trackId, tier, idempotencyKey }),
    }),

  checkoutSession: (bundleId: string) =>
    apiFetch<{ sessionId: string; status: string }>('/api/checkout/session', {
      method: 'POST',
      body: JSON.stringify({ bundleId }),
    }),

  checkoutComplete: (sessionId: string, idempotencyKey: string) =>
    apiFetch<{ creditBalance: number }>('/api/checkout/stub-complete', {
      method: 'POST',
      body: JSON.stringify({ sessionId, idempotencyKey }),
    }),

  adminGrant: (
    targetUserId: string,
    amount: number,
    note: string,
    idempotencyKey: string,
  ) =>
    apiFetch<{ balance: number }>('/api/admin/credits/grant', {
      method: 'POST',
      body: JSON.stringify({ targetUserId, amount, note, idempotencyKey }),
    }),

  adminAdvance: (slug: string) =>
    apiFetch<{ queueView: QueueView }>(`/api/admin/events/${slug}/advance`, {
      method: 'POST',
    }),
};
