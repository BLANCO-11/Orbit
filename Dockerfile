# syntax=docker/dockerfile:1
# Orbit — single image running the backend (127.0.0.1:6800 by default) and the
# dashboard custom server (0.0.0.0:6801). The `pi` agent harness is the public
# npm package @earendil-works/pi-coding-agent, installed into the image (no host
# mount needed). Lightpanda runs as a sibling compose service via LIGHTPANDA_WS.
#
# Targets:
#   runtime (default) — slim production image: prebuilt .next, dev deps pruned.
#   dev               — full toolchain: runs `next dev` (HMR); use with
#                       docker-compose.dev.yml (bind-mounts source).

# ── pi base: node + python + tini + the pi harness & its extensions (shared) ──
# The agent executes in this container (sandbox=host), so its runtime lives here.
# Node powers the pi harness and JS tooling; Python 3 + uv give agents a
# first-class Python runtime — the preferred surface for scripts/automation.
FROM node:22-bookworm-slim AS pi
ENV PI_VERSION=0.80.7
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates python3 python3-venv \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g @earendil-works/pi-coding-agent@${PI_VERSION} \
 && pi install npm:pi-mcp-extension
# uv — fast Python package/venv manager & script runner (PEP 723 inline deps).
# Ideal for agent-authored .py scripts; sidesteps Debian's PEP 668 global-pip lock.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/
# LLM access uses pi's NATIVE OpenAI-compatible provider (registered per-spawn by
# agent-backend/harnesses/picode/orbit-provider.mjs, pointed at the app's own LLM
# gateway) — so the bespoke `pi-provider-litellm` extension is no longer baked in.
# pi is now on PATH (/usr/local/bin/pi) with node at /usr/local/bin/node, so
# Orbit's binary discovery finds it — no PI_CLI_PATH/PI_NODE_PATH needed.

# ── Build stage: all deps + dashboard build (NOT pruned; shared by dev+runtime) ──
FROM pi AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY dashboard/package.json dashboard/package-lock.json ./dashboard/
RUN npm --prefix dashboard ci
COPY mcp-servers/lightpanda/package.json mcp-servers/lightpanda/package-lock.json ./mcp-servers/lightpanda/
RUN npm --prefix mcp-servers/lightpanda ci
COPY . .
RUN npm --prefix dashboard run build

# ── Dev stage: full deps + source, runs next dev (HMR) ──
FROM build AS dev
ENV NODE_ENV=development
EXPOSE 6801
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/docker-entrypoint.sh"]

# ── Runtime stage (default): slim production image ──
FROM pi AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
# Drop dev-only deps now that the dashboard is built — slims the prod image.
RUN npm prune --omit=dev \
 && npm --prefix dashboard prune --omit=dev

EXPOSE 6801
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:6801/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/docker-entrypoint.sh"]
