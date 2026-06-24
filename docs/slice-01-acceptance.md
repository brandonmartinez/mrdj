# Slice-01 Acceptance Spec — Local Guest Jukebox

> **Owner:** Saul (Product/Requirements)
> **Status:** Draft — built against D6 (2026-06-24), REQUIREMENTS.md §3–§6, PROJECT-CHARTER.md
> **Verified by:** Coordinator, Rusty (technical gate), Rai (RAI gate)

---

## 1. Slice Goal

Slice-01 delivers a locally-runnable, end-to-end vertical slice of the mrdj guest jukebox
experience inside a devcontainer. A developer clones the repo, opens it in the devcontainer,
runs a single command, and immediately has a working jukebox: seeded tracks displayed in a
Cover Flow, search-as-you-type, the ability to Add to Queue for free, Boost with credits, and
purchase the premium Play Next slot when credits run short via a stubbed-but-production-shaped
buy-more bundles modal. Admin credit grants and queue advancement are also exercisable in this
slice. Every credit-affecting action runs through a real DB transaction with idempotency keys —
the payment processor and music catalog are stubbed, but money correctness is real.

**Explicitly out of scope for Slice-01:**

| Out-of-scope item | Rationale |
|---|---|
| k3s deployment / cluster manifests | Deferred post-slice-01; dev target is local |
| Real Google SSO | Stubbed identity; dev role switcher suffices |
| Real payment processor (Stripe/etc.) | PaymentProvider abstraction; stub grants credits |
| Real Apple Music or Spotify catalog | MusicProvider abstraction; 15 seeded CC tracks |
| Real DJ-rig (Serato/hardware) integration | Back-log item, no Slice-01 dependency |
| O7 DJ reject-with-refund | Open decision, deferred |

---

## 2. Acceptance Scenarios (Given / When / Then)

Scenarios are numbered **S-01 through S-13** for traceability in §5.

---

### S-01 — Devcontainer one-command boot and idempotent seed

**Given** a developer has Docker Desktop (or Podman) and VS Code Remote Containers installed
and has cloned the repo with no prior setup.

**When** they open the project in the devcontainer and run:
```
npm run dev
```

**Then:**
- The `docker-compose` stack (app container + Postgres service) starts without manual `.env` editing.
- Database migrations run automatically (or a seed script runs automatically) and complete without error.
- The seed inserts exactly 15 tracks, a test guest session, a test admin session, and seeded server-side pricing config (Boost price, Play Next price) — no seed row is duplicated on subsequent runs (idempotent seed).
- The app process logs "Listening on http://localhost:XXXX" (or equivalent) with no unhandled errors.
- Running `npm run dev` a second time against an already-migrated/seeded DB produces no errors and no duplicate rows.

---

### S-02 — Frontend serves on local URL; `/api/health` responds

**Given** the devcontainer stack is running (S-01 passed).

**When** a browser requests `http://localhost:<PORT>/` and `curl http://localhost:<PORT>/api/health`.

**Then:**
- The frontend renders without console errors and displays the Cover Flow / queue view.
- `GET /api/health` returns HTTP `200` with a JSON body containing at minimum `{ "status": "ok" }` (or equivalent); this endpoint requires no authentication.

---

### S-03 — Cover Flow displays played / now-playing / upcoming in macOS-style faded layout

**Given** the app is running and the seed has populated at least 2 played tracks, 1 now-playing track, and 3 upcoming tracks.

**When** the guest loads the home/queue view.

**Then:**
- The Cover Flow renders at least 3 "previous" (played) album art tiles to the left, the now-playing art prominently centered, and at least 3 "upcoming" tiles to the right.
- Tiles further from center are progressively scaled down and have reduced opacity (CSS transform: scale + opacity), visually matching a macOS Cover Flow fade effect.
- The number of visible side tiles is 3–5 per side (exact count may vary by viewport width).
- The now-playing tile is the largest and fully opaque.
- All tiles display album art (placeholder image acceptable for seeded stub tracks); missing art does not break the layout.

---

### S-04 — Cover Flow responsive and narrow-screen fallback

**Given** the Cover Flow is rendered (S-03 passed).

