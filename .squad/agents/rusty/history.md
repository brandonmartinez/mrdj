# Project Context

- **Owner:** the project owner
- **Project:** mrdj — Jukebox-style social jukebox. Guests request songs into a DJ's live queue, buy credits, and pay to bump (Up Next) or premium-bump (Play Next).
- **Stack:** Node.js · React + Tailwind CSS · PostgreSQL · k3s (Kustomize + Traefik + cert-manager, GHCR)
- **Created:** 2026-06-23

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

- 2026-06-23: Team cast (Ocean's Eleven). Core mechanic to get right: the **Play Next** single-slot lock — only one purchasable at a time, not always available, resets after the bumped song plays. This is the architectural keystone and is money-adjacent, so correctness > cleverness.
- 2026-06-23: Deployment mirrors the reference app in the cluster infrastructure repo (Traefik + cert-manager, GHCR, `/api/health` probes). Don't reinvent the deploy.
