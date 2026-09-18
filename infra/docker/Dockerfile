# One image for every Node/Next service. The service picks its role at runtime via $APP, and the
# api service runs the idempotent DB release first via $PRELAUNCH. Node services run TypeScript
# directly (tsx / swc); web is prebuilt. Engine-free Prisma client — no native binary to download.
FROM node:22-slim AS base
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

COPY . .
RUN pnpm install --frozen-lockfile
# Prisma client + Pothos datamodel (no DB connection needed at build time).
RUN DATABASE_URL_ADMIN="postgresql://build:build@localhost:5432/build" PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1 pnpm db:generate
# Web production build (harmless for the other services; keeps one image for all).
# Next.js bakes rewrite destinations (/api/* → the API) into the build, so API_URL must be present
# during `next build`. Railway supplies declared ARGs from the service's variables; the default is
# this deployment's API service URL so the correct target is baked even if the build arg is absent.
ARG API_URL=https://api-production-a2b4.up.railway.app
RUN API_URL="${API_URL}" pnpm --filter @cadence/web build

ENV NODE_ENV=production
# $APP selects the service (api|worker|web|startpage|mcp); $PRELAUNCH runs first (api → DB release).
CMD ["sh", "-c", "${PRELAUNCH:-true} && pnpm --filter @cadence/${APP} start"]