**When** the viewport width is ≤ 480 px (mobile narrow) — testable by resizing the browser window or DevTools device emulation.

**Then:**
- The Cover Flow gracefully collapses to a stacked/vertical fallback layout (no horizontal overflow, no clipped content, no broken CSS).
- The now-playing track title and artist are still legible.
- The upcoming queue is still accessible (scrollable list or equivalent).

---

### S-05 — Search-as-you-type narrows results (debounced)

**Given** the guest is on the main view and the search bar is visible.

**When** the guest types at least 2 characters in the search bar.

**Then:**
- Results update in the results list **without a full page reload**.
- The search request to the backend is debounced: typing "ab" quickly does not fire one network request per keystroke; there is at most one in-flight request per debounce window (≥ 200 ms).
- Results are filtered to tracks whose title or artist name contains the typed string (case-insensitive match against the 15 seeded tracks).
- Clearing the search input clears the results list (or returns to the default cover flow state).
- No result is shown when the input matches zero seeded tracks.

---

### S-06 — Clicking the search bar scrolls it to just below the header

**Given** the main view is rendered with the header and the search bar below it.

**When** the guest taps/clicks the search bar.

**Then:**
- The page scrolls (or the search bar animates) so that the search bar sits flush just below the fixed/sticky header, making it fully visible and above the keyboard on mobile.
- The header itself remains visible and is not obscured.
- The transition is smooth (CSS scroll behavior or JS smooth-scroll; no instant jump that causes disorientation).

---

### S-07 — Search result row contents

**Given** the guest has typed a query that returns ≥ 1 result (S-05 conditions met).

**When** the results list renders.

**Then** each result row displays:
- **Album art** thumbnail (placeholder acceptable).
- **Song title** (non-empty).
- **Artist name** (non-empty).
- **Album name** (non-empty or clearly labeled "Unknown Album" if absent in seed).
- **Action buttons:** "Add to Queue", "Boost", and "Play Next" — all three visible and enabled (or disabled with a tooltip if the guest has no credits for paid actions).
- No raw IDs, database UUIDs, or error stack traces are visible in the row.

---

### S-08 — Add to Queue (free) path

**Given** the guest session has 0 credits (default new session) and a song is visible in the search results.

**When** the guest clicks **"Add to Queue"** on a track.

**Then:**
- The server creates a QueueItem for the event at 0 credit cost.
- The guest's credit balance is unchanged (still 0).
- The track appears in the upcoming section of the queue view within the polling cycle (≤ 2 s).
- A success confirmation is shown in the UI (toast, inline message, or equivalent).
- Re-clicking "Add to Queue" for the same track in the same guest session does **not** add a duplicate (idempotent or duplicate-guard behavior — specific UX TBD by Linus, but no silent duplicate row).

---

### S-09 — Boost path with sufficient credits (deducts, reorders)

**Given** the guest session has been granted ≥ (Boost price) credits via the admin grant (S-12) or initial seed credits, and the guest has already added a track to the queue (S-08).

**When** the guest clicks **"Boost"** on their queued track.

**Then:**
- The server debits exactly the server-configured Boost price from the guest's credit balance in a single DB transaction.
- The guest's credit balance displayed in the UI decreases by exactly that amount.
- The track moves up in the upcoming queue (toward the top, but below any active Play Next holder).
- The queue reorder is visible within the polling cycle (≤ 2 s).
- A success confirmation is shown.
- If a second "Boost" request is sent with the same idempotency key (simulated retry), the credit balance is debited only once and the queue position changes only once.

---

### S-10 — Play Next path: insufficient credits → buy-more bundles modal → stubbed checkout grants credits → action succeeds

**Given** the guest session has fewer credits than the server-configured Play Next price, and the Play Next slot is available (not currently held).

**When** the guest clicks **"Play Next"** on a track.

**Then (Phase 1 — insufficient credits gate):**
- The server returns an error indicating insufficient credits (e.g., HTTP 402 or a structured error body with `code: "INSUFFICIENT_CREDITS"`).
- The UI opens the **buy-more bundles modal** (does not silently fail or navigate away).
- The modal displays at least 2 discounted bundle tiers (e.g., "5 credits – $1.99", "15 credits – $4.99") with prices sourced from the server (not hardcoded in the frontend).

