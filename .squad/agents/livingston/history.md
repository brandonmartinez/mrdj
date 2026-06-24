# Project Context

- **Owner:** the project owner
- **Project:** mrdj — Jukebox-style social jukebox. Guests request songs into a DJ's live queue, buy credits, and pay to bump (Up Next) or premium-bump (Play Next).
- **Stack:** Node.js · React + Tailwind CSS · PostgreSQL · k3s (Kustomize + Traefik + cert-manager, GHCR)
- **Created:** 2026-06-23

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

- 2026-06-23: Two providers in scope — Apple Music (MusicKit) and Spotify Web API. Open Decision O6: launch with both or one first. Either way, build the normalized `Track` abstraction first so the rest of the app is provider-agnostic.
- 2026-06-23: Keep provider tokens server-side. Cache catalog lookups and respect rate limits. Serato + live-remix are backlog, not MVP.
- 2026-06-23: Wave-1 audit — all 15 tracks confirmed PD (compositions pre-1928/composers d.>70yr); fixed Für Elise album (WoO 59, not Op. 33), corrected Minuet in G attribution to Petzold; added per-track PD basis comments; artwork verified as programmatic SVG data-URIs (non-infringing); stub search confirmed case-insensitive substring on title/artist/album; MusicProvider seam confirmed clean — tightened with TODO(real provider) block documenting tokens/rate-limits/resolve method.
