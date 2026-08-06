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

### Frontend Hosting Move

- Retired GitHub Pages as the live frontend host.
- Switched the frontend build to root-path hosting so the app can run directly from:
  - `https://154-65-108-106.sslip.io`
- Switched the frontend API client default to same-origin:
  - `/api`
- Added version-controlled xneelo deployment assets:
  - `ops/xneelo/nginx/noc-api.conf`
  - `ops/xneelo/update-noc-api.sh`
- Updated the API server deployment helper to become the single cutover path for:
  - frontend build and publish
  - backend install and migrations
  - nginx reload
- Deleted the retired frontend GitHub Pages workflow so the repo no longer carries a stale frontend deployment path.
- Removed the unused frontend Google Maps loader path and its browser-key requirement because the active NLD map uses Leaflet instead.

### Security Hardening

- Removed the insecure fallback JWT secret from the auth route. The API now requires `JWT_SECRET` to be present explicitly.
- Added a server env example file to document expected production variables without storing real secrets in the repo.
- Expanded `.gitignore` for local certs, PEM files, and local xneelo/Heroku helper folders so sensitive local material is less likely to be committed by accident.

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

### UI Refresh Wave Two

- Added a reusable compact page scaffold for the refreshed frontend shell:
  - `PageShell`
  - `SectionCard`
  - `FilterStrip`
- Reworked the left navigation ordering so `User Admin` is easier to discover for admin users inside the `SETTINGS` section.
- Refreshed the following pages to use the tighter shared shell and more consistent layout patterns:
  - `Adherence`
  - `Agents`
  - `Workforce`
  - `Schedule`
  - `Staffing`
  - `Managers`
  - `Leave Planner`
  - `Volume`
  - `Overtime Capture`
  - `Overtime Supervisor`
  - `Overtime Manager`
  - `Signature`
- Reworked older overtime pages to use the shared overtime API helpers instead of stale direct endpoint strings.
- Fixed the signature page to use the current authenticated user context and the live `/api/overtime/signature/me` endpoint instead of the legacy browser-side shortcut logic.

### Navigation And Access Refresh

- Added a new workspace landing dashboard at `/` so users now land on a central launcher instead of dropping directly into one feature area.
- Moved the Adherence page onto its own route:
  - `/adherence`
- Added collapsible hide/show behavior for the left navigation so users can reclaim horizontal space on data-heavy screens.
- Centralized frontend access helpers so admin access now inherits engineering-capable UI actions consistently.
- Refreshed `NLD Mapping` onto the shared shell and aligned its edit behavior with backend engineering/admin permissions.
- Confirmed `noc-adherence` Heroku runtime and database decommission after final backup.

### UI Refresh Wave Three

- Refreshed `NLD Map` onto the shared page shell with tighter filters, a cleaner explorer panel, and a more responsive map/details split.
- Refreshed `Circuit Data Cleanup` onto the shared page shell with better grouping controls, search, summary metrics, and a more consistent admin editing layout.

### UI Refresh Wave Four

- Refreshed `Stock Management` onto the shared page shell while keeping its stock-specific analytics and workflow tabs intact.
- Refreshed `SLA Reporting` onto the shared page shell and aligned its top-level controls with the newer workspace pattern.
- Added lightweight frontend governance docs for future work:
  - `docs/UI_STANDARDS.md`
  - `docs/BUILD_RULES.md`

### UI Refresh Wave Five

- Renamed the shared frontend shell branding from the older NOC-only naming to:
  - `Frogfoot Ops Hub`
- Centralized shell/login/landing branding copy in:
  - `frontend/src/config/brand.js`
- Reworked the login screen into a cleaner two-panel sign-in layout so the landing experience feels like the same platform as the authenticated shell.
- Added shared analytics UI primitives in:
  - `frontend/src/components/ui/AnalyticsPrimitives.jsx`
- Moved more shared dashboard UI onto reusable primitives across:
  - `Stock Management`
  - `SLA Reporting`
  - `User Admin`
- Lazy-loaded the major SLA sub-tabs so the reporting route does not pull every chart-heavy panel on first open.
- Added explicit Vite manual chunking for:
  - React/router
  - MUI core
  - MUI grid/date packages
  - Recharts
  - Leaflet
  - Day.js
  - XLSX
- Switched browser-side Excel helpers on older pages to on-demand `xlsx` loading during export actions instead of route load.
- Refreshed `User Admin` onto the shared shell with:
  - `PageShell`
  - shared filters
  - shared metric cards
  - clearer directory panel structure
- Expanded the login landing into a full-width unified entry canvas so the sign-in experience uses the page space more intentionally and feels consistent with the upgraded shell.
- Hardened the frontend bootstrap so production startup failures no longer disappear into a blank screen; the app now renders a visible fallback with the startup error when the main bundle crashes during load.
- Simplified the Vite vendor chunk strategy to avoid the MUI production runtime error that was blanking the live frontend after build.
- Added a browser smoke harness for post-build checks:
  - `npm run smoke`
  - `npm run smoke:local-build`
- Added a release checklist in:
  - `docs/RELEASE_CHECKLIST.md`
- Removed the extra top accent strip from the login card so the sign-in panel reads cleaner and does not visually overlap the surface above it.

### ROC And MNT Retirement

- Removed the legacy ROC/MNT appointments frontend section from the main navigation.
- Removed the retired ROC appointments and technician mobile frontend pages, APIs, helpers, and theme files.
- Removed the retired ROC/tech backend route wiring and the old ROC/MNT seed script from the active codebase.
- Left unrelated `MNT` references in workload and automation reporting intact where they represent maintenance volume data rather than the retired ROC/MNT appointments feature.
