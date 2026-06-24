# Slice-01 API Contract

> Frozen by Rusty on 2026-06-23. Implements D6 scope decisions.
> Backend: `api/` (Express + TypeScript). Frontend proxy: Vite `/api` → `localhost:3001`.

---

## Ports

| Service  | Port | URL |
|----------|------|-----|
| API      | 3001 | `http://localhost:3001` |
| Web      | 5173 | `http://localhost:5173` |
| Postgres | 5432 | `postgresql://mrdj:mrdj@localhost:5432/mrdj` |

---

## Shared Types

```typescript
interface Track {
  id:         string;   // internal UUID
  provider:   string;   // 'stub' | 'apple_music' | 'spotify'
  providerId: string;   // provider's native ID
  title:      string;
  artist:     string;
  album:      string;
  artworkUrl: string;
  durationMs: number;
}

interface QueueItem {
  id:          string;
  status:      'played' | 'playing' | 'pending';
  position:    number;
  isPlayNext:  boolean;
  track:       Track;
  requesterId: string;
}

interface PlayNextState {
  status:            'available' | 'locked' | 'cooldown';
  holderQueueItemId: string | null;
  price:             number;   // credits (server-authoritative)
}

interface QueueView {
  nowPlaying:    QueueItem | null;
  previous:      QueueItem[];     // played, most-recently-played first
  upcoming:      QueueItem[];     // pending, ordered by position asc
  playNext:      PlayNextState;
  pricing:       { queue: number; boost: number; playNext: number };
  creditBalance: number;          // current user's balance
}

interface Bundle {
  id:           string;
  label:        string;
  credits:      number;
  bonusCredits: number;
  priceCents:   number;
  discountPct:  number;
}

// Error body (all 4xx/5xx responses)
interface ApiError {
  error: {
    code:      'insufficient_credits' | 'play_next_unavailable' | 'forbidden' | 'not_found' | 'validation';
    message:   string;
    required?: number;   // present for insufficient_credits
    balance?:  number;   // present for insufficient_credits
  };
}
```

---

## Endpoints (prefix `/api`)

### Implemented (read paths)

#### `GET /health`
Returns server + DB liveness.
```json
{ "status": "ok", "db": "ok" }
```

---

#### `GET /me`
Returns current user, their active event, and credit balance.

**Response:**
```json
{
  "user": { "id": "...", "type": "guest", "role": "guest", "displayName": "Guest User" },
  "event": { "id": "...", "slug": "demo", "name": "The Ocean's Eleven After Party" },
  "creditBalance": 2
}
```

---

#### `POST /dev/act-as` *(dev-only, disabled in production)*
Switches the session role. Used by dev role switcher in the frontend.

**Request body:**
```json
{ "role": "guest" | "admin" }
```

**Response:**
```json
{ "ok": true, "role": "guest" }
```

---

#### `GET /events/:slug/queue`
Returns the full `QueueView` for an event. Powers the Cover Flow UI.

**Response:** `QueueView` (see type above)

Seeded data: 4 played, 1 playing (The Four Seasons: Spring), 6 pending.

---

#### `GET /tracks/search?q=`
Search tracks via the MusicProvider. Empty `q` returns all 15 seeded tracks.
Server-side filter on title, artist, album (case-insensitive substring).

**Response:**
```json
{ "results": Track[] }
```

**Search examples that narrow results:**
- `?q=beethoven` → 4 tracks
- `?q=traditional` → 2 tracks (Greensleeves, Amazing Grace)
- `?q=sonata` → 1 track (Moonlight Sonata)

---

#### `GET /credits/bundles`
Returns available credit bundles (from DB seed). Server-authoritative pricing.

**Response:** `Bundle[]`

Seeded bundles:
| Label | Credits | Bonus | Price | Discount |
|-------|---------|-------|-------|---------|
| Starter Pack | 5 | 0 | $1.99 | 0% |
| Party Pack | 15 | 2 | $4.99 | ~9% |
| VIP Pack | 30 | 10 | $9.99 | ~24% |

---

### Stubs (typed 501 — Basher implements)

#### `POST /events/:slug/requests`
Add a track to the queue with payment.

**Request body:**
```json
{
  "trackId":        "uuid",
  "tier":           "queue" | "boost" | "play_next",
  "idempotencyKey": "client-generated-uuid"
}
```

**Response on success:**
```json
{
  "queueItem":     QueueItem,
  "creditBalance": number,
  "queueView":     QueueView
}
```

