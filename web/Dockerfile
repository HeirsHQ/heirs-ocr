# syntax=docker/dockerfile:1
#
# Multi-stage build for the Heirs OCR web console (Next.js 16, standalone output).
# Runtime config is supplied at container start (12-factor III):
#   OCR_API_URL  → base URL of the API service (e.g. http://api:8080 on the compose net)
#   OCR_API_KEY  → bearer key the /api/ocr/* proxy attaches (empty when AUTH_ENABLED=false)
# These are read only in server-side route handlers, never shipped to the browser.

# ---- base: Node + pnpm via corepack --------------------------------------
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

# ---- build: full deps + compile the standalone server --------------------
FROM base AS build
# Manifests first so the install layer caches until dependencies change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

# ---- runtime: minimal image, non-root ------------------------------------
FROM node:22-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app

# Standalone bundle: the server + only the traced node_modules, plus static assets.
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static

USER node
EXPOSE 3000

# Liveness: the login page at / returns 200 for an unauthenticated request.
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

# Standalone entrypoint emitted by `next build`.
CMD ["node", "server.js"]
