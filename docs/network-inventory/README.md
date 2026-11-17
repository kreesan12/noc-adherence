# Network Inventory

Independent inventory/review module inside NOC Adherence. The four working sections are
Ladder Audits, OLT Audits, NLD Audits and RISE Audits. There is no AI/prompting,
device runner, SSH/SNMP integration or configuration-change capability.

## Data and provenance

The initial workbook is `2. Network Links DB (1).xlsx`. The importer reads Node DB,
DC DB, Backhauls DB, Ladder DB, OLT DB and OLT Mapping. Empty formatted rows are
ignored. Every populated source row is retained with sheet, Excel row number and
import identity. Original import claims and change history remain available in the
record inspector after corrections and subsequent imports.

The workbook yields 540 Node DB sites plus three DC sites, 1,121 devices, 48
normalised ladders, 452 Ladder DB membership rows plus 96 Node DB-only membership
claims, 415 backhauls, 541 ordered physical circuit segments and 355 OLT attachments.
Counts are inventory claims, not assertions of network health.

Only obvious ladder case/space/hyphen variants are merged. Slash-labelled ladders
remain distinct. Hostnames and unique exact site aliases can resolve endpoints;
fuzzy hostname guessing is not used. Conflicting or unresolved claims remain visible.
Node/site membership in multiple ladders is supported and informational. Explicit
Core_Pri/Core_Sec router references also associate their physical sites with the
corresponding ladders even when no standalone Core membership row exists.

RISE has no explicit classification in this workbook. The complete RISE section
supports assigning existing ladders/backhauls or adding records; no membership is
invented. NLD includes explicitly NLD-labelled ladders/backhauls and manual scope
assignments. Each scope supports tables, topology, editing, findings and review.

## Routing visuals

- Default selection is BFN Ladder 1, using an interactive SVG ring with a ladder
  layout alternative, zoom/pan, device/link selection and SVG export.
- Transport and protection are separate. EAPS/ERPS roles and control VLANs are
  retained. Legacy VPLS remains visible but its protection/path workflow is pending.
- Core routers come from the membership rows' primary/secondary router fields,
  rather than requiring a separate Core row. A device can have both core and
  transit associations; those source claims are retained.
- A Master/RPL Owner's `ring_block=Y` marks its **secondary** backhaul blocked in
  normal operation. Blank block fields remain unknown. Non-owner block claims
  and incomplete protection data produce review findings/provisional warnings.
- Intended primary routing starts on the selected node's declared primary
  backhaul toward its own Core_Pri. Subsequent explicit primary declarations are
  preferred. Unresolved/conflicting endpoints cannot silently complete a path.
- The backup scenario removes the source's primary outgoing link and releases
  the normal secondary block, then seeks Core_Sec. The UI explicitly labels this
  a scenario; it is not live traffic or a claim that protection has been tested.
- Backhaul capacity is reported capacity, not measured utilisation. Physical
  component circuits are an ordered chain; repeated provider IDs remain separate
  occurrences. Chain gaps and suspicious capacities are findings, not auto-fixes.

## Editing, permissions and sign-off

All authenticated application users can view/export. Roles `admin`, `manager`
and `engineering` can edit, import, acknowledge findings and sign off.

Edits require a note and the record version. Stale concurrent edits return 409.
Archiving is reversible and retained in history; related missing-reference findings
prevent orphaned records from silently passing review.

Every ladder starts **not up to date**. Manual sign-off requires a review note and
resolution or explicit acknowledgement of relevant findings. Device verification
remains **not performed**. Sign-offs fingerprint the subject and dependencies;
related edits invalidate them. Changed finding evidence reopens acknowledgements.

Imports always have a preview. Existing manual edits and current signed-off values
(including reviewed dependencies) are preserved unless individually selected for
replacement with an explanatory note. Records absent from a new file are retained.
Concurrent changes after preview require a fresh preview. Excel exports include
human-readable tables, findings/sign-offs and a re-importable Inventory records sheet.

## Storage and setup

The additive migration is `server/migrations/network-inventory/001_inventory.sql`.
All new tables are inside PostgreSQL schema `network_inventory`:
`sites`, `devices`, `ladders`, `memberships`, `backhauls`, `segments`, `olts`,
`imports`, `source_rows`, `changes`, `reviews`, `issue_reviews`, `state`.

Entity data is stored in typed entity tables with JSONB source attributes, stable
record IDs, versions and source references. Relationship claims can be unresolved
because finding/correcting those gaps is the purpose of this module. Existing
operational Node/Circuit/NLD tables are neither reused nor modified.

`NETWORK_INVENTORY_DATABASE_URL` optionally selects another PostgreSQL database.
If omitted, the normal application DATABASE_URL is used with the isolated schema.
Only the additive module migration runs; unrelated Prisma migrations do not run.

From `server`:

```powershell
node scripts/networkInventory.js analyse 'path\Network Links DB.xlsx'
node scripts/networkInventory.js setup
node scripts/networkInventory.js import 'path\Network Links DB.xlsx'
```

The UI can perform the initial import instead. The CLI import refuses to replace
existing manual/reviewed conflicts; use the UI preview to choose those explicitly.

The local review setup uses PostgreSQL at 127.0.0.1:55439 in
`.artifacts/network-inventory-pg`, database `network_inventory_dev`, API port 4107
and Vite port 5177. This database uses loopback-only test authentication and is
not a production database. The preview uses the application's normal JWT/login
flow; it has no authentication bypass. The separate login database must be
reachable through the normal development tunnel.

```powershell
# server terminal
$env:NETWORK_INVENTORY_DATABASE_URL='postgresql://inventory_dev@127.0.0.1:55439/network_inventory_dev'
node scripts/previewNetworkInventory.js
# frontend terminal
$env:VITE_DEV_API_TARGET='http://127.0.0.1:4107'
npm run dev -- --host 127.0.0.1 --port 5177
```

## Checks

```powershell
# server; integration tests create/drop only their own generated test database
$env:NETWORK_INVENTORY_TEST_ADMIN_URL='postgresql://inventory_dev@127.0.0.1:55439/postgres'
node --test tests/networkInventory.test.js tests/networkInventory.integration.test.js
node scripts/smokeNetworkInventory.js
# frontend
npm run build
```

The browser smoke test uses a test-only signed identity in an isolated browser
context against the local inventory database. It checks BFN core/block rendering,
both traffic scenarios, inspector/editor, all four sections, import preview, Excel
export and mobile overflow. Screenshots are in `.artifacts/network-inventory`.

## Deployment

The module is wired into the normal app API and navigation at
`/api/network-inventory` and `/network-inventory/:scope`.
Deployed on 17 November 2026 at
`https://154-65-108-106.sslip.io/network-inventory/ladder`, with the full workbook
imported into the production database's isolated schema. All 48 ladder topology
datasets and all four sections passed authenticated live checks. Every ladder
remains not up to date until manually reviewed; no device verification was run.

The narrow release helper is `scripts/deploy-network-inventory.mjs`; it backs up
the existing application wiring/static frontend, deploys only this feature, runs
only its additive schema setup/import, and restarts only the API service. The
verification helper is `scripts/verify-network-inventory-production.mjs`.
Subsequent workbook updates should use the UI import preview to preserve existing
manual edits/sign-offs. The source workbook does not need a fixed server path.
