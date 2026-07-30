# Planet Rush match server — a plain Node container. OWNER: Netcode Engineer
# (GDD §3.5, §4.2).
#
# The hard requirement behind the whole hosting decision: the server ships as a
# **plain Dockerized Node process with zero vendor-specific APIs**, so it
# redeploys anywhere in an afternoon (GDD §4.2, risk 1 — "portability is the
# mitigation, not the vendor"). The day-0 spike chose Oracle Cloud Always Free
# (ARM Ampere) with a ~€4/month VPS as the standing fallback
# (docs/netcode-spike.md); this image runs identically on either, and on a
# laptop.
#
#   Build (from the repository root — the build context is the repo):
#     docker build -f server/Dockerfile -t planet-rush-server .
#   Run:
#     docker run --rm -p 8080:8080 planet-rush-server
#   Play:
#     ws://<host>:8080/   ·   health: http://<host>:8080/health
#
# The runtime stage is `node` plus one bundled file: no `node_modules`, no
# native module to rebuild for ARM, nothing to install at boot.

# --- build ------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Dependencies first, so a source-only change reuses this layer. `npm ci` here
# installs devDependencies (TypeScript, Vite) — none of them reach the runtime
# image, which is the point of the second stage.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY content ./content
COPY server ./server
# allocator/ is a BUILD-TIME dependency of the match server, not a runtime one:
# `server/upgrade-router.ts` builds its `fly-replay` directive with the same
# `FlyReplayRouter` the allocator uses (allocator/router.ts) rather than
# hand-rolling a second copy of the header format. Nothing from the allocator
# *process* ships — the runtime stage below copies one bundled file — but without
# these sources the bundler cannot resolve that import and the image does not
# build at all. Which is exactly what happened (M10): the socket-hop machine-pin
# landed with this import and no COPY, so every gameserver deploy failed from
# then on, the fleet kept serving a PRE-PIN image, and `MATCH_ROUTER = "fly"`
# never reached a Machine either — the pin was correct in the repo and absent
# from production, and the join lottery came back. `tests/server/docker-context.test.ts`
# now asserts every cross-directory import the server makes is copied here.
COPY allocator ./allocator

# Typecheck before bundling: a server that does not compile must not build.
RUN npx tsc --noEmit
RUN npx vite build --config server/vite.server.config.ts

# --- runtime ----------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

# One file, owned by the unprivileged user the base image already provides.
COPY --from=build --chown=node:node /app/server/dist/match-server.mjs ./match-server.mjs

USER node
EXPOSE 8080

# The health route is plain HTTP so a checker never has to speak WebSocket
# (server/index.ts). A free-tier host that reclaims *idle* compute sees a
# server that answers.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# No shell form, so the process is PID 1 and receives SIGTERM directly — the
# graceful shutdown in server/index.ts depends on getting the signal itself.
CMD ["node", "match-server.mjs"]
