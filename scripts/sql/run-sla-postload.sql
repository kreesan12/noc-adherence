\set ON_ERROR_STOP on

\echo [INFO] Starting post-load SLA pipeline for month :month_key
\echo [INFO] Month window: :month_start to :month_end (exclusive)

/* -------------------------------------------------------------------------- */
/* Step 1: Add outage duration + year_month for new outage refs only          */
/* -------------------------------------------------------------------------- */
INSERT INTO outages_outage
SELECT DISTINCT
  o.*,
  to_char(o.impact_stop, 'YYYY-MM') AS year_month,
  GREATEST(o.impact_stop - o.impact_start, interval '0 second') AS sla_duration,
  ''::text AS sla_exclusion_reason
FROM public.outagezendeskrefs2 o
WHERE o.outage_ref IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.outages_outage x
    WHERE x.outage_ref = o.outage_ref
  );

/* -------------------------------------------------------------------------- */
/* Step 2: Clean ticket output and insert only unseen ticket IDs              */
/* -------------------------------------------------------------------------- */
INSERT INTO tickets_output
WITH vars AS (
  SELECT :'month_start'::timestamp AS running_month_start
),
up_events AS (
  SELECT DISTINCT d.timestamp, d.element_name
  FROM downevents d
  CROSS JOIN vars
  WHERE d.condition = 'up'
    AND d.source = 'SNIPS'
    AND d.status = 'CLEAR'
    AND d.timestamp >= vars.running_month_start

  UNION

  SELECT DISTINCT ae.timestamp, ae.element_name
  FROM upevents_ae ae
  CROSS JOIN vars
  WHERE ae.timestamp >= vars.running_month_start
),
ticketcleanbase AS (
  SELECT DISTINCT
    z.frglinklabel,
    z.ticketid,
    z.ticketcreated,
    z.stoptime,
    d.timestamp AS irisstoptime,
    ROW_NUMBER() OVER (PARTITION BY z.ticketid ORDER BY d.timestamp ASC) AS indicator1
  FROM zendesktickets z
  LEFT JOIN up_events d
    ON z.frglinklabel = LEFT(d.element_name, LENGTH(z.frglinklabel))
   AND d.timestamp BETWEEN z.ticketcreated AND z.stoptime
  CROSS JOIN vars
  WHERE z.ticketid IS NOT NULL
    AND (LENGTH(z.ticketproblemid) < 6 OR LENGTH(z.ticketproblemid) IS NULL)
    AND z.rootcause <> 'No Fault Found'
    AND z.partyatfault <> 'Client'
    AND z.duplicateticket <> '1'
    AND z.classification <> 'No Fault Found'
    AND z.severity NOT IN ('Request for Information', 'Severity 3')
    AND z.stoptime >= vars.running_month_start
),
accuratestoptime AS (
  SELECT
    *,
    CASE WHEN irisstoptime IS NOT NULL THEN irisstoptime ELSE stoptime END AS confirmedstoptime
  FROM ticketcleanbase
  WHERE indicator1 = 1
),
ticket_output1 AS (
  SELECT
    z.frglinklabel AS frg,
    z.ticketid AS ticket_id,
    z.ticketcreated AS created_date,
    ast.confirmedstoptime AS impact_stop_time,
    CASE
      WHEN ast.confirmedstoptime IS NOT NULL THEN TO_CHAR(ast.confirmedstoptime, 'YYYY-MM')
      ELSE TO_CHAR(z.ticketcreated, 'YYYY-MM')
    END AS year_month,
    ast.confirmedstoptime - z.ticketcreated AS durations,
    CASE
      WHEN z.partyatfault = 'Client' THEN 'Client fault'
      WHEN LENGTH(z.ticketproblemid) >= 6 THEN CONCAT('linked to outage ', oz.outage_ref)
      WHEN z.rootcause = 'No Fault Found' THEN 'Non service impacting'
      WHEN z.duplicateticket = '1' THEN 'Duplicate ticket'
      WHEN z.classification = 'No Fault Found' THEN 'Non service impacting'
      WHEN z.severity IN ('Request for Information', 'Severity 3') THEN 'Severity 3 or RFI'
      ELSE 'Service impacting'
    END AS "Category"
  FROM zendesktickets z
  LEFT JOIN outagezendeskrefs2 oz
    ON oz.ffticket = z.ticketproblemid
  LEFT JOIN accuratestoptime ast
    ON ast.ticketid = z.ticketid
  CROSS JOIN vars
  WHERE z.stoptime >= vars.running_month_start
)
SELECT
  t1.*,
  CASE
    WHEN t1."Category" = 'Service impacting'
      THEN GREATEST(COALESCE(t1.impact_stop_time, t1.created_date) - t1.created_date, interval '0 second')
    ELSE interval '0 second'
  END AS sla_duration,
  CASE
    WHEN t1."Category" = 'Service impacting' THEN ''
    WHEN t1."Category" = 'Client fault' THEN 'Fault attributed to client'
    WHEN t1."Category" = 'Non service impacting' THEN 'Ticket resolved as no link impact or no layer 2 fault found'
    WHEN t1."Category" LIKE '%linked to outage%' THEN 'Downtime allocated under outage ticket'
    WHEN t1."Category" = 'Duplicate ticket' THEN 'Duplicate ticket logged by ISP'
    WHEN t1."Category" = 'Severity 3 or RFI' THEN 'Ticket logged as Severity 3 or Request for information i.e. not an active fault'
    ELSE ''
  END AS sla_exclusion_reason
