# Copyright (c) 2026, Rademics. All rights reserved.
# Builds the API and the web app for the company server (see deploy/README.md).
# Only built code and its packages go into the images; no .env, .git or data.
# Audit 10: each image holds only its own app and the packages it runs with (no sources, tests or
# development tools), and runs as the unprivileged `node` user.

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
# The API with its production packages only (the shared package as built), plus what it reads at
# run time: the migrations, Prisma's config and the official HSN list.
RUN pnpm --filter api deploy --prod /out/api \
 && cp -r apps/api/dist apps/api/prisma apps/api/prisma.config.ts apps/api/data /out/api/ \
 && rm -rf /out/api/src /out/api/test /out/api/perf /out/api/vitest.config*.ts /out/api/tsconfig*.json /out/api/*.tsbuildinfo /out/api/nest-cli.json

FROM node:24-bookworm-slim AS api
WORKDIR /app
ENV NODE_ENV=production TZ=Asia/Kolkata
COPY --from=build --chown=root:root /out/api /app
USER node
EXPOSE 4000
# Applies any new database migrations, then starts the API.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]

FROM node:24-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production TZ=Asia/Kolkata PORT=3000 HOSTNAME=0.0.0.0
# Next.js's standalone server: only the files the site uses, then its static files and public folder.
COPY --from=build --chown=root:root /app/apps/web/.next/standalone /app
COPY --from=build --chown=root:root /app/apps/web/.next/static /app/apps/web/.next/static
COPY --from=build --chown=root:root /app/apps/web/public /app/apps/web/public
# Next.js keeps its page cache here; the only folder the web app writes to.
RUN mkdir -p /app/apps/web/.next/cache && chown -R node /app/apps/web/.next/cache
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
