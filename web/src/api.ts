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
  areaId?:       string;
  nowPlaying:    QueueItem | null;
  previous:      QueueItem[];
  upcoming:      QueueItem[];
  playNext:      PlayNextState;
  pricing:       { queue: number; boost: number; playNext: number };
  creditBalance: number;
}

export interface Area {
  id:        string;
  name:      string;
  isDefault: boolean;
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

export const AUTH_EXPIRED_EVENT = 'mrdj:auth-expired';

function isProtectedBrowserPath(pathname: string) {
  return pathname === '/onboarding' ||
    /^\/o\/[^/]+\/(?:dashboard|members|pricing|earnings)(?:\/|$)/.test(pathname) ||
    /^\/o\/[^/]+\/events(?:\/?$|\/[^/]+\/(?:manage|console)(?:\/|$))/.test(pathname);
}

function shouldHandleUnauthorized(path: string) {
  if (path === '/api/me') return false;
  if (path.includes('/public')) return false;
  if (path.startsWith('/api/admin/')) return true;
  if (path.startsWith('/api/me/orgs')) return true;
  return typeof window !== 'undefined' && isProtectedBrowserPath(window.location.pathname);
}

function handleUnauthorized(path: string) {
  if (typeof window === 'undefined' || !shouldHandleUnauthorized(path)) return;
  window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
  if (isProtectedBrowserPath(window.location.pathname) && window.location.pathname !== '/login') {
    const next = `${window.location.pathname}${window.location.search}`;
    window.location.assign(`/login?expired=1&next=${encodeURIComponent(next)}`);
  }
}

async function parseJsonBody<T>(res: Response): Promise<T | undefined> {
  if (res.status === 204) return undefined;
  if (res.headers.get('content-length') === '0') return undefined;
  const contentType = res.headers.get('content-type') ?? '';
  const text = await res.text();
  if (!text.trim()) return undefined;
  if (!contentType.toLowerCase().includes('application/json')) return undefined;
  return JSON.parse(text) as T;
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const { headers: extraHeaders, ...rest } = options ?? {};
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(extraHeaders as Record<string, string>) },
    ...rest,
  });
  if (!res.ok) {
    if (res.status === 401) handleUnauthorized(path);
    const body = await parseJsonBody<{
      error?: { code?: string; message?: string; required?: number; balance?: number };
    }>(res).catch(() => undefined);
    const err = body?.error ?? {};
    throw new ApiRequestError(
      err.message ?? `HTTP ${res.status}`,
      err.code ?? 'unknown',
      res.status,
      { required: err.required, balance: err.balance }
    );
  }
  return (await parseJsonBody<T>(res)) as T;
}

export const api = {
  me: () => apiFetch<MeResponse>('/api/me'),

  queue: (slug: string, areaId?: string, signal?: AbortSignal) =>
    apiFetch<QueueView>(
      `/api/events/${slug}/queue${areaId ? `?areaId=${encodeURIComponent(areaId)}` : ''}`,
      { signal },
    ),

  // Public area roster for the guest jukebox selector (#70). Default area first.
  areas: (slug: string) =>
    apiFetch<{ areas: Area[] }>(`/api/events/${slug}/areas`),

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
    areaId?: string,
  ) =>
    apiFetch<RequestResponse>(`/api/events/${slug}/requests`, {
      method: 'POST',
      body: JSON.stringify({ trackId, tier, idempotencyKey, ...(areaId ? { areaId } : {}) }),
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

  adminAdvance: (slug: string, areaId?: string) =>
    apiFetch<{ queueView: QueueView }>(`/api/admin/events/${slug}/advance`, {
      method: 'POST',
      body: JSON.stringify({ ...(areaId ? { areaId } : {}) }),
    }),

  adminReorder: (slug: string, queueItemId: string, direction: 'up' | 'down', areaId?: string) =>
    apiFetch<{ queueView: QueueView }>(`/api/admin/events/${slug}/reorder`, {
      method: 'POST',
      body: JSON.stringify({ queueItemId, direction, ...(areaId ? { areaId } : {}) }),
    }),

  adminRemove: (slug: string, queueItemId: string, areaId?: string) =>
    apiFetch<{ queueView: QueueView; refund: RefundInfo | null }>(`/api/admin/events/${slug}/remove`, {
      method: 'POST',
      body: JSON.stringify({ queueItemId, ...(areaId ? { areaId } : {}) }),
    }),

  adminStats: (slug: string) =>
    apiFetch<{ stats: EventStats }>(`/api/admin/events/${slug}/stats`),

  // SSE stream URL (relative → same-origin via the Vite proxy). Consumed by useQueueStream.
  streamUrl: (slug: string, areaId?: string) =>
    `/api/events/${slug}/stream${areaId ? `?areaId=${encodeURIComponent(areaId)}` : ''}`,
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

  updateOrg: (orgSlug: string, body: { name?: string; logoUrl?: string | null; accentColor?: string | null }) =>
    apiFetch<{ organization: { id: string; slug: string; name: string; logoUrl: string | null; accentColor: string | null } }>(`/api/orgs/${orgSlug}`, {
      method: 'PATCH', body: JSON.stringify(body),
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

  // Public guest landing (no auth) — branding + joinable events + active bundles.
  publicOrg: (orgSlug: string) =>
    apiFetch<PublicOrg>(`/api/orgs/${orgSlug}/public`),

  // Real Connect checkout — creates a PaymentIntent on the org's connected account.
  purchase: (orgSlug: string, bundleId: string, clientRequestId?: string) =>
    apiFetch<PurchaseIntent>(`/api/orgs/${orgSlug}/credits/purchase`, {
      method: 'POST', body: JSON.stringify({ bundleId, clientRequestId }),
    }),
};

export interface PublicOrg {
  organization: { slug: string; name: string; logoUrl: string | null; accentColor: string | null };
  events: { id: string; slug: string; name: string; status: 'draft' | 'live' | 'ended'; createdAt: string }[];
  bundles: Bundle[];
}

export interface PurchaseIntent {
  clientSecret:        string;
  paymentIntentId:     string;
  publishableKey:      string;
  amountCents:         number;
  applicationFeeCents: number;
  credits:             number;
}