**When** the guest selects a bundle and clicks "Purchase":
- The stubbed checkout flow triggers `PaymentProvider.createSession(bundleId)` → `PaymentProvider.completeStub()` on the server.
- The server calls `CreditsService.grant(guestId, amount, idempotencyKey)` — the balance increases.
- The UI shows updated credit balance immediately after the stub grant resolves.
- The buy-more modal closes.

**When** the guest now clicks **"Play Next"** again (credits are now sufficient):
- The server acquires the Play Next row lock, debits the Play Next price, and sets the QueueItem as the Play Next holder.
- The track moves to the Play Next position (top of the upcoming queue, flagged as "Up Next" / Play Next).
- The guest's credit balance decreases by exactly the Play Next price.
- Queue update visible within polling cycle.

---

### S-11 — Play Next slot is exclusive (single-slot enforcement)

**Given** a first guest has successfully purchased the Play Next slot (S-10).

**When** a second guest (different session) attempts to purchase Play Next for a different track simultaneously.

**Then:**
- The server returns an error indicating the slot is unavailable (e.g., `code: "PLAY_NEXT_UNAVAILABLE"`).
- The second guest's credit balance is not debited.
- The second guest's UI shows the slot as taken (button disabled or shows "Play Next taken").
- The first guest's Play Next position is not disturbed.

---

### S-12 — Admin grants credits to a guest

**Given** the dev role switcher is set to **Admin**, and a guest session ID is known.

**When** the admin submits the grant-credits form (or calls `POST /api/admin/credits/grant` with `{ guestId, amount, reason, idempotencyKey }`).

**Then:**
- The server creates a `CreditTransaction` audit row: `{ type: "ADMIN_GRANT", amount, grantedBy: adminId, reason, idempotencyKey }`.
- The guest's credit balance increases by the granted amount.
- Submitting the identical request a second time (same `idempotencyKey`) returns success but does NOT create a second transaction row and does NOT double-credit the guest.
- The admin action is rejected (HTTP 403) if the dev role switcher is set to Guest.

---

### S-13 — Admin "next" advance moves Cover Flow and resets Play Next slot

**Given** a Play Next holder is active (S-10 passed), and the Cover Flow shows the current now-playing track.

**When** the admin clicks **"Advance to Next Track"** (or calls `POST /api/admin/queue/advance`).

**Then:**
- The current now-playing track moves to the "played" (previous) side of the Cover Flow.
- The Play Next holder's track becomes the new now-playing track in the Cover Flow center.
- The Play Next slot status resets to **available** (no refund issued this slice — O7 deferred).
- The queue view reflects these changes within the polling cycle (≤ 2 s) for any connected guest.
- The advance is idempotent: calling it again when no track is queued returns a graceful response, not an unhandled exception.

---

## 3. Money-Correctness Checks

These checks apply even though the payment processor is stubbed. Failure in any of these is a **blocking defect** regardless of slice.

| Check | Verification method |
|---|---|
| **MC-01 Server-authoritative pricing** | Tamper the client request to send a different price/amount for Boost or Play Next → server must reject or use its own config price, never the client-supplied value. |
| **MC-02 Server-authoritative balance** | Guest credit balance must only update via `CreditsService` ledger calls; no endpoint accepts a client-supplied "new balance". |
| **MC-03 Idempotent paid action — Boost** | Replay the Boost HTTP request with the same idempotency key → DB shows exactly one `CreditTransaction` debit row; queue position changes once. |
| **MC-04 Idempotent paid action — Play Next** | Replay the Play Next purchase request with the same idempotency key while slot is held → DB shows exactly one debit; slot holder unchanged. |
| **MC-05 Failed action does not debit** | Trigger a Play Next purchase when the slot is taken (S-11) → zero debit rows created for the failed requester. |
| **MC-06 Failed Boost (insufficient credits)** | Attempt Boost with zero credits → HTTP error returned; zero debit rows for the requester. |
| **MC-07 Play Next single-slot** | Query DB directly: at any point in time, the number of QueueItems with `playNextStatus = 'locked'` must be ≤ 1. |
| **MC-08 Admin grant audit row** | After admin grant, `SELECT * FROM credit_transactions WHERE type = 'ADMIN_GRANT'` returns a row with `grantedBy`, `reason`, `idempotency_key`. |
| **MC-09 Admin grant idempotency** | Re-submit identical admin grant (same `idempotencyKey`) → exactly one audit row; balance incremented once. |
| **MC-10 Stub checkout grant shape** | Stub checkout calls `CreditsService.grant()` with an `idempotencyKey` derived from the stub session ID → no raw payment data reaches application business logic. |

