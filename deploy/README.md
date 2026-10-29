# Putting the Retail ERP on the company server

The server runs three containers (database, API, web app) with Docker, behind the server's own Nginx.
Address: **https://retailerp.52digit.com** — the web app at `/`, the API at `/api/`.

| Where | What |
| --- | --- |
| `/opt/retail-erp/app` | the code, a copy of the GitHub repository (read-only for everyone but root) |
| `/opt/retail-erp/app/deploy/.env` | passwords and settings (root only, `chmod 600`, never committed) |
| Docker volume `retail-erp-prod_pgdata` | the database |
| `/var/backups/retail-erp` | nightly database backups, last 14 days (root only) |
| `127.0.0.1:4060` / `127.0.0.1:4061` | web app / API, reachable only through Nginx |

## First time

1. **DNS (Cloudflare, where 52digit.com is managed):** add an `A` record, name `retailerp`, value the server's IP address.
2. On the server, as root:
   ```sh
   mkdir -p /opt/retail-erp && cd /opt/retail-erp
   git clone https://github.com/nihilkaarthikeyan-tech/Retail-ERP.git app
   cp app/deploy/env.example app/deploy/.env && chmod 600 app/deploy/.env   # fill in the passwords
   cd app/deploy && docker compose -f docker-compose.prod.yml --env-file .env up -d --build
   ```
3. Nginx: copy `nginx-retailerp.conf` to `/etc/nginx/sites-available/retailerp.52digit.com`, link it into `sites-enabled`,
   `nginx -t`, then `systemctl reload nginx` (never restart). Then `certbot --nginx -d retailerp.52digit.com`.
4. Backups: `cp deploy/retail-erp.cron /etc/cron.d/retail-erp`, then run `deploy/backup.sh` once by hand to check it.
5. Make the Retail ERP admin (the people who run the service; see every shop at `/admin`). The password is
   generated and kept in a root-only file; read it on the server, never paste it into a chat or a ticket:
   ```sh
   umask 077; docker exec retail-erp-prod-api-1 node dist/platform/create-admin.js you@example.com "Your name" > /root/retailerp-admin.txt
   cat /root/retailerp-admin.txt
   ```
   Running it again for the same email gives a new password and ends that admin's open sessions.
   Shops sign up themselves at `/signup`.

## Email (new-enquiry alert and daily summary)

The Retail ERP emails each new contact-form message to `LEAD_ALERT_TO` (editor.publicationmart@gmail.com unless set).
It sends from **no-reply@rademics.ai** (Hostinger Business Email: `smtp.hostinger.com`, port 465, SSL; the free plan allows 100 emails a day).
To connect or change the mail account, run on the server as root and type the password when asked:

```sh
bash /opt/retail-erp/app/deploy/set-mail.sh
```

To send from Gmail instead, answer `smtp.gmail.com` and port 587, and use an **app password** made at
https://myaccount.google.com/apppasswords (2-Step Verification must be on).

## Updating to a new version

```sh
cd /opt/retail-erp/app && git pull
cd deploy && docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```

The API applies new database migrations by itself when it starts. Take a backup first (`deploy/backup.sh`).

## Checks after every deploy

- `https://retailerp.52digit.com` opens; logging in works.
- These must **not** return 200: `/.git/HEAD`, `/.env`, `/deploy/.env`, `/api/.env`.
- `docker ps` shows the three `retail-erp-prod-*` containers as running.

## Restoring a backup

```sh
bash /opt/retail-erp/app/deploy/restore.sh /var/backups/retail-erp/<file>.dump
```

The script backs up the database as it is now, restores into a separate database in one transaction
(a failed restore changes nothing), then swaps it in and keeps the old one as `<name>_before_<date>`.
On a new server it also makes the two database roles; run `deploy/limit-db-role.sh` afterwards as it says.
Each night's backup is kept only if it reads back; `/var/backups/retail-erp/last-good-backup` shows when the last good one was made.
