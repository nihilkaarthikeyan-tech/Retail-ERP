#!/bin/sh
# Copyright (c) 2026, Rademics. All rights reserved.
# Daily database backup of the Retail ERP (run by /etc/cron.d/retail-erp).
# Keeps the last 14 days in /var/backups/retail-erp (root only, outside any web folder).
# Audit 7: the file is written under a temporary name and kept only when it can be read back,
# so a broken backup never replaces a good one or looks like one. Put back with deploy/restore.sh.
set -eu
DIR=/var/backups/retail-erp
mkdir -p "$DIR"
chmod 700 "$DIR"
STAMP=$(date +%Y%m%d-%H%M)
# Audit 8: stop before the disk fills (a backup needs room for one more copy of the last one).
LAST=$(ls -t "$DIR"/retail-erp-*.dump 2>/dev/null | head -1)
NEED=$(( $( [ -n "$LAST" ] && wc -c < "$LAST" || echo 0) / 1024 * 2 + 1048576 ))
FREE=$(df -Pk "$DIR" | awk 'NR==2 {print $4}')
if [ "$FREE" -lt "$NEED" ]; then echo "$(date -u +%FT%TZ) backup NOT made: only $FREE KB free on the disk, $NEED KB needed"; exit 1; fi
OUT="$DIR/retail-erp-$STAMP.dump"
trap 'rm -f "$OUT.part"' EXIT
docker exec retail-erp-prod-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "$OUT.part"
chmod 600 "$OUT.part"
docker exec -i retail-erp-prod-postgres-1 pg_restore --list < "$OUT.part" > /dev/null
mv "$OUT.part" "$OUT"
touch "$DIR/last-good-backup"
echo "$(date -u +%FT%TZ) backup ok: $OUT ($(wc -c < "$OUT") bytes)"
find "$DIR" -name 'retail-erp-*.dump' -mtime +14 -delete
