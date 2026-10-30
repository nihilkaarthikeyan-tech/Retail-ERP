#!/bin/sh
# Copyright (c) 2026, Rademics. All rights reserved.
# Audit 12: proves a backup can be put back, without touching the live database. Takes a fresh backup
# (or uses the file given), restores it into a temporary database beside the live one, compares the
# rows of every table with the live database, then deletes the temporary database.
#   sh deploy/restore-check.sh                 # a fresh backup, checked
#   sh deploy/restore-check.sh <file>.dump     # an existing backup, checked (live rows may have moved on)
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
PG=${PG:-retail-erp-prod-postgres-1}
if [ $# -ge 1 ]; then
  FILE=$1
else
  sh "$HERE/backup.sh"
  FILE=$(ls -t /var/backups/retail-erp/retail-erp-*.dump | head -1)
fi
CHECK="restore_check_$(date +%Y%m%d%H%M%S)"
psql_pg() { docker exec -i "$PG" sh -c "psql -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d $1 -Atq"; }
cleanup() { echo "DROP DATABASE IF EXISTS $CHECK;" | psql_pg postgres >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "Backup: $FILE ($(wc -c < "$FILE") bytes)"
echo "CREATE DATABASE $CHECK;" | psql_pg postgres
START=$(date +%s)
# One transaction: a backup that cannot be put back in full fails here.
docker exec -i "$PG" sh -c "pg_restore -U \"\$POSTGRES_USER\" -d $CHECK --single-transaction --exit-on-error" < "$FILE"
echo "Restored into $CHECK in $(( $(date +%s) - START )) s"

COUNTS="SELECT table_name || ' ' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', table_name), false, true, '')))[1]::text
        FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1;"
LIVE_DB=$(docker exec "$PG" sh -c 'echo "$POSTGRES_DB"')
echo "$COUNTS" | psql_pg "$LIVE_DB" > /tmp/$CHECK.live
echo "$COUNTS" | psql_pg "$CHECK" > /tmp/$CHECK.restored
TABLES=$(wc -l < /tmp/$CHECK.restored)
ROWS=$(awk '{s += $2} END {print s}' /tmp/$CHECK.restored)
GUARDS=$(echo "SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal;" | psql_pg "$CHECK")
RLS=$(echo "SELECT count(*) FROM pg_class WHERE relrowsecurity AND relnamespace = 'public'::regnamespace;" | psql_pg "$CHECK")
if diff /tmp/$CHECK.live /tmp/$CHECK.restored > /tmp/$CHECK.diff; then
  echo "RESTORE CHECK OK: $TABLES tables, $ROWS rows, $GUARDS triggers, $RLS tables with row-level security; every table matches the live database"
  RESULT=0
else
  echo "RESTORE CHECK: restored, but these tables differ from the live database now (live first):"
  cat /tmp/$CHECK.diff
  RESULT=1
fi
rm -f /tmp/$CHECK.live /tmp/$CHECK.restored /tmp/$CHECK.diff
exit $RESULT
