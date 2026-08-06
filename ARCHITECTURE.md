# Architecture

## Current Production Topology

### Frontend

- Host: GitHub Pages
- URL: `https://kreesan12.github.io/noc-adherence`
- Deploy path: `.github/workflows/deploy-frontend.yml`
- Production API base URL in code:
  - [frontend/src/api/index.js](C:\Users\Kreesan%20Govender\OneDrive%20-%20Frogfoot%20Networks\Desktop\Web%20dev%20scripts\noc-adherence\frontend\src\api\index.js)

### API

- Host: xneelo cloud instance `noc-api-01`
- Public IPv4: `154.65.108.106`
- HTTPS hostname: `154-65-108-106.sslip.io`
- Public API base URL:
  - `https://154-65-108-106.sslip.io/api`
- Service manager: `systemd`
- Service name: `noc-api`
- Reverse proxy: `nginx`
- TLS: Let's Encrypt via `certbot`

### Background Automation

- Host: xneelo cloud instance `noc-automation-01`
- Public IPv4: `154.65.102.21`
- Service manager: `systemd`
- Service name: `noc-automation`
- Runtime entry:
  - [server/scripts/startBackgroundAutomation.js](C:\Users\Kreesan%20Govender\OneDrive%20-%20Frogfoot%20Networks\Desktop\Web%20dev%20scripts\noc-adherence\server\scripts\startBackgroundAutomation.js)
- Responsibilities:
  - WhatsApp connection
  - NLD watcher
  - VIP watcher

### Database

- Current database remains the existing managed Postgres instance referenced by `DATABASE_URL`
- At the moment this is still the long-lived hosted database used by the app
- API and automation both connect to the same database

## Server Layout

### `noc-api-01`

- OS: Ubuntu 24.04
- Key components:
  - `node` 20.x
  - `nginx`
  - `certbot`
  - `ufw`
  - `fail2ban`
- App path:
  - `/home/ubuntu/apps/noc-adherence/server`
- Update helper:
  - `/home/ubuntu/bin/update-noc-api.sh`

### `noc-automation-01`

- OS: Ubuntu 24.04
- Key components:
  - `node` 20.x
  - `ufw`
  - `fail2ban`
- App path:
  - `/home/ubuntu/apps/noc-adherence/server`
- Update helper:
  - `/home/ubuntu/bin/update-noc-automation.sh`

## Runtime Services

### API Service

- Unit: `noc-api.service`
- Start command:
  - `/usr/bin/node /home/ubuntu/apps/noc-adherence/server/index.js`

Common commands:

```bash
sudo systemctl status noc-api
sudo systemctl restart noc-api
sudo journalctl -u noc-api -f
```

### Automation Service

- Unit: `noc-automation.service`
- Start command:
  - `/usr/bin/node /home/ubuntu/apps/noc-adherence/server/scripts/startBackgroundAutomation.js`

Common commands:

```bash
sudo systemctl status noc-automation
sudo systemctl restart noc-automation
sudo journalctl -u noc-automation -f
```

## Security / Network

### xneelo Security Group Requirements for API

- Inbound TCP `22`
- Inbound TCP `80`
- Inbound TCP `443`
- IPv6 equivalents if public IPv6 access is required

### Ubuntu Firewall

- `noc-api-01`
  - `OpenSSH`
  - `80/tcp`
  - `443/tcp`
- `noc-automation-01`
  - `OpenSSH`

## GitHub Actions

### Frontend

- Auto deploys on pushes affecting:
  - `frontend/**`
  - `.github/workflows/deploy-frontend.yml`

### Backend

- The old Heroku backend deploy workflow is now manual-only
- File:
  - `.github/workflows/deploy-backend.yml`
- Purpose:
  - legacy rollback path only

## Environment Notes

Environment files are not committed.

Production API env on `noc-api-01` includes at least:

- `NODE_ENV=production`
- `PORT=4000`
- `CLIENT_ORIGIN`
- `DATABASE_URL`
- `JWT_SECRET`
- `ENABLE_WEB_WHATSAPP=0`
- `DISABLE_BACKGROUND_WATCHERS=1`

Production automation env on `noc-automation-01` includes at least:

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

## Future Paid Domain Options

Using one paid domain for both frontend and API is completely fine.

Recommended patterns:

### Option A: Same registered domain, separate subdomains

- Frontend:
  - `noc.yourdomain.co.za`
- API:
  - `api.yourdomain.co.za`

This is the cleanest option while the frontend remains on GitHub Pages.

### Option B: Same registered domain, root + API subdomain

- Frontend:
  - `yourdomain.co.za`
- API:
  - `api.yourdomain.co.za`

Also clean and common.

### Option C: Single host + `/api` path on one server

- Frontend:
  - `yourdomain.co.za`
- API:
  - `yourdomain.co.za/api`

This works best if the frontend is later moved off GitHub Pages and served from xneelo or another web server under your control.

## Suggested Next Improvements

- Move frontend off GitHub Pages if you want one-host routing under a single server later
- Replace `sslip.io` with a proper branded DNS hostname when ready
- Add CI/CD deploy to xneelo via SSH or artifact-based release flow
- Review WhatsApp reconnect behavior after the new dedicated session settles