---

## 4. Manual Smoke-Test Script

The Coordinator runs this script top-to-bottom after the PR is merged to confirm the deliverable.
All actions assume the devcontainer is running and the app is up on `http://localhost:<PORT>`.

```
PORT = the port printed by `npm run dev` (default assume 3000 for backend, 5173 for frontend or a combined port)
API  = http://localhost:<PORT>/api
UI   = http://localhost:<PORT>       (or the Vite dev URL)
```

1. **Boot check**
   ```bash
   curl -sf $API/health | grep '"status":"ok"'
   ```
   Expected: exit 0, body contains `"ok"`.

2. **Seed check**
   ```bash
   curl -sf $API/admin/debug/seed-status   # or check DB directly
   # SELECT COUNT(*) FROM tracks; → 15
   ```
   Expected: 15 tracks, no duplicate IDs.

3. **Open the UI** in a browser. Observe:
   - Cover Flow visible with now-playing in center, art on both sides.
   - Credit balance shows 0.

4. **Switch role** to Guest (dev role switcher — should be default).

5. **Search test:** Type "sun" in the search bar.
   - Observe: results narrow without page reload; network tab shows ≤ 1 request firing after typing stops.
   - Observe: each row shows art, title, artist, album, and three action buttons.

6. **Scroll test:** Click the search bar from a scrolled-down position.
   - Observe: bar scrolls to just below the header.

7. **Add to Queue (free):**
   - Click "Add to Queue" on any result.
   - Observe: success toast; track appears in upcoming within 2 s; credit balance still 0.

8. **Boost with no credits (should fail):**
   - Click "Boost" on the same track.
   - Observe: error message / disabled state (not a crash).

9. **Grant credits via admin:**
   - Switch role to Admin.
   - Navigate to `/admin/credits` (or use the admin panel).
   - Grant 50 credits to the guest session.
   - Switch back to Guest.
   - Observe: credit balance now shows 50.

10. **Boost with credits:**
    - Click "Boost" on the queued track.
    - Observe: track moves up in queue; balance decreases by Boost price (check server config for exact amount).

11. **Play Next — insufficient path:**
    - Ensure balance < Play Next price (grant a small amount if needed).
    - Click "Play Next" on a different track.
    - Observe: buy-more bundles modal opens with ≥ 2 tiers.
    - Select the cheapest bundle and click "Purchase".
    - Observe: modal closes; balance increases.
    - Click "Play Next" again.
    - Observe: track moves to Play Next position; balance decreases by Play Next price.

12. **Play Next slot exclusivity:**
    - Open a second browser tab (incognito = new guest session).
    - Click "Play Next" on any track.
    - Observe: error / button disabled — "slot taken".

13. **Narrow screen fallback:**
    - Open DevTools → device emulation → iPhone SE (375 px wide).
    - Observe: Cover Flow switches to stacked layout; no horizontal scroll bar; now-playing legible.

14. **Admin advance:**
    - Switch role to Admin.
    - Click "Advance to Next Track".
    - Observe: Cover Flow shifts (old now-playing moves left; Play Next holder moves to center).
    - Observe: Play Next slot status resets to "available" (check via `GET $API/queue` → `playNextStatus: "available"`).

15. **Idempotency check (MC-03):**
    ```bash
    # Capture the idempotency key from step 10's Boost request in network tab,
    # then replay it:
    curl -X POST $API/queue/boost \
      -H "Content-Type: application/json" \
      -H "Idempotency-Key: <captured-key>" \
      -d '{"queueItemId":"<id>"}' -sf
    # Run twice; DB should show exactly one debit row.
    ```
    Expected: second call returns same success response; DB has one transaction row.

