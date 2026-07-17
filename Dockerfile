# syntax=docker/dockerfile:1
# Orbit — single image running the backend (127.0.0.1:6800, internal) and the
# dashboard custom server (0.0.0.0:6801, the only exposed port).
#
# Targets:
#   runtime (default) — slim production image: prebuilt .next, dev deps pruned.
#   dev               — full toolchain: runs `next dev` (HMR). Use with the
#                       docker-compose.dev.yml override (bind-mounts source).
#
# The `pi` CLI is provided at runtime (bind-mounted from the host — see
# docker-compose.yml); Lightpanda runs as a sibling service via LIGHTPANDA_WS.

# ── Build stage: all deps + dashboard build (NOT pruned; shared by dev+runtime) ──
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Install deps first (better layer caching). Each package has its own lockfile.
COPY package.json package-lock.json ./
RUN npm ci
COPY dashboard/package.json dashboard/package-lock.json ./dashboard/
RUN npm --prefix dashboard ci
# The lightpanda MCP server has its own deps (puppeteer-core); the other MCP
# servers + backend use the root node_modules.
COPY mcp-servers/lightpanda/package.json mcp-servers/lightpanda/package-lock.json ./mcp-servers/lightpanda/
RUN npm --prefix mcp-servers/lightpanda ci

# App source (node_modules/.next excluded via .dockerignore, so the installs above survive).
COPY . .

# Build the dashboard for production use (dev target ignores this; next dev rebuilds).
RUN npm --prefix dashboard run build

# ── Dev stage: full deps + source, runs next dev (HMR) via NODE_ENV=development ──
FROM build AS dev
ENV NODE_ENV=development
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*
EXPOSE 6801
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/docker-entrypoint.sh"]

# ── Runtime stage (default): slim production image ──────────────────
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# tini reaps the two node children and forwards signals for clean shutdown.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app /app
# Drop dev-only deps now that the dashboard is built — slims the prod image.
RUN npm prune --omit=dev \
 && npm --prefix dashboard prune --omit=dev

# Dashboard (the public face). Backend stays on internal 127.0.0.1:6800.
EXPOSE 6801

# Basic liveness: the dashboard answers on 6801.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:6801/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/docker-entrypoint.sh"]
