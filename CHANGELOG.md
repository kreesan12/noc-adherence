# Changelog

## 2026-08-06

### Platform Move

- Provisioned two xneelo Ubuntu 24.04 servers:
  - `noc-api-01` (`154.65.108.106`)
  - `noc-automation-01` (`154.65.102.21`)
- Added baseline server setup on both hosts:
  - `Africa/Johannesburg` timezone
  - swap
  - security updates
  - UFW
  - fail2ban
- Installed Node.js 20 LTS on both xneelo servers.
- Moved the production API runtime from Heroku web hosting to xneelo:
  - API app now runs via `systemd` service `noc-api`
  - nginx reverse proxy added on `noc-api-01`
- Enabled public HTTPS for the API using Let's Encrypt on:
  - `https://154-65-108-106.sslip.io`
- Updated the frontend production API target to:
  - `https://154-65-108-106.sslip.io/api`
- Moved WhatsApp and watcher automation to `noc-automation-01` as a separate `systemd` service:
  - `noc-automation`
- Rotated the WhatsApp session and re-linked automation to the new dedicated server session.
- Added server-side update helper scripts:
  - `/home/ubuntu/bin/update-noc-api.sh`
  - `/home/ubuntu/bin/update-noc-automation.sh`

### Database And Scheduling

- Attached and mounted a dedicated 30 GB PostgreSQL volume on `noc-api-01` at:
  - `/srv/postgresql`
- Installed PostgreSQL 17 locally on `noc-api-01`.
- Created the production application database on xneelo:
  - database: `noc_adherence`
- Migrated production data off live Heroku traffic and onto the local xneelo PostgreSQL instance.
- Repointed the API service to the local database.
- Repointed the automation service to the local database through an SSH tunnel.
- Added persistent database tunnel service on `noc-automation-01`:
  - `noc-db-tunnel`
- Replaced Heroku Scheduler with xneelo `systemd` timers:
  - `noc-import-nld-tracking.timer`
  - `noc-ingest-daily-light.timer`
  - `noc-ingest-stock-status.timer`
- Added nightly PostgreSQL backups on `noc-api-01`:
  - `noc-db-backup.timer`
- Removed Heroku Scheduler from the production app.

### Stability And Maintenance

- Fixed the NLD tracking importer so it no longer hangs when the expected Gmail message for a day is missing.
- Removed the stale PM2 service layer from both xneelo servers so `systemd` is the only active process manager.
- Updated architecture and migration runbooks to reflect the xneelo-first production design.

### Frontend And Auth Refresh

- Refreshed the shared frontend shell with a tighter theme, smaller global sizing, new nav styling, improved background treatment, and a more modern login experience.
- Improved auth hydration so protected routes wait for `/me` on refresh instead of bouncing users back to the login page prematurely.
- Fixed logout token cleanup to clear the API auth header properly.
- Added route-level lazy loading so major app pages no longer ship as one giant initial frontend bundle.

### User Administration

- Added shared backend helpers for login-capable users across supervisor and manager auth tables.
- Added admin-only user management API routes for:
  - listing users
  - creating users
  - updating users
  - resetting passwords
  - deleting users
- Added a new frontend user admin workspace under:
  - `/settings/users`
- Added onboarding and password reset draft generation with copy-ready email content for administrators.
