# Planet Rush allocator — a plain Node container. OWNER: Netcode Engineer
# (GDD §4.2; docs/hosting-plan.md, Task 8).
#
# The same portability contract as the match server (server/Dockerfile): the
# allocator ships as a **plain Dockerized Node process with zero vendor-specific
# APIs**. The Fly-vs-direct routing choice is a runtime environment variable
# (ALLOCATOR_ROUTER), never a build-time dependency — so this image runs on Fly,
# on the €4 VPS, on the Oracle free tier (docs/netcode-spike.md), or on a laptop,
# unchanged.
#
# The allocator is the control plane, never the gameplay path: once a client
# holds its ticket and its socket, this container can be redeployed or vanish and
# every live match carries on. Keep it that way — no long-lived per-Machine
# connection belongs in here.
#
#   Build (from the repository root — the build context is the repo):
#     docker build -f allocator/Dockerfile -t planet-rush-allocator .
#   Run:
#     docker run --rm -p 8080:8080 -e ALLOCATOR_SECRET=... planet-rush-allocator
#   Routes:
#     GET /health · GET /regions · POST /rooms · POST /rooms/:code/join · POST /fleet/heartbeat
#
# The runtime stage is `node` plus one bundled file: no `node_modules`, no native
# module to rebuild for ARM, nothing to install at boot.

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
COPY allocator ./allocator

# Typecheck before bundling: an allocator that does not compile must not build.
# Uses the allocator's own tsconfig (allocator/tsconfig.json), whose `include`
# covers src/ and allocator/ — the root config's `include` omits allocator/, and
# this stage does not copy tests/, so the root config would leave this code
# unchecked here.
RUN npx tsc --noEmit -p allocator/tsconfig.json
RUN npx vite build --config allocator/vite.allocator.config.ts

# --- runtime ----------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

# One file, owned by the unprivileged user the base image already provides.
COPY --from=build --chown=node:node /app/allocator/dist/allocator.mjs ./allocator.mjs

USER node
EXPOSE 8080

# The health route is plain HTTP so a checker never has to parse anything richer
# (allocator/index.ts). A free-tier host that reclaims idle compute sees a
# control plane that answers.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# No shell form, so the process is PID 1 and receives SIGTERM directly — the
# graceful shutdown in allocator/index.ts depends on getting the signal itself.
CMD ["node", "allocator.mjs"]
