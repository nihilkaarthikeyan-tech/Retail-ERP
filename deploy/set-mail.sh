#!/usr/bin/env bash
# Copyright (c) 2026, Rademics. All rights reserved.
# Connects the mail account the Retail ERP sends from (the new-enquiry alert
# and the owner's daily summary). Run on the server as root:
#   bash /opt/retail-erp/app/deploy/set-mail.sh
# The password is typed here, never shown and never put in a chat. The old
# .env is kept as .env.bak-YYYYMMDD; the API is restarted to read the new one.
set -euo pipefail

ENV_FILE="$(dirname "$0")/.env"
[ -f "$ENV_FILE" ] || { echo "No $ENV_FILE found."; exit 1; }

echo "Mail account for the Retail ERP. Press Enter to keep the suggestion in [brackets]."
read -r -p "Mail server [smtp.gmail.com]: " HOST; HOST=${HOST:-smtp.gmail.com}
read -r -p "Port [587]: " PORT; PORT=${PORT:-587}
read -r -p "Email address to send from [editor.publicationmart@gmail.com]: " USER_; USER_=${USER_:-editor.publicationmart@gmail.com}
read -r -s -p "Password (for Gmail: the 16-letter app password): " PASS; echo
[ -n "$PASS" ] || { echo "No password given; nothing changed."; exit 1; }
read -r -p "Send new-enquiry alerts to [editor.publicationmart@gmail.com]: " ALERT; ALERT=${ALERT:-editor.publicationmart@gmail.com}

cp -p "$ENV_FILE" "$ENV_FILE.bak-$(date +%Y%m%d)"
set_key() {
  local key="$1" value="$2"
  if grep -q "^$key=" "$ENV_FILE"; then
    # Replace the line without passing the value through sed (it may hold any character).
    awk -v k="$key" -v v="$value" 'BEGIN{FS=OFS="="} $1==k{print k"="v; next} {print}' "$ENV_FILE" > "$ENV_FILE.tmp"
    mv "$ENV_FILE.tmp" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}
set_key SMTP_HOST "$HOST"
set_key SMTP_PORT "$PORT"
set_key SMTP_SECURE "$([ "$PORT" = 465 ] && echo true || echo false)"
set_key SMTP_USER "$USER_"
set_key SMTP_PASSWORD "$PASS"
set_key MAIL_FROM "Retail ERP <$USER_>"
set_key LEAD_ALERT_TO "$ALERT"
chmod 600 "$ENV_FILE"
unset PASS

cd "$(dirname "$0")"
docker compose -f docker-compose.prod.yml --env-file .env up -d api
echo "Done. Fill in the contact form on https://retailerp.52digit.com to see the alert arrive."
