#!/usr/bin/env bash
# Copyright (c) 2026, Rademics. All rights reserved.
# Plan 15: connects the gstinapi.in account the Retail ERP checks GSTINs with. Run on the server
# as root:
#   bash /opt/retail-erp/app/deploy/set-gstin-key.sh
# The key is typed here, never shown and never put in a chat. It is first tried with the free test
# GSTIN (no credit used). The old .env is kept as .env.bak-YYYYMMDD; the API is restarted.
set -euo pipefail

ENV_FILE="$(dirname "$0")/.env"
[ -f "$ENV_FILE" ] || { echo "No $ENV_FILE found."; exit 1; }

read -r -s -p "gstinapi.in API key (starts with gak_): " KEY; echo
# Keep only printable characters (a pasted key can carry an invisible mark or line ending).
KEY=$(printf '%s' "$KEY" | LC_ALL=C tr -cd '!-~')
case "$KEY" in
  gak_*) ;;
  *) echo "That does not look like a gstinapi.in key (it should start with gak_). Nothing changed."; exit 1 ;;
esac

CODE=$(curl -s -o /dev/null -m 20 -w '%{http_code}' -H "x-api-key: $KEY" "https://www.gstinapi.in/v1/gstin/00AAAAA0000A1ZT" || true)
if [ "$CODE" != "200" ]; then
  echo "gstinapi.in did not accept the key (answer $CODE). Nothing changed."
  unset KEY
  exit 1
fi

cp -p "$ENV_FILE" "$ENV_FILE.bak-$(date +%Y%m%d)"
if grep -q '^GSTINAPI_KEY=' "$ENV_FILE"; then
  # Replace the line without passing the key through sed.
  awk -v v="$KEY" 'index($0, "GSTINAPI_KEY=") == 1 {print "GSTINAPI_KEY=" v; next} {print}' "$ENV_FILE" > "$ENV_FILE.tmp"
  mv "$ENV_FILE.tmp" "$ENV_FILE"
else
  printf 'GSTINAPI_KEY=%s\n' "$KEY" >> "$ENV_FILE"
fi
chmod 600 "$ENV_FILE"
unset KEY

cd "$(dirname "$0")"
docker compose -f docker-compose.prod.yml --env-file .env up -d api
echo "Done. The key works (checked with the free test GSTIN). GSTIN checks are on."