FROM ticket_output1 t1
WHERE t1.ticket_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM tickets_output x
    WHERE x.ticket_id = t1.ticket_id
  );

/* -------------------------------------------------------------------------- */
/* Step 3: Rebuild servicelevels for selected month only                      */
/* Uses multirange overlap handling so ticket/outage overlap cannot overcount */
/* and uptime is always clamped to [0, 100].                                  */
/* -------------------------------------------------------------------------- */
DELETE FROM servicelevels
WHERE year_month = :'month_key';

INSERT INTO servicelevels (
  frogfootlinklabel,
  isp,
  year_month,
  active_days,
  total_outage_downtime,
  total_ticket_downtime,
  total_downtime,
  "uptime%"
)
WITH vars AS (
  SELECT
    :'month_start'::timestamp AS month_start,
    :'month_end'::timestamp AS month_end,
    :'month_key'::text AS month_key
),
active_bounds AS (
  SELECT
    s.frogfootlinklabel,
    COALESCE(NULLIF(s.isp, ''), 'Unknown') AS isp,
    GREATEST(s.livedate::timestamp, v.month_start) AS range_start,
    LEAST(COALESCE(s.canceldate::timestamp, v.month_end), v.month_end) AS range_end
  FROM public.solidbase s
  CROSS JOIN vars v
  WHERE s.frogfootlinklabel IS NOT NULL
    AND s.livedate IS NOT NULL
    AND s.livedate::timestamp < v.month_end
    AND (s.canceldate IS NULL OR s.canceldate::timestamp > v.month_start)
),
active_ranges AS (
  SELECT
    frogfootlinklabel,
    isp,
    tsrange(range_start, range_end, '[)') AS active_r
  FROM active_bounds
  WHERE range_end > range_start
),
active_mr AS (
  SELECT
    frogfootlinklabel,
    MAX(isp) AS isp,
    range_agg(active_r) AS active_mr
  FROM active_ranges
  GROUP BY frogfootlinklabel
),
active_seconds AS (
  SELECT
    a.frogfootlinklabel,
    a.isp,
    COALESCE(
      (
        SELECT SUM(EXTRACT(EPOCH FROM (upper(r) - lower(r))))
        FROM unnest(a.active_mr) AS r
      ),
      0
    )::numeric AS active_seconds
  FROM active_mr a
),
outage_bounds AS (
  SELECT
    os.frogfootlinklabel,
    GREATEST(o.impact_start, v.month_start) AS range_start,
    LEAST(o.impact_stop, v.month_end) AS range_end
  FROM public.outage_resolvers os
  JOIN public.outages_outage o
    ON o.outage_ref = os.outageref
  CROSS JOIN vars v
  WHERE os.frogfootlinklabel IS NOT NULL
    AND o.impact_start IS NOT NULL
    AND o.impact_stop IS NOT NULL
    AND o.impact_start < v.month_end
    AND o.impact_stop > v.month_start
),
outage_ranges_raw AS (
  SELECT
    frogfootlinklabel,
    tsrange(range_start, range_end, '[)') AS outage_r
  FROM outage_bounds
  WHERE range_end > range_start
),
outage_mr AS (
  SELECT
    frogfootlinklabel,
    range_agg(outage_r) AS outage_mr
  FROM outage_ranges_raw
  GROUP BY frogfootlinklabel
),
outage_seconds AS (
  SELECT
    o.frogfootlinklabel,
    COALESCE(
      (
        SELECT SUM(EXTRACT(EPOCH FROM (upper(r) - lower(r))))
        FROM unnest(o.outage_mr) AS r
      ),
      0
    )::numeric AS outage_seconds
  FROM outage_mr o
),
ticket_bounds AS (
  SELECT
    t.frg AS frogfootlinklabel,
    GREATEST(t.created_date, v.month_start) AS range_start,
    LEAST(COALESCE(t.impact_stop_time, t.created_date), v.month_end) AS range_end
  FROM public.tickets_output t
  CROSS JOIN vars v
  WHERE t.frg IS NOT NULL
    AND t."Category" = 'Service impacting'
    AND t.created_date IS NOT NULL
    AND t.created_date < v.month_end
    AND COALESCE(t.impact_stop_time, t.created_date) > v.month_start
),
ticket_ranges AS (
  SELECT
    frogfootlinklabel,
    tsrange(range_start, range_end, '[)') AS ticket_r
  FROM ticket_bounds
  WHERE range_end > range_start
),
ticket_ranges_clean AS (
  SELECT *
  FROM ticket_ranges
),
ticket_seconds AS (
  SELECT
    tr.frogfootlinklabel,
    COALESCE(
      SUM(
        COALESCE(
          (
            SELECT SUM(EXTRACT(EPOCH FROM (upper(r) - lower(r))))
            FROM unnest(
              CASE
                WHEN om.outage_mr IS NULL THEN tsmultirange(tr.ticket_r)
                ELSE (tsmultirange(tr.ticket_r) - om.outage_mr)
              END
            ) AS r
          ),
          0
        )
      ),
      0
    )::numeric AS ticket_seconds
  FROM ticket_ranges_clean tr
  LEFT JOIN outage_mr om
    ON om.frogfootlinklabel = tr.frogfootlinklabel
  GROUP BY tr.frogfootlinklabel
),
final AS (
  SELECT
    a.frogfootlinklabel,
    a.isp,
    v.month_key AS year_month,
    a.active_seconds,
    COALESCE(o.outage_seconds, 0)::numeric AS outage_seconds,
    COALESCE(t.ticket_seconds, 0)::numeric AS ticket_seconds
  FROM active_seconds a
  CROSS JOIN vars v
  LEFT JOIN outage_seconds o
    ON o.frogfootlinklabel = a.frogfootlinklabel
  LEFT JOIN ticket_seconds t
    ON t.frogfootlinklabel = a.frogfootlinklabel
  WHERE a.active_seconds > 0
)
SELECT
  f.frogfootlinklabel,
  f.isp,
  f.year_month,
  (f.active_seconds * interval '1 second') AS active_days,
  (f.outage_seconds * interval '1 second') AS total_outage_downtime,
  (f.ticket_seconds * interval '1 second') AS total_ticket_downtime,
  ((f.outage_seconds + f.ticket_seconds) * interval '1 second') AS total_downtime,
  ROUND(
    LEAST(
      100.00,
      GREATEST(
        0.00,
        100.00 - (
          (GREATEST(f.outage_seconds + f.ticket_seconds, 0) / NULLIF(f.active_seconds, 0)) * 100.00
        )
      )
    ),
    2
  ) AS "uptime%"
