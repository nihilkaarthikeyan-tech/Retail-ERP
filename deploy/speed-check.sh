#!/bin/sh
# Copyright (c) 2026, Rademics. All rights reserved.
# Audit 12: times 20 tills saving bills at once (apps/api/perf/tills20.perf.ts) on this server, in a
# throwaway copy: its own database container with made-up data, no ports, its own network, capped at
# 2 CPUs. Live shops and their database are never touched. Everything is removed at the end.
#   sh /opt/retail-erp/app/deploy/speed-check.sh
set -eu
APP=$(cd "$(dirname "$0")/.." && pwd)
WORK=/root/retail-erp-speedcheck
NET=retail-erp-speedcheck
DB=retail-erp-speedcheck-db
PW=$(head -c 18 /dev/urandom | base64 | tr -dc A-Za-z0-9)
cleanup() {
  docker rm -f "$DB" retail-erp-speedcheck-run >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
cleanup

git clone --quiet --depth 1 "file://$APP" "$WORK"
docker network create --internal=false "$NET" >/dev/null
docker run -d --name "$DB" --network "$NET" --memory 2g --cpus 2 -e POSTGRES_USER=speed -e POSTGRES_PASSWORD="$PW" -e POSTGRES_DB=speed postgres:17-alpine >/dev/null
until docker exec "$DB" pg_isready -U speed -d speed >/dev/null 2>&1; do sleep 1; done
URL="postgresql://speed:$PW@$DB:5432/speed?schema=public"
docker run --rm --name retail-erp-speedcheck-run --network "$NET" --memory 3g --cpus 2 \
  -e DATABASE_URL="$URL" -e PERF_DATABASE_URL="$URL" -e CI=1 -v "$WORK:/w" -w /w node:24-bookworm-slim \
  sh -c 'corepack enable >/dev/null && pnpm install --frozen-lockfile --silent && pnpm --filter shared run build >/dev/null && cd apps/api && pnpm perf:tills 2>&1 | grep -E "TILLS20|passed|failed|Error"'
