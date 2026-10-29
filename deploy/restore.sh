#!/usr/bin/env bash
# Copyright (c) 2026, Rademics. All rights reserved.
# Audit 7: puts a database backup back safely. Run on the server as root:
#   bash /opt/retail-erp/app/deploy/restore.sh /var/backups/retail-erp/retail-erp-YYYYMMDD-HHMM.dump
# 1. Checks the backup file can be read.
# 2. Takes a backup of the database as it is now.
# 3. Restores into a new, separate database in one transaction: if anything fails, nothing has changed.
# 4. Stops the API, keeps the current database under a dated name, puts the restored one in its place
#    and starts the API (which applies any newer migrations by itself).
# Nothing is deleted: the database as it was stays as <name>_before_YYYYMMDDHHMMSS until removed by hand.
# Works on a new server too: the two database roles are made first when they are missing.
set -euo pipefail
cd "$(dirname "$0")"
FILE=${1:?Usage: bash deploy/restore.sh <backup file>}
[ -f "$FILE" ] || { echo "No such file: $FILE"; exit 1; }
[ -f .env ] || { echo "No deploy/.env"; exit 1; }
# Read only the two names needed (the file holds values a shell cannot read as a script).
val() { grep -m1 "^$1=" .env | cut -d= -f2- | tr -d '\r'; }
POSTGRES_USER=$(val POSTGRES_USER); POSTGRES_DB=$(val POSTGRES_DB)
[ -n "$POSTGRES_USER" ] && [ -n "$POSTGRES_DB" ] || { echo "POSTGRES_USER / POSTGRES_DB missing in deploy/.env"; exit 1; }
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env"
# PG_CONTAINER is set only when this script is tried on a spare database container (no API there).
DB=${PG_CONTAINER:-$($COMPOSE ps -q postgres)}
[ -n "$DB" ] || { echo "The database container is not running"; exit 1; }
sql() { docker exec -i "$DB" psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres -Atq "$@"; }

docker exec -i "$DB" pg_restore --list < "$FILE" > /dev/null || { echo "The backup file cannot be read; nothing was changed."; exit 1; }
STAMP=$(date +%Y%m%d%H%M%S)
NEW="${POSTGRES_DB}_restore"
OLD="${POSTGRES_DB}_before_${STAMP}"

if [ -z "${PG_CONTAINER:-}" ]; then
  echo "Taking a backup of the database as it is now..."
  bash ./backup.sh
fi

# Roles belong to the server, not to a backup: on a new server they are made here.
sql <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'retail_erp_app') THEN
    CREATE ROLE retail_erp_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'retail_erp_owner') THEN
    CREATE ROLE retail_erp_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;
GRANT retail_erp_app TO retail_erp_owner;
SQL

echo "Restoring into a separate database ($NEW)..."
sql -c "DROP DATABASE IF EXISTS \"$NEW\"" -c "CREATE DATABASE \"$NEW\""
if ! docker exec -i "$DB" pg_restore -U "$POSTGRES_USER" -d "$NEW" --exit-on-error --single-transaction < "$FILE"; then
  sql -c "DROP DATABASE IF EXISTS \"$NEW\""
  echo "The restore failed; the live database was not touched."
  exit 1
fi
# Database-level rights are not inside a backup.
sql -c "GRANT CONNECT, TEMPORARY ON DATABASE \"$NEW\" TO retail_erp_owner"
COUNTS=$(docker exec -i "$DB" psql -U "$POSTGRES_USER" -d "$NEW" -Atc \
  "SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public') || ' tables, ' || (SELECT count(*) FROM \"_prisma_migrations\") || ' migrations, ' || (SELECT count(*) FROM \"Company\") || ' companies'")
echo "Restored: $COUNTS"

[ "$(sql -c "SELECT count(*) FROM pg_database WHERE datname = '$OLD'")" = "0" ] || { echo "$OLD already exists; nothing was changed."; exit 1; }
if [ -z "${PG_CONTAINER:-}" ]; then
  # From here on the API is started again whatever happens.
  trap '$COMPOSE start api' EXIT
  $COMPOSE stop api
fi
sql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$POSTGRES_DB' AND pid <> pg_backend_pid()" > /dev/null
sql -c "ALTER DATABASE \"$POSTGRES_DB\" RENAME TO \"$OLD\"" -c "ALTER DATABASE \"$NEW\" RENAME TO \"$POSTGRES_DB\""
# A role made here (new server) has no password yet.
NO_PASSWORD=$(sql -c "SELECT count(*) FROM pg_authid WHERE rolname = 'retail_erp_owner' AND rolpassword IS NULL")

echo "Done. The backup is now the live database; the previous one is kept as $OLD."
if [ "$NO_PASSWORD" = "1" ]; then
  echo "This is a new server: run  bash $(pwd)/limit-db-role.sh  now to give the API its database password."
fi