FROM final f;

/* defensive guardrails in case of edge-case source data */
UPDATE servicelevels
SET "uptime%" = 100.00
WHERE year_month = :'month_key'
  AND "uptime%" > 100.00;

UPDATE servicelevels
SET "uptime%" = 0.00
WHERE year_month = :'month_key'
  AND "uptime%" < 0.00;

/* -------------------------------------------------------------------------- */
/* Step 4: Rebuild reporting and isp_table summaries                          */
/* -------------------------------------------------------------------------- */
DROP TABLE IF EXISTS reporting;
DROP TABLE IF EXISTS isp_table;

CREATE TABLE reporting AS
WITH cte AS (
  SELECT
    s.*,
    CASE
      WHEN CAST(s."uptime%" AS DECIMAL) = 100 THEN '1.no_impact'
      WHEN CAST(s."uptime%" AS DECIMAL) BETWEEN 99.46 AND 100 THEN '2.impact < 4 hrs'
      WHEN CAST(s."uptime%" AS DECIMAL) BETWEEN 98.92 AND 99.46 THEN '3.impact < 8 hrs'
      WHEN CAST(s."uptime%" AS DECIMAL) BETWEEN 96.7 AND 98.92 THEN '4.impact < 24hrs'
      ELSE '5.impact > 24hrs'
    END AS bucket
  FROM public.servicelevels s
)
SELECT *
FROM cte;

