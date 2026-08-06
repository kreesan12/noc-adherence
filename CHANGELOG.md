# Changelog

## 2026-08-06

- Provisioned two xneelo Ubuntu 24.04 servers:
  - `noc-api-01` (`154.65.108.106`)
  - `noc-automation-01` (`154.65.102.21`)
- Added baseline server setup on both hosts:
  - `Africa/Johannesburg` timezone
  - 2 GB swap
  - security updates
  - UFW / fail2ban
- Installed Node.js 20 LTS on both xneelo servers.
- Moved the production API runtime from Heroku web hosting to xneelo:
  - API app runs via `systemd` service `noc-api`
  - Nginx reverse proxy added on `noc-api-01`
- Enabled public HTTPS for the API using Let's Encrypt on the free hostname:
  - `https://154-65-108-106.sslip.io`
- Updated the frontend production API target to `https://154-65-108-106.sslip.io/api`.
- Fixed the background automation bootstrap so environment variables load before WhatsApp and watcher modules initialize.
- Moved WhatsApp / watcher automation to `noc-automation-01` as a separate `systemd` service:
  - service name: `noc-automation`
  - dedicated session id: `noc-automation-01`
- Rotated the stored WhatsApp session and re-linked automation to the new dedicated session.
- Added server-side update helper scripts:
  - `/home/ubuntu/bin/update-noc-api.sh`
  - `/home/ubuntu/bin/update-noc-automation.sh`
- Changed the old Heroku backend GitHub Action to manual-only so normal pushes no longer deploy the backend to Heroku automatically.
- Added architecture documentation for the current xneelo / GitHub Pages / database layout.
