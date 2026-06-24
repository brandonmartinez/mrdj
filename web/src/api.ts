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

export interface RefundInfo {
  userId: string;
  amount: number;
}

export interface TopRequester {
  userId:      string;
  displayName: string;
  requests:    number;
  spent:       number;
}

export interface EventStats {
  requestCount:     number;
  paidRequestCount: number;
  creditsSpent:     number;
  creditsRefunded:  number;
  playNext:         { status: string; purchasedCount: number };
  topRequesters:    TopRequester[];
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

  adminReorder: (slug: string, queueItemId: string, direction: 'up' | 'down') =>
    apiFetch<{ queueView: QueueView }>(`/api/admin/events/${slug}/reorder`, {
      method: 'POST',
      body: JSON.stringify({ queueItemId, direction }),
    }),

  adminRemove: (slug: string, queueItemId: string) =>
    apiFetch<{ queueView: QueueView; refund: RefundInfo | null }>(`/api/admin/events/${slug}/remove`, {
      method: 'POST',
      body: JSON.stringify({ queueItemId }),
    }),

  adminStats: (slug: string) =>
    apiFetch<{ stats: EventStats }>(`/api/admin/events/${slug}/stats`),

  // SSE stream URL (relative → same-origin via the Vite proxy). Consumed by useQueueStream.
  streamUrl: (slug: string) => `/api/events/${slug}/stream`,
};

// ── Org / DJ-facing API (Epic 6) ──────────────────────────────────────────────

export type OrgRole = 'owner' | 'manager' | 'dj' | 'staff';

export interface MyOrg {
  id:   string;
  slug: string;
  name: string;
  role: OrgRole;
}

export interface OrgEvent {
  id:        string;
  slug:      string;
  name:      string;
  status:    'draft' | 'live' | 'ended';
  ownerId:   string;
  ownerName: string | null;
  createdAt: string;
  areaCount: number;
}

export interface EventDetail {
  id:        string;
  slug:      string;
  name:      string;
  status:    'draft' | 'live' | 'ended';
  ownerId:   string;
  ownerName: string | null;
  createdAt: string;
}

export interface OrgMember {
  id:          string;
  accountId:   string;
  role:        OrgRole;
  displayName: string;
  email:       string;
  createdAt:   string;
}

export interface OrgArea {
  id:        string;
  name:      string;
  isDefault: boolean;
  createdAt: string;
}

export interface OrgBundle {
  id:           string;
  label:        string;
  credits:      number;
  bonusCredits: number;
  priceCents:   number;
  discountPct:  number | string;
  sortOrder:    number;
  active:       boolean;
}

export interface ConnectStatus {
  connected:      boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
}

export interface OrgPayment {
  id:                  string;
  bundleId:            string | null;
  amountCents:         number;
  applicationFeeCents: number;
  netCents:            number;
  creditsGranted:      number;
  status:              'succeeded' | 'disputed' | 'refunded';
  createdAt:           string;
}

export interface OrgPaymentsSummary {
  grossCents:    number;
  feeCents:      number;
  netCents:      number;
  count:         number;
  disputedCount: number;
  refundedCount: number;
}

