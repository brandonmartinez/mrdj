# syntax=docker/dockerfile:1
#
# mrdj production image (Epic 9 #36).
# Single container that serves both the Express API and the built React SPA on one port.
# The SPA calls /api on the same origin, so no separate web server is needed.
#
#   docker build -t ghcr.io/brandonmartinez/mrdj:latest .
#   docker run --rm -p 3000:3000 --env-file .env ghcr.io/brandonmartinez/mrdj:latest
#
# Migrations are applied out-of-band (see k8s/ + story #45), not at container start.

# ── Builder ───────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# Install all workspace deps from the lockfile first (cached unless manifests change).
COPY package.json package-lock.json ./
COPY api/package.json ./api/package.json
COPY web/package.json ./web/package.json
RUN npm ci

# Build api (tsup → api/dist) and web (vite → web/dist).
COPY . .
RUN npm run build

# Drop devDependencies so only runtime deps are carried into the final image.
RUN npm prune --omit=dev

# ── Runtime ───────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    WEB_DIST_PATH=/app/web/dist

# Hoisted workspace node_modules (tsup externalizes deps, so they're needed at runtime).
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
# Compiled API bundle.
COPY --from=builder /app/api/dist ./api/dist
COPY --from=builder /app/api/package.json ./api/package.json
# Built SPA (served as static + fallback by the API).
COPY --from=builder /app/web/dist ./web/dist

EXPOSE 3000
USER node
CMD ["node", "api/dist/index.js"]
