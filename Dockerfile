# Copyright (c) 2026, Rademics. All rights reserved.
# Builds the API and the web app for the company server (see deploy/README.md).
# Only built code and its packages go into the images; no .env, .git or data.

FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
# The address the browser calls the API on; built into the web app.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
# Prisma's config reads this; nothing connects during the build.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production TZ=Asia/Kolkata
COPY --from=build --chown=root:root /app /app
USER node

FROM runtime AS api
WORKDIR /app/apps/api
EXPOSE 4000
# Applies any new database migrations, then starts the API.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]

FROM runtime AS web
WORKDIR /app/apps/web
# Next.js keeps its page cache here; the only folder the web app writes to.
USER root
RUN mkdir -p .next/cache && chown -R node .next/cache
USER node
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
