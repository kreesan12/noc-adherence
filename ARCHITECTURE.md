# Architecture

## Current Production Topology

### Retired Product Areas

- The legacy ROC/MNT appointments module and technician mobile appointment flow were retired from the active frontend and API runtime on `2026-08-06`.
- The related database tables may still exist for historical reference, but the routes, screens, and helper code are no longer wired into production.

### Frontend

- Host: xneelo cloud instance `noc-api-01`
- URL:
  - `https://154-65-108-106.sslip.io`
- Served by:
  - `nginx`
- Static web root:
  - `/var/www/noc-adherence/current`
- Deploy helper:
  - `/home/ubuntu/bin/update-noc-api.sh`
- Production API base URL is defined in:
  - [frontend/src/api/index.js](C:\Users\Kreesan Govender\OneDrive - Frogfoot Networks\Desktop\Web dev scripts\noc-adherence\frontend\src\api\index.js)

### API

- Host: xneelo cloud instance `noc-api-01`
- Public IPv4: `154.65.108.106`
- HTTPS hostname:
  - `154-65-108-106.sslip.io`
- Public API base URL:
  - `https://154-65-108-106.sslip.io/api`
- Service manager: `systemd`
- Service name:
  - `noc-api`
- Reverse proxy:
  - `nginx`
- TLS:
  - Let's Encrypt via `certbot`

### Background Automation

- Host: xneelo cloud instance `noc-automation-01`
- Public IPv4: `154.65.102.21`
- Service manager: `systemd`
- Primary runtime service:
  - `noc-automation`
- Responsibilities:
  - WhatsApp connection
  - NLD watcher
  - Backhaul watcher
  - Major outage watcher
  - VIP watcher
  - queued watcher test dispatches
  - Gmail-driven import jobs through systemd timers
- Runtime behavior:
  - watcher timing, routing groups, tags, and alert wording are now read from shared database config
  - config changes are applied on the next poll cycle without restarting `noc-automation`

### Database

- Host: local PostgreSQL on `noc-api-01`
- PostgreSQL version:
  - `17.10`
- Database name:
  - `noc_adherence`
- Application role:
  - `noc_app`
- PostgreSQL data path:
  - `/srv/postgresql/17/main`
- Attached dedicated data volume:
  - `/srv/postgresql`
- Current usage snapshot on `2026-08-06`:
  - volume size `30G`
  - used `5.6G`
  - free `23G`
- WhatsApp watcher support tables:
  - `automation_settings`
    - stores admin-edited watcher config
  - `watcher_alert_log`
    - stores persistent dedupe keys for sent watcher alerts so restarts do not replay old messages
  - `watcher_dispatch_request`
    - stores queued admin-triggered test messages that the automation host drains and sends through the live WhatsApp session
  - `whatsapp_group_directory`
    - stores the latest joined WhatsApp groups discovered from the automation session so admins can search names and apply valid group JIDs without guessing

### Inter-Server Database Connectivity

- The API server connects directly to local PostgreSQL on `127.0.0.1:5432`
- The automation server connects through a persistent SSH tunnel:
  - service:
    - `noc-db-tunnel`
  - local automation endpoint:
    - `127.0.0.1:15432`
  - target:
    - `127.0.0.1:5432` on `noc-api-01`

### Heroku Status

- Heroku was fully retired for `noc-adherence` on `2026-08-06`.
- The user took a final backup before decommissioning.
- There are no active Heroku dependencies left for:
  - web API hosting
  - scheduled jobs
  - live database traffic
  - frontend hosting

## Server Layout

### `noc-api-01`

- OS:
  - Ubuntu 24.04
- Main app path:
  - `/home/ubuntu/apps/noc-adherence/server`
- Update helper:
  - `/home/ubuntu/bin/update-noc-api.sh`
