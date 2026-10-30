# Retail ERP: what to do when it breaks

For whoever looks after the live system. Everything needed to run and recover it is written here, so it does not depend on one person's memory. Written in audit 12 (30 October 2026).

## Where everything is

| What | Where |
| --- | --- |
| The live site | https://retailerp.52digit.com (through Cloudflare; the API is at `/api/`) |
| The server | Hostinger VPS, ssh alias `rademics`, Ubuntu 22.04, shared with about 30 other sites |
| The code on the server | `/opt/retail-erp/app` (a copy of the GitHub repository `nihilkaarthikeyan-tech/Retail-ERP`, branch `main`) |
| Passwords and settings | `/opt/retail-erp/app/deploy/.env` (root only). Never paste it into a chat, a ticket or an email |
| The admin password | `/root/retailerp-admin.txt` (root only) |
| The database | Docker volume `retail-erp-prod_pgdata`, container `retail-erp-prod-postgres-1` |
| The three containers | `retail-erp-prod-postgres-1`, `retail-erp-prod-api-1` (port 127.0.0.1:4061), `retail-erp-prod-web-1` (127.0.0.1:4060) |
| Nginx site | `/etc/nginx/sites-available/retailerp.52digit.com` (HTTPS certificate by Certbot, renewed by itself) |
| Backups | `/var/backups/retail-erp`, every night at 04:00 Indian time, last 14 days. `last-good-backup` shows when the last good one was made |
| Logs | `docker logs retail-erp-prod-api-1` (5 × 20 MB kept), `/var/log/retail-erp-backup.log`, `/var/log/retail-erp-health.log` |
| Scheduled jobs | `/etc/cron.d/retail-erp`: the backup and the 5-minute health check |
| Email account | no-reply@rademics.ai (Hostinger Business Email). The plan must be renewed each year (next: before 3 November 2026) |

## The alert email

Every 5 minutes `deploy/health-check.py` checks that the API answers, that its database is connected, that the web app answers, and that last night's backup was made. When something goes wrong, or comes back, it emails `LEAD_ALERT_TO` (editor.publicationmart@gmail.com). It does not repeat the email while the problem lasts.

## First steps for any problem

On the server as root:

```sh
docker ps --filter name=retail-erp --format '{{.Names}} {{.Status}}'
curl -s http://127.0.0.1:4061/health
docker logs --since 30m retail-erp-prod-api-1 2>&1 | tail -50
df -h /
```

## "The API is not answering" or "the web app is not answering"

1. Look at `docker ps` (above). A container that is not "Up":
   ```sh
   cd /opt/retail-erp/app/deploy && docker compose -f docker-compose.prod.yml --env-file .env up -d
   ```
2. Up but not answering: read its log (above). Then restart only that container: `docker restart retail-erp-prod-api-1`.
3. "Out of memory" in `docker inspect retail-erp-prod-api-1 --format '{{.State.OOMKilled}}'`: it reached its memory limit and was restarted. If it happens again, raise `mem_limit` in `deploy/docker-compose.prod.yml` and run the `up -d` line above.

## "The API answers but cannot reach its database"

1. `docker logs --since 30m retail-erp-prod-postgres-1`.
2. `docker restart retail-erp-prod-postgres-1`, wait 20 seconds, then `docker restart retail-erp-prod-api-1`.
3. Disk full (`df -h /`)? Free space first. Never delete anything in `/var/lib/docker` by hand.

## "No good backup"

1. `tail /var/log/retail-erp-backup.log` tells why.
2. Run it by hand: `sh /opt/retail-erp/app/deploy/backup.sh`.

## Undo a bad update (rollback)

Each update is one commit. To go back to the one before:

```sh
cd /opt/retail-erp/app
git log --oneline -5                     # pick the commit that worked
sh deploy/backup.sh                      # always first
git checkout <commit>                    # the code as it was
cd deploy && docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```

When it works again, go back to following `main` once the fix is pushed: `git checkout main && git pull`.

The database is never rolled back by this. Database changes only add things, so older code still runs on it. If an update damaged data, restore the backup taken just before it (next section).

## Put a backup back (restore)

```sh
sh /opt/retail-erp/app/deploy/restore-check.sh                     # practice: prove the backup is good; the live database is not touched
bash /opt/retail-erp/app/deploy/restore.sh /var/backups/retail-erp/<file>.dump   # the real thing
```

`restore.sh` first backs up the database as it is, restores into a separate database in one go (a failed restore changes nothing), swaps it in, and keeps the old one as `<name>_before_<date>`. Everything typed into the system after that backup is lost, so tell the shops which hour they must re-enter.

Practise `restore-check.sh` once a month. It was last done in audit 12 (30 October 2026).

## A new server from nothing

Follow `deploy/README.md` "First time", then restore the newest backup with `restore.sh` and run `deploy/limit-db-role.sh` as it says. Backups kept on another machine are the only way back if this server is lost (see `docs/audit/12-live-server.md`).

## Updating to a new version

As in `deploy/README.md`: record the sites, `deploy/backup.sh`, `git pull`, build and `up -d`, then check health, check that `/.git/HEAD` and `/.env` return 404, and that every other site on the server answers as before.

## Speed

`sh /opt/retail-erp/app/deploy/speed-check.sh` times 20 tills saving bills at once, in a throwaway copy (no live data). Run it before a busy season or when shops say billing is slow.

## Rules for this server

From the owner's server rules:
- No `apt upgrade`.
- Never touch another project's files, containers or certificates.
- Back up a file before editing it (`.bak-YYYYMMDD`).
- For Nginx, always `nginx -t`, then `systemctl reload nginx`, never a restart.
- New ports only on `127.0.0.1`.