**Error responses:**
- `402 { error: { code: "insufficient_credits", message: "...", required: 3, balance: 2 } }`
- `409 { error: { code: "play_next_unavailable", message: "..." } }`

**Basher notes:**
- Single DB transaction: credit debit + queue insert + optional play_next_slot update
- `SELECT ... FOR UPDATE` on `play_next_slot` when `tier = 'play_next'`
- Idempotency: `credit_transactions.idempotency_key` UNIQUE prevents double-charge
- Pricing is read from `pricing_config` table (server-side), never from request body

---

#### `POST /checkout/stub-complete`
Complete a stub checkout session and grant credits.

**Request body:**
```json
{ "sessionId": "stub_session_...", "idempotencyKey": "uuid" }
```

**Response:** `{ "creditBalance": number }`

**Basher/Frank notes:** production path is a Stripe webhook; this endpoint is stub-only.

---

#### `POST /admin/credits/grant` *(admin role required)*
Admin manually grants credits to a user.

**Request body:**
```json
{
  "targetUserId":  "uuid",
  "amount":        10,
  "note":          "comp for event issue",
  "idempotencyKey":"uuid"
}
```

**Response:** `{ "balance": number }`

---

#### `POST /admin/events/:slug/advance` *(admin role required)*
Advance the queue: mark current as played, next pending becomes playing.
Resets `play_next_slot` to `available` with no refund (D6 decision).

**Response:** `{ "queueView": QueueView }`

---

### Checkout (stub — Frank finalizes)

#### `POST /checkout/session`
Create a checkout session for a bundle purchase.

**Request body:** `{ "bundleId": "uuid" }`

**Response:**
```json
{ "sessionId": "stub_session_...", "status": "requires_completion" }
```

---

## Seeded Data

### Users
| Name | ID | Role | Credits |
|------|----|------|---------|
| Guest User | `00000000-0000-0000-0000-000000000003` | guest | 2 |
| Admin DJ | `00000000-0000-0000-0000-000000000001` | admin | 100 |

### Event
- Slug: `demo`
- Name: "The Ocean's Eleven After Party"
- Status: `live`

### Queue (pre-populated)
| # | Track | Status |
|---|-------|--------|
| 1 | Clair de Lune — Debussy | played (60 min ago) |
| 2 | Für Elise — Beethoven | played (45 min ago) |
| 3 | Moonlight Sonata — Beethoven | played (30 min ago) |
| 4 | Canon in D Major — Pachelbel | played (15 min ago) |
| 5 | The Four Seasons: Spring — Vivaldi | **playing now** |
| 6 | The Blue Danube Waltz — Strauss | pending (pos 1) |
| 7 | Symphony No. 5 — Beethoven | pending (pos 2) |
| 8 | Greensleeves — Traditional | pending (pos 3) |
| 9 | Amazing Grace — Traditional | pending (pos 4) |
| 10 | Habanera — Bizet | pending (pos 5) |
| 11 | Ode to Joy — Beethoven | pending (pos 6) |

Tracks 12–15 (Gymnopédie No. 1, Mountain King, Minuet in G, Ave Maria) are seeded but not in the queue — available for search + add.

### Pricing
| Action | Cost |
|--------|------|
| Add to queue | 0 credits (free) |
| Boost (Up Next) | 1 credit |
| Play Next | 3 credits |

*Guest balance = 2: Add is free, Boost works once, Play Next triggers buy-more modal.*

---

## Dev Role Switcher

```bash
# Switch to admin
curl -X POST http://localhost:3001/api/dev/act-as \
  -H 'Content-Type: application/json' \
  -d '{"role":"admin"}' \
  --cookie-jar /tmp/cookies.txt --cookie /tmp/cookies.txt

# Switch back to guest
curl -X POST http://localhost:3001/api/dev/act-as \
  -H 'Content-Type: application/json' \
  -d '{"role":"guest"}' \
  --cookie-jar /tmp/cookies.txt --cookie /tmp/cookies.txt
```

---

## Module Ownership

| Module | Owner | Status |
|--------|-------|--------|
| `identity/` | Rusty | ✅ Implemented |
| `event/` | Rusty | ✅ Implemented |
| `queue/` reads | Rusty | ✅ Implemented |
| `queue/` writes | Basher | 🔲 Stub (501) |
| `credits/service.ts` | Frank/Basher | ✅ grantCredits seam, spendCredits TODO(Basher) |
| `music/` | Livingston | ✅ Stub (DB-backed), real providers TODO |
| `payments/` | Frank | ✅ Stub shape, real Stripe TODO |
| `admin/` | Basher | 🔲 Stubs (501) |
