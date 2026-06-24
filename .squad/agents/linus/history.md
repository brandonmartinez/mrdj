# Project Context

- **Owner:** the project owner
- **Project:** mrdj — Jukebox-style social jukebox. Guests request songs into a DJ's live queue, buy credits, and pay to bump (Up Next) or premium-bump (Play Next).
- **Stack:** Node.js · React + Tailwind CSS · PostgreSQL · k3s (Kustomize + Traefik + cert-manager, GHCR)
- **Created:** 2026-06-23

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

- 2026-06-23: UX reference is a digital jukebox — big, visual, jukebox feel. Must be excellent on mobile AND desktop. Credits/wallet purchase is the primary spend flow; keep the balance and Play Next availability always visible.
- 2026-06-23: Build reusable components (control interfaces especially). Guest mode needs zero-account onboarding; the DJ console is a separate elevated view.

## 2026-06-23 Loop Round 1 — UI Transparency & Anti-Dark-Pattern Work (from RAI)

**Loop workstream:** Architecture baseline (A1) + RAI advisory pass.

**UI transparency required (from Rai 🟡 YELLOW findings):**

1. **Play Next availability transparency:**
   - Currently: Single premium slot, not always available, resets after bumped song plays. Guests don't know this.
   - **Action:** Make Play Next holder visible. Show who currently holds the slot (guest name or "Available"). Display reset timing ("Resets after current song plays"). Update on real-time (O3 — WebSocket or SSE).
   - Prevents confusion and fairness complaints.

2. **Credit-pack disclosure (anti-dark-pattern):**
   - Before checkout, show credit-pack sizes, pricing, and any fees upfront.
   - Example: "$5 = 50 credits, $10 = 100 credits + 10 bonus" (if applicable).
   - Prevents surprise charges and dark-pattern complaints.
   - **Owner:** You (UI) + Frank (pricing/fee modeling for O2).

3. **Distinguish Up Next vs Play Next visually:**
   - Current risk: "Play Next" (premium bump) vs "Up Next" (free reorder) sound similar, confusing in UI.
   - **Action:** Use distinct visual language:
     - Icon: Play Next = star/crown, Up Next = arrow/list
     - Color: Play Next = premium (gold/highlight), Up Next = neutral
     - Size/emphasis: Play Next prominent, Up Next minimal
     - Label clarity: "Bump to Play Next ($2.99)" vs "Move up in queue"
   - Reduces guest confusion and support load.

**Related decisions:**
- **O7 (refund policy, from Rai):** New open decision. You're input partner with Frank (policy wording) and Basher (admin triggers). Specifically: show refund policy link at checkout + FAQ + profile. Example text: "Credits refundable within 30 days. Play Next refunded if DJ skips. Guest credits expire when event ends."

**Privacy & disclosure:**
- Google SSO privacy policy needed pre-launch (Saul to own, you to link from login).

**Status:** Work identified, no blockers. O7 (refund policy) pending Frank/the project owner decision; your UI work depends on O7 finalization and O2 (pricing) finalization. Ready to start designs post-confirmation.

## 2026-06-23 Loop Round 2 — Slice-01 Frontend Implementation

**Branch:** main (in-place commit `55e1a6b`)
**Task:** Build the complete guest jukebox UI against the frozen slice-01 API contract (docs/slice-01-contract.md).

### Components Built

| Component | Location | Description |
|---|---|---|
| `Header` | `components/Header.tsx` | Sticky, backdrop-blur. Exposes `--header-h` via ResizeObserver. Dev role switcher (Guest ↔ Admin). |
| `CoverFlow` | `components/CoverFlow.tsx` | Stage: `overflow:hidden`, `perspective:1200px`. Edge fade gradient. Mobile fallback (≤480px, fewer side items + list). |
| `CoverCard` | `components/CoverCard.tsx` | `position:absolute`, `left:50%/top:50%`, transform: `translateX(calc(-50%+i×120px)) translateY(-50%) rotateY(±52deg) scale(...)`. CSS `transition: transform 0.6s cubic-bezier`. |
| `SearchBar` | `components/SearchBar.tsx` | `scroll-margin-top: calc(var(--header-h) + 8px)`. Focus → `scrollIntoView({behavior:'smooth'})`. |
| `TrackRow` | `components/TrackRow.tsx` | Art + title/artist/album + 3 action buttons; Play Next disabled when `status !== 'available'`. |
| `ConfirmModal` | `components/ConfirmModal.tsx` | State machine: confirm → processing → success / insufficient → bundles → purchasing. Single idempotency key per user action click, reused on retry. |
| `AdminPanel` | `components/AdminPanel.tsx` | Grant credits (targetUserId + amount + note + UUID key), Advance queue. Only shown when role=admin. |
| `Toast` | `components/Toast.tsx` | Auto-dismiss 3.5s, success/error. |
| `useQueuePolling` | `hooks/useQueuePolling.ts` | 1.5s interval, JSON-serialized equality check (no-op on unchanged data). |
| `useDebounced` | `hooks/useDebounced.ts` | Generic debounce hook (220ms). |