- Version-controlled helper source:
  - [ops/xneelo/update-noc-api.sh](C:\Users\Kreesan Govender\OneDrive - Frogfoot Networks\Desktop\Web dev scripts\noc-adherence\ops\xneelo\update-noc-api.sh)
- Version-controlled nginx site config:
  - [ops/xneelo/nginx/noc-api.conf](C:\Users\Kreesan Govender\OneDrive - Frogfoot Networks\Desktop\Web dev scripts\noc-adherence\ops\xneelo\nginx\noc-api.conf)
- Supporting services:
  - `nginx`
  - `postgresql`
  - `noc-api`
  - `noc-db-backup.timer`

### `noc-automation-01`

- OS:
  - Ubuntu 24.04
- Main app path:
  - `/home/ubuntu/apps/noc-adherence/server`
- Update helper:
  - `/home/ubuntu/bin/update-noc-automation.sh`
- Supporting services:
  - `noc-automation`
  - `noc-db-tunnel`
  - `noc-import-nld-tracking.timer`
  - `noc-ingest-daily-light.timer`
  - `noc-ingest-stock-status.timer`

## Runtime Services

### API Service

- Unit:
  - `noc-api.service`
- Start command:
  - `/usr/bin/node /home/ubuntu/apps/noc-adherence/server/index.js`

Common commands:

```bash
sudo systemctl status noc-api
sudo systemctl restart noc-api
sudo journalctl -u noc-api -f
```

### Automation Service

- Unit:
  - `noc-automation.service`
- Start command:
  - `/usr/bin/node /home/ubuntu/apps/noc-adherence/server/scripts/startBackgroundAutomation.js`

Common commands:

```bash
sudo systemctl status noc-automation
sudo systemctl restart noc-automation
sudo journalctl -u noc-automation -f
```

### WhatsApp Watcher Administration

- Frontend admin screen:
  - `/settings/whatsapp-watchers`
- Access:
  - admin-only
- Purpose:
  - edit watcher enable flags
  - change poll intervals and lookback windows
  - set one or more WhatsApp group JID targets per watcher
  - set one or more WhatsApp user JIDs to mention per watcher
  - update Zendesk tag rules
  - adjust alert titles, reasons, and action lines
  - queue manual route-test messages per watcher
- Live group discovery:
  - automation periodically syncs joined WhatsApp groups into the database
  - the admin page exposes a searchable group directory with copy/apply actions for each watcher
  - synced group rows now also retain participant JIDs so admins can copy member IDs for watcher mention targeting
- Current watcher lanes:
  - NLD outage watcher
  - backhaul watcher
  - major outage watcher for non-NLD `Outage Capturing` tickets
  - VIP watcher
- Current note:
  - template editing currently controls the title/reason/action language while keeping the message body layout standardized for readability in group chats

### Database Tunnel Service

- Unit:
  - `noc-db-tunnel.service`
- Purpose:
  - keeps `15432` on `noc-automation-01` forwarded to PostgreSQL on `noc-api-01`

Common commands:

```bash
sudo systemctl status noc-db-tunnel
sudo systemctl restart noc-db-tunnel
sudo journalctl -u noc-db-tunnel -f
```

## Scheduled Jobs

These now run on `noc-automation-01` via `systemd` timers.

### NLD Tracking Import

- Timer:
  - `noc-import-nld-tracking.timer`
- Service:
  - `noc-import-nld-tracking.service`
- Schedule:
  - daily `05:10` SAST

### Daily Light-Level Ingest

- Timer:
  - `noc-ingest-daily-light.timer`
- Service:
  - `noc-ingest-daily-light.service`
- Schedule:
  - daily `07:10` SAST

### Stock Status Ingest

- Timer:
  - `noc-ingest-stock-status.timer`
- Service:
  - `noc-ingest-stock-status.service`
- Schedule:
  - daily `07:20` SAST

### Database Backup

- Host:
  - `noc-api-01`
- Timer:
  - `noc-db-backup.timer`
