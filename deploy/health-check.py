#!/usr/bin/env python3
# Copyright (c) 2026, Rademics. All rights reserved.
# Audit 12: run every 5 minutes by /etc/cron.d/retail-erp. Checks that the Retail ERP answers, that its
# database is connected and that last night's backup was made, and emails LEAD_ALERT_TO (from
# deploy/.env) only when something goes wrong or comes back. The server's own site monitor only sees
# that the home page opens, which it still does when the API or the database is down.
import json, os, shutil, smtplib, ssl, time, urllib.request
from email.message import EmailMessage

HERE = os.path.dirname(os.path.abspath(__file__))
STATE = "/var/lib/retail-erp/health-state.json"
BACKUP_MARK = "/var/backups/retail-erp/last-good-backup"
DEFAULT_TO = "editor.publicationmart@gmail.com"


def settings():
    env = {}
    with open(os.path.join(HERE, ".env"), encoding="utf-8-sig") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'").lstrip("﻿")
    return env


def get(url):
    try:
        with urllib.request.urlopen(url, timeout=15) as r:
            return r.status, r.read(4096).decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001 - any failure is "not answering"
        return 0, str(e)


def problems(env):
    out = []
    api_port = env.get("API_HOST_PORT", "4061")
    web_port = env.get("WEB_HOST_PORT", "4060")
    code, body = get(f"http://127.0.0.1:{api_port}/health")
    if code != 200:
        out.append(f"The API is not answering ({code or body[:120]})")
    else:
        try:
            if not json.loads(body).get("database", {}).get("connected"):
                out.append("The API answers but cannot reach its database")
        except ValueError:
            out.append("The API's health answer could not be read")
    code, body = get(f"http://127.0.0.1:{web_port}/login")
    if code != 200:
        out.append(f"The web app is not answering ({code or body[:120]})")
    # The backup runs at 22:30 UTC; more than 26 hours since the last good one means a night was missed.
    try:
        age = (time.time() - os.path.getmtime(BACKUP_MARK)) / 3600
        if age > 26:
            out.append(f"No good backup for {age:.0f} hours (see /var/log/retail-erp-backup.log)")
    except OSError:
        out.append("No good backup has been recorded yet")
    disk = shutil.disk_usage("/var/backups")
    if disk.free / disk.total < 0.10:
        out.append(f"The disk is {100 - disk.free * 100 // disk.total}% full")
    return out


def send(env, subject, text):
    msg = EmailMessage()
    msg["From"] = env.get("MAIL_FROM") or env.get("SMTP_USER")
    msg["To"] = env.get("LEAD_ALERT_TO") or DEFAULT_TO
    msg["Subject"] = subject
    msg.set_content(text)
    port = int(env.get("SMTP_PORT") or 465)
    if port == 465 or env.get("SMTP_SECURE") == "true":
        with smtplib.SMTP_SSL(env["SMTP_HOST"], port, context=ssl.create_default_context(), timeout=30) as s:
            s.login(env["SMTP_USER"], env["SMTP_PASSWORD"])
            s.send_message(msg)
    else:
        with smtplib.SMTP(env["SMTP_HOST"], port, timeout=30) as s:
            s.starttls(context=ssl.create_default_context())
            s.login(env["SMTP_USER"], env["SMTP_PASSWORD"])
            s.send_message(msg)


def main():
    env = settings()
    now = problems(env)
    if now:  # one more look a minute later, so a restart during a deploy is not an alarm
        time.sleep(60)
        now = problems(env)
    try:
        with open(STATE, encoding="utf-8") as f:
            before = json.load(f).get("problems", [])
    except (OSError, ValueError):
        before = []
    stamp = time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime())
    if now != before:
        if now:
            subject, text = "Retail ERP: something is wrong", "Found at " + stamp + ":\n\n- " + "\n- ".join(now)
        else:
            subject, text = "Retail ERP: all well again", "Everything answers again at " + stamp + "."
        text += "\n\nWhat to do: docs/runbook.md in the Retail ERP repository.\nhttps://retailerp.52digit.com"
        try:
            send(env, subject, text)
        except Exception as e:  # noqa: BLE001 - the state is saved only once the mail went out
            print(f"{stamp} mail failed: {e}")
            return
        os.makedirs(os.path.dirname(STATE), mode=0o700, exist_ok=True)
        with open(STATE, "w", encoding="utf-8") as f:
            json.dump({"problems": now, "since": stamp}, f)
    print(f"{stamp} " + ("; ".join(now) if now else "ok"))


if __name__ == "__main__":
    main()