16. **Health endpoint (final):**
    ```bash
    curl -sf $API/health
    ```
    Expected: HTTP 200, `{ "status": "ok" }`.

---

## 5. Traceability Checklist

Each checkbox maps a project-owner requirement (from REQUIREMENTS.md / PROJECT-CHARTER.md) to the scenario(s) above. The Coordinator marks these done after verifying the scenario.

### Guest onboarding & access (REQ §4.1 / CHARTER Goals #1)
- [ ] **R-01** Guest can access the jukebox without creating an account → **S-01, S-08**
- [ ] **R-02** Lightweight guest session identity is established automatically → **S-08, S-12**

### Song discovery & search (REQ §4.2)
- [ ] **R-03** Search catalog by title/artist → **S-05**
- [ ] **R-04** See artwork and metadata in results → **S-07**
- [ ] **R-05** Debounced search (no per-keystroke flooding) → **S-05**
- [ ] **R-06** Search bar scrolls to below header on focus → **S-06**

### Cover Flow / queue view (REQ §8 — responsive, visual, jukebox-style)
- [ ] **R-07** Played / now-playing / upcoming shown with macOS-style fade → **S-03**
- [ ] **R-08** 3–5 tiles per side → **S-03**
- [ ] **R-09** Responsive; works on mobile narrow screen → **S-04**

### Add to Queue — normal request (REQ §4.2, D6 O2 = 0 credits)
- [ ] **R-10** Guest adds a track to the queue for free → **S-08**
- [ ] **R-11** Track appears in queue without full page reload → **S-08**

### Credits / wallet (REQ §4.3)
- [ ] **R-12** Credit balance is visible in the UI → **S-09, S-10**
- [ ] **R-13** All paid actions debit credits server-side → **S-09, S-10, MC-01, MC-02**
- [ ] **R-14** Credits granted only after server-side verification → **S-10, MC-10**

### Boost / Up Next (REQ §4.4)
- [ ] **R-15** Guest spends credits to move a request toward the front → **S-09**
- [ ] **R-16** Pricing is server-authoritative → **MC-01**
- [ ] **R-17** Reorder is transactional → **S-09, MC-03**

### Play Next premium slot (REQ §4.5)
- [ ] **R-18** Only one Play Next purchasable at a time → **S-11, MC-07**
- [ ] **R-19** Play Next not always available; server is truth → **S-11**
- [ ] **R-20** Slot resets after now-playing advances → **S-13**
- [ ] **R-21** Play Next costs more than a Boost → **S-10** (price check against server config)

### Buy-more credits modal (REQ §4.3, D6 stub checkout)
- [ ] **R-22** When credits insufficient, buy-more bundles modal shown → **S-10**
- [ ] **R-23** Bundle tiers are discounted / shown with prices from server → **S-10**
- [ ] **R-24** Stub checkout grants credits via CreditsService → **S-10, MC-10**

### Admin / DJ console (REQ §4.6)
- [ ] **R-25** Admin can grant credits with audit row → **S-12, MC-08**
- [ ] **R-26** Admin can advance the now-playing track → **S-13**
- [ ] **R-27** Advancing moves Cover Flow and resets Play Next slot → **S-13**

### Money correctness (REQ §6, §8 — idempotency, no double-charge)
- [ ] **R-28** No double-charge on retry → **MC-03, MC-04**
- [ ] **R-29** Failed action never debits credits → **MC-05, MC-06**
- [ ] **R-30** Admin grant is idempotent → **MC-09**

### Devcontainer / local boot (D6 delivery target)
- [ ] **R-31** One-command boot in devcontainer → **S-01**
- [ ] **R-32** Idempotent seed (no duplicates on re-run) → **S-01**
- [ ] **R-33** `/api/health` returns 200 → **S-02**

---

*Last updated: 2026-06-23 by Saul (Product/Requirements). Verify against D6 decision and REQUIREMENTS.md before each sprint review.*
