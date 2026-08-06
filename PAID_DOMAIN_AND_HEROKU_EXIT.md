# Paid Domain And Heroku Exit

## Current State As Of August 6, 2026

- Frontend:
  - xneelo on `noc-api-01`
  - `https://154-65-108-106.sslip.io`
- API:
  - xneelo server `noc-api-01`
  - `https://154-65-108-106.sslip.io/api`
- Automation:
  - xneelo server `noc-automation-01`
  - WhatsApp and watcher services run here
- Database:
  - local PostgreSQL 17 on `noc-api-01`
- Scheduling:
  - moved to xneelo `systemd` timers
- Heroku:
  - fully decommissioned for `noc-adherence` after final backup

## What Is Already Off Heroku

- web API runtime
- background automation runtime
- HTTPS termination for the API
- live production database traffic
- scheduled jobs

## Heroku Decommission Status

Completed for `noc-adherence`:

1. final backup taken
2. Heroku Postgres removed
3. Heroku app removed
4. Heroku Scheduler already removed earlier in the migration

## Paid Domain Move

Using one paid domain for both frontend and API is completely fine.

Recommended target shape:

- frontend:
  - `noc.yourdomain.co.za`
- API:
  - `api.yourdomain.co.za`

This is the cleanest route now that both frontend and API already live on xneelo.

## Paid Domain Implementation Steps

### Step 1: Buy The Domain

- purchase the domain from your preferred registrar
- make sure DNS is fully editable

### Step 2: Create DNS Records

For the API on xneelo:

- add `A` record:
  - `api.yourdomain.co.za -> 154.65.108.106`
- add `AAAA` record if you want IPv6:
  - point to the API server IPv6 address

For the frontend on xneelo:

- add `A` record:
  - `noc.yourdomain.co.za -> 154.65.108.106`
- add `AAAA` record if you want IPv6:
  - point to the API/frontend server IPv6 address

### Step 3: Update Nginx On `noc-api-01`

- change the nginx `server_name` from `154-65-108-106.sslip.io` to `api.yourdomain.co.za`
- request a new certificate:

```bash
sudo certbot --nginx -d api.yourdomain.co.za
```

### Step 4: Update Frontend/API Hostnames

If you keep same-origin frontend and API routing through nginx, you do not need to hardcode a full API hostname in the frontend.

Instead update:

- nginx `server_name`
- TLS certificate
- `CLIENT_ORIGIN`

### Step 5: Update CORS

On the API env, set `CLIENT_ORIGIN` to the final frontend domain.

Examples:

- `https://noc.yourdomain.co.za`
- `https://yourdomain.co.za`

### Step 6: Validate

Check all of these after cutover:

- login works
- CORS preflight succeeds
- stock pages load
- SLA pages load
- WhatsApp watcher still runs
- Gmail ingestion still works
- DBeaver can still connect by SSH tunnel

## If You Want One Host Instead Of Two

The cleanest path is already the current shape:

1. serve the frontend from xneelo
2. proxy `/api` through nginx on the same domain
3. move from `sslip.io` to your paid domain when ready

That gives you:

- `https://yourdomain.co.za`
- `https://yourdomain.co.za/api`

## Current xneelo-First Operations Model

### Active Schedulers

- `noc-import-nld-tracking.timer`
- `noc-ingest-daily-light.timer`
- `noc-ingest-stock-status.timer`
- `noc-db-backup.timer`

### Active Database Model

- PostgreSQL is local to `noc-api-01`
- automation reaches it through `noc-db-tunnel`
- database backups land in:
  - `/srv/postgresql/backups/nightly`

## Recommended Next Steps

1. monitor xneelo backups and daily timers for a few days
2. move from `sslip.io` to the paid domain when ready
3. add lightweight monitoring around disk, memory, and PostgreSQL connections
