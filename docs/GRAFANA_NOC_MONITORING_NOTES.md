# Grafana NOC Monitoring Notes

Source export:
- File: `C:/Users/Kreesan Govender/Downloads/NOC Monitoring-1786099911914.json`
- Export date: 2026-08-07
- Format: `dashboard.grafana.app/v2`

High-level shape:
- Dashboard export contains `111` panel elements.
- These map to `117` query entries.
- After removing duplicate panel references and repeated query shapes, there are about `45` unique query definitions.
- Time window defaults to `from=now/d` and `to=now/d`.
- Auto refresh is `1m`.
- One hidden constant variable is present:
  - `WEEKAGO_YMD = ${__to:shift(-7d):date:YYYY-MM-DD}`

Primary datasource families:
1. `https://frogfoot.zendesk.com/api/v2/search.json`
- Count in export: `22`
- Mostly live point-in-time alert and ticket count/status panels.
- Common use cases:
  - open outage / southbound alert counts
  - P1/P2/P3/P4/power alert counts
  - T1/T2 solved counts
  - T2 service type splits
  - aging spotlight panels

2. `https://frogfoot.zendesk.com/api/v2/search/export`
- Count in export: `15`
- Used for larger result sets and richer transforms via Infinity backend parsing.
- Common use cases:
  - T1/T2 base ticket tables
  - outage detail tables
  - backhaul detail tables
  - NLD monitoring tables
  - hourly/cumulative intake charts
  - SLA-style aging and bucket logic on ticket datasets

3. `https://zendesk.api.admin.illation.co.za/api/v1/dashboard/stats`
- Count in export: `9`
- Used for queue-level and extension-level call statistics.
- Common use cases:
  - queue waiting counts
  - answered/missed totals
  - average answer speed
  - agent/extension call status tables

4. `https://frogfoot.zendesk.com/api/v2/skips?sort_order=desc`
- Count in export: `1` main query plus page-2 variant
- Used for skipped ticket visibility.

5. Dashboard references (`-- Dashboard --` / panelId)
- Count in export: `66`
- These are not independent API calls.
- They reuse another panel's result inside Grafana.

Main query families extracted from the export:

1. Outage capturing / southbound / P-priority alert monitor
- Core endpoint: `search.json`
- Common group: `5160847905297`
- Common form: `Outage Capturing`
- Representative queries:
  - `type:ticket status:new group:5160847905297 form:"Outage Capturing" assignee:none`
  - `type:ticket group:5160847905297 assignee:none status:new tags:"temp_alert nam_priority_p1" tags:"network_alert nam_priority_p1"`
  - `type:ticket group:5160847905297 assignee:none status:new tags:"network_alert nam_priority_p2"`
  - `group:5160847905297 status:new tags:"soutbound_alert nam_priority_p3" tags:"network_alert nam_priority_p3"`
  - `type:ticket group:5160847905297 assignee:none status:new tags:"network_alert nam_priority_p4"`
  - `type:ticket group:5160847905297 assignee:none status:new tags:power_alert`

2. Open outages detail table
- Core endpoint: `search/export`
- Query:
  - `group:5160847905297 form:"Outage Capturing" status<solved status>new`
- This table pulls custom fields for:
  - subscriber impact: `5552674828049`
  - outage status: `4419340564625`
  - who's working on it: `6832283279121`
  - type: `14118200804369`
  - DFA ref: `7657855944209`
  - Liquid ref: `7657816716433`
  - Liquid circuit: `8008871186961`

3. Tier 1 ticket monitoring
- Representative queries:
  - `tags:request_type_noc_tier_1 created>=${__from:date} created<=${__to:date} form:"Frogfoot Initial Form"`
  - `group:"NOC Tier1 Support" form:"Frogfoot Initial Form" status<solved`
  - `tags:"request_type_noc_tier_1" form:"Frogfoot Initial Form" created>=${__to:date:YYYY-MM-DD}T00:00:00Z created<=${__to:date:YYYY-MM-DD}T23:59:59Z`
  - `tags:"request_type_noc_tier_1" form:"Frogfoot Initial Form" created>=7daysago created<6daysago`
  - `tags:"request_type_noc_tier_1" form:"Frogfoot Initial Form" created>=14daysago created<13daysago`
