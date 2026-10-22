#!/bin/sh
# Copyright (c) 2026, Rademics. All rights reserved.
# Daily database backup of the Retail ERP (run by /etc/cron.d/retail-erp).
# Keeps the last 14 days in /var/backups/retail-erp (root only, outside any web folder).
set -eu
DIR=/var/backups/retail-erp
mkdir -p "$DIR"
chmod 700 "$DIR"
STAMP=$(date +%Y%m%d-%H%M)
docker exec retail-erp-prod-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "$DIR/retail-erp-$STAMP.dump"
chmod 600 "$DIR/retail-erp-$STAMP.dump"
find "$DIR" -name 'retail-erp-*.dump' -mtime +14 -delete
