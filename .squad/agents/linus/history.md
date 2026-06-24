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