- Native rebuild implication:
  - needs a T1 base table or cached API ingest for counts, unsolved base, and hourly intake curves.

4. Tier 2 ticket monitoring
- Representative queries:
  - `assignee:none status:new tags:request_type_noc_tier_2 form:"Frogfoot Initial Form"`
  - `status<solved tags:"request_type_noc_tier_2 handover_ticket_macro" form:"Frogfoot Initial Form" group:5160788553489`
  - `tags:request_type_noc_tier_2 created>=${__from:date} created<=${__to:date} form:"Frogfoot Initial Form" status<closed`
  - `group:"NOC Tier2 Support" form:"Frogfoot Initial Form" status<solved -status:pending`
  - `group:"NOC Tier2 support" form:"Frogfoot Initial Form" status<solved`
  - `group:"NOC Tier2 Support" form:"Frogfoot Initial Form" status<solved -status:pending -status:new created>=${__from:date} created<=${__to:date}`
- Native rebuild implication:
  - needs T2 queue base data with aging, service type, escalation-party, and received/solved aggregates.

5. Backhaul monitoring
- Core endpoint: `search/export`
- Query:
  - `form:"NOC Alert Management" type:ticket group:5160847905297 status:open tags:"iris_backhaul_down"`
- Important custom fields referenced:
  - Liquid ref: `7657816716433`
  - Liquid circuit: `8008871186961`
  - DFA ref: `7657855944209`
  - DFA circuit: `8145005788433`
  - who's working on it: `7456773576081`
  - issue: `7458181781393`
  - side A: `7458118254225`
  - side B: `7458160447505`
  - vendor logged date: `16308210688913`
  - vendor logged time: `16308235403025`
  - impact start date: `7890263202833`
  - impact start time: `7890288590609`
  - impact stop date: `7890308370449`
  - impact stop time: `7890325701649`
- The Grafana transform also derives combined refs/circuits and vendor logged timestamps.

6. NLD monitoring
- Core endpoint: `search/export`
- Query:
  - `type:ticket tags:iris_partial_nld created>=${__from:date:iso} created<=${__to:date:iso} -tags:"partial_nld_alert_duplicate_solved"`
- Native rebuild implication:
  - this should map nicely to an internal NLD events page because the transform already normalizes route, circuit, state, and hourly buckets.

7. Call / queue monitoring
- Core endpoint: `https://zendesk.api.admin.illation.co.za/api/v1/dashboard/stats`
- Common roots:
  - `$.data.queues`
  - `$.data.queues.agents`
- Native rebuild implication:
  - best handled by a backend poller that snapshots queue stats into local tables at a controlled interval rather than calling the external endpoint directly from the browser.

8. Skipped tickets
- Endpoint:
  - `https://frogfoot.zendesk.com/api/v2/skips?sort_order=desc`
- Native rebuild implication:
  - likely a lightweight admin table or tile in a future NOC monitoring page.

Recommended native Ops Hub architecture for replacement:
1. Build backend collectors or cached ingest jobs by domain, not by panel.
2. Split the dashboard into backend domains:
- `alerts_open_snapshot`
- `outages_open_snapshot`
- `ticket_t1_snapshot`
- `ticket_t2_snapshot`
- `backhaul_open_snapshot`
- `nld_open_snapshot`
- `call_queue_snapshot`
- `skip_ticket_snapshot`
3. Store raw or lightly normalized rows in local tables first.
4. Build summary tables/materialized views for the frontend cards and charts.
5. Let the frontend read local API summaries instead of hitting Zendesk or Illation directly.

Notes for the rebuild:
- Much of the current Grafana complexity is repeated query fan-out and panel-to-panel reuse.
- A native page does not need 111 separate live queries.
- The likely target is 6-10 backend summary endpoints, plus a handful of detail endpoints for drilldown.

Implementation status as of August 10, 2026:
- A first native `NOC Monitoring Hub` route now exists in the frontend.
- The first backend version stores a cached snapshot in `automation_settings` under `noc_monitoring_snapshot_v1`.
- The browser no longer needs to fan out into many live panel-style calls for the initial monitoring view.
- Telephony data is intentionally optional and should remain backend-polled or snapshot-driven rather than browser-live.