CREATE TABLE isp_table AS
WITH ticket_counts AS (
  SELECT
    t.year_month,
    t.frg,
    COUNT(t.frg) AS tickets,
    COUNT(DISTINCT t.frg) AS tickets_unique_links
  FROM public.tickets_output t
  GROUP BY t.year_month, t.frg
),
outage_counts AS (
  SELECT
    o.year_month,
    o.frogfootlinklabel,
    COUNT(o.frogfootlinklabel) AS outages,
    COUNT(DISTINCT o.frogfootlinklabel) AS outages_unique_links
  FROM public.outage_resolvers o
  GROUP BY o.year_month, o.frogfootlinklabel
),
solidbase_dim AS (
  SELECT
    s.frogfootlinklabel,
    MAX(s.region) AS region,
    MAX(s.producttype) AS producttype
  FROM public.solidbase s
  GROUP BY s.frogfootlinklabel
),
joined AS (
  SELECT
    r.*,
    sd.region,
    sd.producttype,
    tc.tickets,
    tc.tickets_unique_links,
    oc.outages,
    oc.outages_unique_links
  FROM reporting r
  LEFT JOIN ticket_counts tc
    ON tc.frg = r.frogfootlinklabel
   AND tc.year_month = r.year_month
  LEFT JOIN outage_counts oc
    ON oc.frogfootlinklabel = r.frogfootlinklabel
   AND oc.year_month = r.year_month
  LEFT JOIN solidbase_dim sd
    ON sd.frogfootlinklabel = r.frogfootlinklabel
)
SELECT
  j.*,
  CASE WHEN j.bucket = '1.no_impact' THEN 0 ELSE 1 END AS unique_links_affected
FROM joined j;

/* -------------------------------------------------------------------------- */
/* Step 5: Build SIP dataset for selected month using last 3 months           */
/* -------------------------------------------------------------------------- */
DELETE FROM sip_table
WHERE sip_month = :'month_key';

INSERT INTO sip_table (
  sip_month,
  frogfootlinklabel,
  producttype,
  isp,
  region,
  total_tickets,
  total_outages,
  total_events,
  total_downtime,
  active_months,
  priority_rank,
  secondary_rank
)
WITH vars AS (
  SELECT
    :'month_start'::date AS month_start,
    :'month_key'::text AS month_key
),
last_3_months AS (
  SELECT
    i.frogfootlinklabel,
    SUM(COALESCE(i.tickets, 0)) AS total_tickets,
    SUM(COALESCE(i.outages, 0)) AS total_outages,
    SUM(COALESCE(i.tickets, 0) + COALESCE(i.outages, 0)) AS total_events,
    SUM(COALESCE(i.total_downtime, interval '0 second')) AS total_downtime,
    COUNT(DISTINCT i.year_month) AS active_months
  FROM isp_table i
  CROSS JOIN vars v
  WHERE to_date(i.year_month || '-01', 'YYYY-MM-DD')
        BETWEEN (v.month_start - interval '2 months')::date
            AND v.month_start
  GROUP BY i.frogfootlinklabel
  HAVING SUM(COALESCE(i.tickets, 0) + COALESCE(i.outages, 0)) >= 3
),
current_month_check AS (
  SELECT DISTINCT i.frogfootlinklabel
  FROM isp_table i
  CROSS JOIN vars v
  WHERE i.year_month = v.month_key
    AND (COALESCE(i.tickets, 0) > 0 OR COALESCE(i.outages, 0) > 0)
),
business_links AS (
  SELECT
    s.frogfootlinklabel,
    MAX(s.producttype) AS producttype,
    MAX(s.isp) AS isp,
    MAX(s.region) AS region
  FROM solidbase s
  WHERE s.producttype NOT IN ('Access Air', 'Access Home', 'Access S4L', 'Access Rise Prepaid')
  GROUP BY s.frogfootlinklabel
),
ranked_links AS (
  SELECT
    v.month_key AS sip_month,
    l3.frogfootlinklabel,
    b.producttype,
    b.isp,
    b.region,
    l3.total_tickets,
    l3.total_outages,
    l3.total_events,
    l3.total_downtime,
    l3.active_months,
    RANK() OVER (
      ORDER BY l3.active_months DESC, l3.total_events DESC, l3.total_downtime DESC
    ) AS priority_rank
  FROM last_3_months l3
  JOIN current_month_check c
    ON c.frogfootlinklabel = l3.frogfootlinklabel
  JOIN business_links b
    ON b.frogfootlinklabel = l3.frogfootlinklabel
  CROSS JOIN vars v
)
SELECT
  rl.*,
  RANK() OVER (
    PARTITION BY (rl.active_months < 3)
    ORDER BY rl.total_events DESC, rl.total_downtime DESC
  ) AS secondary_rank
FROM ranked_links rl
ORDER BY rl.priority_rank;

\echo [INFO] SLA pipeline completed for month :month_key