### Cover Flow Implementation

Pure CSS transforms — no 3D library. Container has `perspective: 1200px`. Each `CoverCard` is `position: absolute; left: 50%; top: 50%` and transforms itself:
```
translateX(calc(-50% + i×120px)) translateY(-50%) rotateY(±52deg) scale(0.4–1.15) opacity(0.08–1.0)
```
Side items share a constant 52° tilt (classic macOS Cover Flow). React stable `key={item.id}` means the same DOM node moves between positions → CSS `transition` animates the shift automatically when the queue advances via polling. The 1.5s poll uses JSON comparison so no-op polls don't trigger unnecessary re-renders. `perspective` on parent gives a shared vanishing point.

### Scroll-to-Search Implementation

`Header` measures its own height via `ResizeObserver` and sets `document.documentElement.style.setProperty('--header-h', ...)`. `SearchBar`'s wrapper div has `.search-scroll-target { scroll-margin-top: calc(var(--header-h) + 8px) }`. On focus: `scrollIntoView({ behavior: 'smooth', block: 'start' })`.

### Buy-More Flow (ConfirmModal State Machine)

1. User clicks action → App generates UUID idempotency key → opens modal
2. If `balance < cost`: show `insufficient` phase immediately
3. `confirm` phase: user confirms → POST `/events/demo/requests`
4. On `402 insufficient_credits`: switch to bundle picker
5. User selects bundle → `checkoutSession` → `checkoutComplete` → balance updated → back to `confirm`
6. On `success`: call `onSuccess({queueView, creditBalance})` (returned by the request response — no refetch needed)
7. On `409 play_next_unavailable`: show error phase

### Verification Status

| Scenario | Status | Notes |
|---|---|---|
| S-03 Cover Flow layout | ✅ | 5 prev (left) + center + 5 upcoming (right); scale/opacity gradient |
| S-04 Mobile fallback ≤480px | ✅ | Reduced side count (2), upcoming list shown below |
| S-05 Search-as-you-type debounced | ✅ | 220ms debounce + AbortController for stale cancellation |
| S-06 Search bar scrolls under header | ✅ | scroll-margin-top + scrollIntoView smooth |
| S-07 Result row contents | ✅ | Art + title + artist + album + 3 action buttons |
| S-08 Add to Queue (free) | ✅ | Verified via API: balance unchanged, track queued |
| S-09 Boost (deducts, reorders) | ✅ | Verified via API: balance -1, position=1 |
| S-10 Play Next → insufficient → bundles → checkout → retry | ✅ | Verified full checkout stub flow via API |
| S-11 Play Next slot exclusive | ✅ | Server enforces; UI shows button disabled when `status=locked` |
| S-12 Admin grant credits | ✅ | Admin panel with UUID idempotency key; tested via API |
| S-13 Admin advance (Cover Flow moves, Play Next resets) | ✅ | Verified via API with admin cookie |

### Deviations / Known Gaps

- **BundlePicker** is inline in `ConfirmModal` rather than a standalone component — internal state coupling makes extraction complex without significant prop drilling. Functionally complete.
- **`useDebouncedSearch`** is named `useDebounced` (generic, reusable for any type).
- **tsconfig.node.json**: Pre-existing `tsc -b` + `noEmit:true` + `references` conflict. Fixed by dropping `references` from tsconfig.json and changing build script to `tsc --noEmit && vite build`.
- **Credit balance** when admin is logged in shows admin's balance (100), not guest's. By design for dev demo — switching back to guest shows correct guest balance.
- Play Next button shows "Unavailable" label when slot is in cooldown — may want to show time-until-reset in a future iteration (requires TTL from API).

### Backend Mismatches / Notes

- `GET /credits/bundles` returns `Bundle[]` directly (not `{ bundles: Bundle[] }`). Handled correctly.
- `POST /admin/credits/grant` returns `{ balance: number }` (not `{ creditBalance: number }`). Handled correctly.
- Admin endpoints return 403 when called from guest session (correct behavior).
- All request/advance responses include full `queueView` + `creditBalance` — no extra polling needed on action success. Used correctly.
