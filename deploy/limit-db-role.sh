#!/usr/bin/env bash
# Copyright (c) 2026, Rademics. All rights reserved.
# Audit 1 #18 (owner, 28 October 2026): moves the API off the database superuser. Run once on the
# server as root:  bash /opt/retail-erp/app/deploy/limit-db-role.sh
# Makes a random password (never shown), runs limit-db-role.sql as the superuser, writes
# DB_APP_USER / DB_APP_PASSWORD into deploy/.env (kept as .env.bak-YYYYMMDD, chmod 600) and restarts the API.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo "No deploy/.env"; exit 1; }
# Read only the two names needed (the file holds values a shell cannot read as a script).
val() { grep -m1 "^$1=" .env | cut -d= -f2- | tr -d ''; }
POSTGRES_USER=$(val POSTGRES_USER); POSTGRES_DB=$(val POSTGRES_DB)
[ -n "$POSTGRES_USER" ] && [ -n "$POSTGRES_DB" ] || { echo "POSTGRES_USER / POSTGRES_DB missing in deploy/.env"; exit 1; }
PW=$(openssl rand -hex 24)
DB=$(docker compose -f docker-compose.prod.yml --env-file .env ps -q postgres)
docker cp limit-db-role.sql "$DB":/tmp/limit-db-role.sql
docker exec "$DB" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v pw="'$PW'" -v DBNAME="$POSTGRES_DB" -f /tmp/limit-db-role.sql >/dev/null
docker exec "$DB" rm -f /tmp/limit-db-role.sql
# The new login works before the API is switched to it.
docker exec -e PGPASSWORD="$PW" "$DB" psql -h localhost -U retail_erp_owner -d "$POSTGRES_DB" -Atc 'SELECT 1' >/dev/null
cp -p .env ".env.bak-$(date +%Y%m%d)"
grep -v '^DB_APP_USER=\|^DB_APP_PASSWORD=' .env > .env.tmp
printf 'DB_APP_USER=retail_erp_owner\nDB_APP_PASSWORD=%s\n' "$PW" >> .env.tmp
mv .env.tmp .env; chmod 600 .env
unset PW
docker compose -f docker-compose.prod.yml --env-file .env up -d api
echo "Done. The API now connects as retail_erp_owner (no superuser rights)."