export const orgApi = {
  myOrgs: () => apiFetch<{ organizations: MyOrg[] }>('/api/me/orgs'),

  createOrg: (slug: string, name: string) =>
    apiFetch<{ organization: MyOrg }>('/api/me/orgs', {
      method: 'POST', body: JSON.stringify({ slug, name }),
    }),

  getOrg: (orgSlug: string) =>
    apiFetch<{ organization: { id: string; slug: string; name: string } }>(`/api/orgs/${orgSlug}`),

  updateOrg: (orgSlug: string, name: string) =>
    apiFetch<{ organization: { id: string; slug: string; name: string } }>(`/api/orgs/${orgSlug}`, {
      method: 'PATCH', body: JSON.stringify({ name }),
    }),

  // Events
  listEvents: (orgSlug: string) =>
    apiFetch<{ events: OrgEvent[] }>(`/api/orgs/${orgSlug}/events`),

  getEvent: (orgSlug: string, eventSlug: string) =>
    apiFetch<{ event: EventDetail }>(`/api/orgs/${orgSlug}/events/${eventSlug}`),

  createEvent: (orgSlug: string, body: { slug: string; name: string; leadDjAccountId?: string; defaultAreaName?: string }) =>
    apiFetch<{ event: EventDetail & { defaultAreaId: string; defaultAreaName: string } }>(`/api/orgs/${orgSlug}/events`, {
      method: 'POST', body: JSON.stringify(body),
    }),

  updateEvent: (orgSlug: string, eventSlug: string, body: { name?: string; status?: string; leadDjAccountId?: string }) =>
    apiFetch<{ event: EventDetail }>(`/api/orgs/${orgSlug}/events/${eventSlug}`, {
      method: 'PATCH', body: JSON.stringify(body),
    }),

  // Areas
  listAreas: (orgSlug: string, eventSlug: string) =>
    apiFetch<{ areas: OrgArea[] }>(`/api/orgs/${orgSlug}/events/${eventSlug}/areas`),

  createArea: (orgSlug: string, eventSlug: string, name: string) =>
    apiFetch<{ area: OrgArea }>(`/api/orgs/${orgSlug}/events/${eventSlug}/areas`, {
      method: 'POST', body: JSON.stringify({ name }),
    }),

  updateArea: (orgSlug: string, eventSlug: string, areaId: string, name: string) =>
    apiFetch<{ area: OrgArea }>(`/api/orgs/${orgSlug}/events/${eventSlug}/areas/${areaId}`, {
      method: 'PATCH', body: JSON.stringify({ name }),
    }),

  deleteArea: (orgSlug: string, eventSlug: string, areaId: string) =>
    apiFetch<void>(`/api/orgs/${orgSlug}/events/${eventSlug}/areas/${areaId}`, { method: 'DELETE' }),

  // Members
  listMembers: (orgSlug: string) =>
    apiFetch<{ members: OrgMember[] }>(`/api/orgs/${orgSlug}/members`),

  addMember: (orgSlug: string, accountId: string, role: OrgRole) =>
    apiFetch<{ member: OrgMember }>(`/api/orgs/${orgSlug}/members`, {
      method: 'POST', body: JSON.stringify({ accountId, role }),
    }),

  updateMember: (orgSlug: string, membershipId: string, role: OrgRole) =>
    apiFetch<{ member: OrgMember }>(`/api/orgs/${orgSlug}/members/${membershipId}`, {
      method: 'PATCH', body: JSON.stringify({ role }),
    }),

  removeMember: (orgSlug: string, membershipId: string) =>
    apiFetch<void>(`/api/orgs/${orgSlug}/members/${membershipId}`, { method: 'DELETE' }),

  // Bundles / pricing
  listBundles: (orgSlug: string) =>
    apiFetch<OrgBundle[]>(`/api/orgs/${orgSlug}/bundles`),

  createBundle: (orgSlug: string, body: Partial<OrgBundle>) =>
    apiFetch<OrgBundle>(`/api/orgs/${orgSlug}/bundles`, {
      method: 'POST', body: JSON.stringify(body),
    }),

  updateBundle: (orgSlug: string, bundleId: string, body: Partial<OrgBundle>) =>
    apiFetch<OrgBundle>(`/api/orgs/${orgSlug}/bundles/${bundleId}`, {
      method: 'PATCH', body: JSON.stringify(body),
    }),

  deleteBundle: (orgSlug: string, bundleId: string) =>
    apiFetch<void>(`/api/orgs/${orgSlug}/bundles/${bundleId}`, { method: 'DELETE' }),

  // Stripe Connect
  connectStatus: (orgSlug: string) =>
    apiFetch<ConnectStatus>(`/api/orgs/${orgSlug}/stripe/status`),

  connectStart: (orgSlug: string) =>
    apiFetch<{ accountId: string; url: string }>(`/api/orgs/${orgSlug}/stripe/connect`, { method: 'POST' }),

  // Earnings
  payments: (orgSlug: string) =>
    apiFetch<{ payments: OrgPayment[]; summary: OrgPaymentsSummary }>(`/api/orgs/${orgSlug}/payments`),

  refund: (orgSlug: string, paymentId: string, method: 'money' | 'credits') =>
    apiFetch<{ ok: boolean }>(`/api/orgs/${orgSlug}/payments/${paymentId}/refund`, {
      method: 'POST', body: JSON.stringify({ method }),
    }),
};
