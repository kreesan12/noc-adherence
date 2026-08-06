# Paid Domain And Heroku Exit

## Current State As Of August 6, 2026

- Frontend:
  - GitHub Pages
  - `https://kreesan12.github.io/noc-adherence`
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
  - no longer active for runtime traffic
  - retained only as rollback safety for the old database copy and app shell

## What Is Already Off Heroku

- web API runtime
- background automation runtime
- HTTPS termination for the API
- live production database traffic
- scheduled jobs

## What Is Still Left On Heroku

These are now rollback-only, not active production dependencies:

- app:
  - `noc-adherence-api`
- database add-on:
  - `heroku-postgresql (postgresql-horizontal-33579)`

Already removed:

- Heroku Scheduler

## Safe Heroku Decommission Order

Once you have validated the xneelo environment for long enough that you are comfortable burning the rollback path, remove Heroku in this order:

1. confirm xneelo backups exist and can be restored
2. confirm both xneelo servers are using the local PostgreSQL database
3. take one final `pg_dump` of the Heroku database for archive purposes
4. delete the Heroku Postgres add-on
5. delete the `noc-adherence-api` Heroku app

## Paid Domain Move

Using one paid domain for both frontend and API is completely fine.

Recommended target shape:

- frontend:
  - `noc.yourdomain.co.za`
- API:
  - `api.yourdomain.co.za`

This is the cleanest route while the frontend remains on GitHub Pages.

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

For the frontend on GitHub Pages:

- either set `noc.yourdomain.co.za` as a `CNAME` to `kreesan12.github.io`
- or later move the frontend onto xneelo and serve it there directly

### Step 3: Update Nginx On `noc-api-01`

- change the nginx `server_name` from `154-65-108-106.sslip.io` to `api.yourdomain.co.za`
- request a new certificate:

```bash
sudo certbot --nginx -d api.yourdomain.co.za
```

### Step 4: Update Frontend API Base

Change:

- [frontend/src/api/index.js](C:\Users\Kreesan Govender\OneDrive - Frogfoot Networks\Desktop\Web dev scripts\noc-adherence\frontend\src\api\index.js)

From:

- `https://154-65-108-106.sslip.io/api`

To:

- `https://api.yourdomain.co.za/api`

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

## If You Later Want One Host Instead Of Two

The cleanest path is:

1. move the frontend off GitHub Pages
2. serve the frontend from xneelo or another web host you control
3. proxy `/api` through nginx on the same domain

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

1. keep Heroku untouched for a short validation period
2. monitor xneelo backups and daily timers for a few days
3. once satisfied, remove the Heroku database and app
4. then move from `sslip.io` to the paid domain
