# Tenant portal image. Build context is the web/ workspace root, so the shared
# packages (@heirs/ui, @heirs/api-client) are available to the build:
#   docker build -f apps/tenant/Dockerfile -t heirs-tenant .   # run from web/
# (docker-compose sets context: ./web and dockerfile: apps/tenant/Dockerfile.)

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

# ---- build: install the workspace and compile a standalone server -------------
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm -C apps/tenant build

# ---- runtime: minimal image running the traced standalone output --------------
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001
COPY --from=build --chown=node:node /app/apps/tenant/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/tenant/.next/static ./apps/tenant/.next/static
USER node
EXPOSE 3001
CMD ["node", "apps/tenant/server.js"]