- Service:
  - `noc-db-backup.service`
- Schedule:
  - daily `02:30` SAST
- Script:
  - `/usr/local/bin/backup-noc-db.sh`
- Output folder:
  - `/srv/postgresql/backups/nightly`
- Retention:
  - dumps older than 14 days are deleted automatically

## Environment Notes

Environment files are not committed.

Reference examples:

- [server/.env.example](C:\Users\Kreesan Govender\OneDrive - Frogfoot Networks\Desktop\Web dev scripts\noc-adherence\server\.env.example)
- [server/prisma/.env.example](C:\Users\Kreesan Govender\OneDrive - Frogfoot Networks\Desktop\Web dev scripts\noc-adherence\server\prisma\.env.example)

Important notes:

- secrets must live in server-side env files or systemd environment files, not in the repo
- the frontend no longer needs a Google Maps browser key because the current NLD map uses Leaflet tiles
- if a Google Maps key was previously created for GitHub Pages, treat it as legacy and rotate or delete it in Google Cloud if it is no longer required

### API env on `noc-api-01`

Expected variables include at least:

- `NODE_ENV=production`
- `PORT=4000`
- `CLIENT_ORIGIN`
- `DATABASE_URL`
- `JWT_SECRET`
- `ENABLE_WEB_WHATSAPP=0`
- `DISABLE_BACKGROUND_WATCHERS=1`

### Automation env on `noc-automation-01`

Expected variables include at least:

- `NODE_ENV=production`
- `DATABASE_URL`
- `CLIENT_ID`
- `CLIENT_SECRET`
- `REFRESH_TOKEN`
- `ZENDESK_SUBDOMAIN`
- `ZENDESK_EMAIL`
- `ZENDESK_API_TOKEN`
- `WHATSAPP_VIP_GROUP_ID`
- `DEFAULT_WHATSAPP_MSG`
- `WHATSAPP_SESSION_ID=noc-automation-01`

## Security and Network

### xneelo Security Group Requirements for API

- inbound TCP `22`
- inbound TCP `80`
- inbound TCP `443`
- IPv6 equivalents if public IPv6 access is required

### Ubuntu Firewall

- `noc-api-01`
  - `OpenSSH`
  - `80/tcp`
  - `443/tcp`
- `noc-automation-01`
  - `OpenSSH`

## DBeaver Access

The recommended connection method is SSH tunneling directly to `noc-api-01`.

Use:

- SSH host:
  - `154.65.108.106`
- SSH user:
  - `ubuntu`
- SSH key:
  - your xneelo PEM key
- Database host:
  - `127.0.0.1`
- Database port:
  - `5432`
- Database:
  - `noc_adherence`
- Username:
  - `noc_app`
- Password:
  - stored in the production env and local runbook

This avoids exposing PostgreSQL publicly to the internet.

## GitHub Actions

### Backend

- the old Heroku backend deploy workflow is legacy-only
- file:
  - `.github/workflows/deploy-backend.yml`
- current preferred backend deploy path is:
  - push source to Git
  - run update helpers on xneelo

## Current Capacity Snapshot

### `noc-api-01` on `2026-08-06`

- memory:
  - total `1.9Gi`
  - used `660Mi`
  - available `1.3Gi`
- root disk:
  - `8.7G` total
  - `5.5G` used
  - `3.2G` free
- postgres volume:
  - `30G` total
  - `5.6G` used
  - `23G` free

### `noc-automation-01` on `2026-08-06`

- memory:
  - total `1.9Gi`
  - used `477Mi`
  - available `1.5Gi`
- root disk:
  - `8.7G` total
  - `5.2G` used
  - `3.5G` free

## Suggested Next Improvements

- replace `sslip.io` with a branded DNS hostname when the paid domain is ready
- add a proper SSH-based or artifact-based backend deploy workflow for xneelo
- add database monitoring and alerting around disk, backups, and connection counts
