# Admin console image. Build context is the web/ workspace root, so the shared
# packages (@heirs/ui, @heirs/api-client) are available to the build:
#   docker build -f apps/admin/Dockerfile -t heirs-admin .   # run from web/
# (docker-compose sets context: ./web and dockerfile: apps/admin/Dockerfile.)

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

# ---- build: install the workspace and compile a standalone server -------------
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm -C apps/admin build

# ---- runtime: minimal image running the traced standalone output --------------
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000
# Next standalone output is traced from the web/ workspace root
# (outputFileTracingRoot), so it carries apps/admin/server.js + node_modules +
# the shared packages under their workspace paths.
COPY --from=build --chown=node:node /app/apps/admin/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/admin/.next/static ./apps/admin/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/admin/server.js"]
