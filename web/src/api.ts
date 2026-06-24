// Typed API client — all calls go through the Vite /api proxy to localhost:3001
// Linus: replace placeholder components with real Cover Flow UI

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

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  me:        () => apiFetch<MeResponse>('/api/me'),
  queue:     (slug: string) => apiFetch<QueueView>(`/api/events/${slug}/queue`),
  actAs:     (role: 'guest' | 'admin') =>
    apiFetch('/api/dev/act-as', { method: 'POST', body: JSON.stringify({ role }) }),
};
