# syntax=docker/dockerfile:1
#
# lookmd — single-container image for Coolify (or any Docker host).
#
# One origin: the Fastify server serves the built React client *and* the file
# API/WebSocket on one port, so there is no CORS or proxy to configure. The
# server runs the TypeScript sources directly via Node 24's native type
# stripping (no server build step), matching the repo's `node src/index.ts`.
#
# Runtime config (all via env — set these in Coolify):
#   LOOKMD_BASE        directory the server may touch  (default /data — MOUNT A VOLUME)
#   LOOKMD_PORT        listen port                     (default 4317)
#   LOOKMD_HOST        bind address                    (default 0.0.0.0)
#   LOOKMD_READ_ONLY   "1" disables all write endpoints (view-only build)
#   LOOKMD_STATIC_DIR  built client to serve           (preset to /app/client/dist)

# ---- Build stage: install all workspaces and build the client ----------------
FROM node:24-slim AS build
WORKDIR /app

# Manifests first for a cache-friendly install.
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci

# Build the client (-> client/dist), then strip dev-only deps (vite, tsc, types).
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- Runtime stage -----------------------------------------------------------
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    LOOKMD_HOST=0.0.0.0 \
    LOOKMD_PORT=4317 \
    LOOKMD_BASE=/data \
    LOOKMD_STATIC_DIR=/app/client/dist

# Pruned deps (incl. the @lookmd/shared workspace symlink), the server + shared
# TypeScript sources, and the built client. Sources are run as-is by Node.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/shared ./shared
COPY --from=build /app/server ./server
COPY --from=build /app/client/dist ./client/dist

# Default workspace mount point — attach a persistent volume here on Coolify.
RUN mkdir -p /data

EXPOSE 4317

# Liveness via the built-in health route (uses Node's global fetch — no curl).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.LOOKMD_PORT||4317)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "server/src/index.ts"]
