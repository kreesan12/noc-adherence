\echo [INFO] Refreshing SLA dashboard fact tables for month :month_key

ALTER TABLE public.tickets_output
  ADD COLUMN IF NOT EXISTS product_group text,
  ADD COLUMN IF NOT EXISTS service_type text;

ALTER TABLE public.solidbase
  ADD COLUMN IF NOT EXISTS product_group text;

ALTER TABLE public.servicelevels
  ADD COLUMN IF NOT EXISTS product_type text,
  ADD COLUMN IF NOT EXISTS product_group text,
  ADD COLUMN IF NOT EXISTS service_type text,
  ADD COLUMN IF NOT EXISTS region text;

ALTER TABLE public.reporting
  ADD COLUMN IF NOT EXISTS product_type text,
  ADD COLUMN IF NOT EXISTS product_group text,
  ADD COLUMN IF NOT EXISTS service_type text,
  ADD COLUMN IF NOT EXISTS region text;

ALTER TABLE public.isp_table
  ADD COLUMN IF NOT EXISTS product_group text,
  ADD COLUMN IF NOT EXISTS service_type text;

DROP TABLE IF EXISTS tmp_sla_link_meta;
CREATE TEMP TABLE tmp_sla_link_meta AS
WITH latest_solidbase AS (
  SELECT DISTINCT ON (s.frogfootlinklabel)
    s.frogfootlinklabel,
    COALESCE(NULLIF(BTRIM(REPLACE(s.isp, CHR(160), ' ')), ''), 'Unknown') AS isp,
    COALESCE(NULLIF(BTRIM(REPLACE(s.region, CHR(160), ' ')), ''), 'Unknown') AS region,
    COALESCE(NULLIF(BTRIM(REPLACE(s.producttype, CHR(160), ' ')), ''), 'Unknown') AS product_type,
    s.livedate,
    s.canceldate
  FROM public.solidbase s
  WHERE s.frogfootlinklabel IS NOT NULL
  ORDER BY s.frogfootlinklabel,
           COALESCE(s.canceldate::timestamp, '9999-12-31'::timestamp) DESC,
           COALESCE(s.livedate::timestamp, '1900-01-01'::timestamp) DESC
),
latest_service AS (
  SELECT DISTINCT ON (ns.frg)
    ns.frg AS frogfootlinklabel,
    COALESCE(NULLIF(BTRIM(REPLACE(ns.service_type, CHR(160), ' ')), ''), 'Unknown') AS service_type,
    ns.updated_at,
    ns.created_at
  FROM public."NldService" ns
  WHERE ns.frg IS NOT NULL
  ORDER BY ns.frg, ns.updated_at DESC NULLS LAST, ns.created_at DESC NULLS LAST
),
product_group_map AS (
  SELECT
    ptm.raw_product_type,
    ptm.product_group
  FROM public."SlaProductTypeMap" ptm
  WHERE COALESCE(ptm.is_active, true) = true
)
SELECT
  sb.frogfootlinklabel,
  sb.isp,
  sb.region,
  sb.product_type,
  COALESCE(
    NULLIF(pgm.product_group, ''),
    CASE
      WHEN LOWER(sb.product_type) LIKE '%home%' OR LOWER(sb.product_type) LIKE '%air%' THEN 'FTTH'
      WHEN LOWER(sb.product_type) LIKE '%rise%' THEN 'FTTC'
      ELSE 'FTTB'
    END
  ) AS product_group,
  COALESCE(ls.service_type, 'Unknown') AS service_type
FROM latest_solidbase sb
LEFT JOIN latest_service ls
  ON ls.frogfootlinklabel = sb.frogfootlinklabel
LEFT JOIN product_group_map pgm
  ON pgm.raw_product_type = sb.product_type;

CREATE INDEX IF NOT EXISTS idx_tmp_sla_link_meta_frg
  ON tmp_sla_link_meta (frogfootlinklabel);

INSERT INTO public."SlaProductTypeMap" (
  raw_product_type,
  product_group,
  sort_order
)
SELECT DISTINCT
  sb.product_type,
  CASE
    WHEN LOWER(sb.product_type) LIKE '%home%' OR LOWER(sb.product_type) LIKE '%air%' THEN 'FTTH'
    WHEN LOWER(sb.product_type) LIKE '%rise%' THEN 'FTTC'
    ELSE 'FTTB'
  END AS product_group,
  CASE
    WHEN LOWER(sb.product_type) LIKE '%home%' OR LOWER(sb.product_type) LIKE '%air%' THEN 20
    WHEN LOWER(sb.product_type) LIKE '%rise%' THEN 30
    ELSE 10
  END AS sort_order
FROM (
  SELECT DISTINCT
    COALESCE(NULLIF(BTRIM(REPLACE(s.producttype, CHR(160), ' ')), ''), 'Unknown') AS product_type
  FROM public.solidbase s
  WHERE s.frogfootlinklabel IS NOT NULL
) sb
WHERE sb.product_type IS NOT NULL
ON CONFLICT (raw_product_type) DO NOTHING;

UPDATE public.solidbase s
SET product_group = COALESCE(
  ptm.product_group,
  CASE
    WHEN LOWER(COALESCE(NULLIF(BTRIM(REPLACE(s.producttype, CHR(160), ' ')), ''), '')) LIKE '%home%'
      OR LOWER(COALESCE(NULLIF(BTRIM(REPLACE(s.producttype, CHR(160), ' ')), ''), '')) LIKE '%air%'
      THEN 'FTTH'
    WHEN LOWER(COALESCE(NULLIF(BTRIM(REPLACE(s.producttype, CHR(160), ' ')), ''), '')) LIKE '%rise%'
      THEN 'FTTC'
    ELSE 'FTTB'
  END
)
FROM public."SlaProductTypeMap" ptm
WHERE ptm.raw_product_type = COALESCE(NULLIF(BTRIM(REPLACE(s.producttype, CHR(160), ' ')), ''), 'Unknown');

UPDATE public.tickets_output t
SET product_type = COALESCE(NULLIF(BTRIM(REPLACE(t.product_type, CHR(160), ' ')), ''), lm.product_type, 'Unknown'),
    product_group = COALESCE(lm.product_group, CASE
      WHEN LOWER(COALESCE(NULLIF(BTRIM(REPLACE(t.product_type, CHR(160), ' ')), ''), '')) LIKE '%home%'
        OR LOWER(COALESCE(NULLIF(BTRIM(REPLACE(t.product_type, CHR(160), ' ')), ''), '')) LIKE '%air%'
        THEN 'FTTH'
      WHEN LOWER(COALESCE(NULLIF(BTRIM(REPLACE(t.product_type, CHR(160), ' ')), ''), '')) LIKE '%rise%'
        THEN 'FTTC'
      ELSE 'FTTB'
    END),
    service_type = COALESCE(lm.service_type, 'Unknown')
FROM tmp_sla_link_meta lm
WHERE t.frg = lm.frogfootlinklabel
  AND t.year_month = :'month_key';

UPDATE public.tickets_output t
SET product_type = COALESCE(NULLIF(BTRIM(REPLACE(t.product_type, CHR(160), ' ')), ''), 'Unknown'),
    product_group = COALESCE(product_group, CASE
      WHEN LOWER(COALESCE(NULLIF(BTRIM(REPLACE(t.product_type, CHR(160), ' ')), ''), '')) LIKE '%home%'
        OR LOWER(COALESCE(NULLIF(BTRIM(REPLACE(t.product_type, CHR(160), ' ')), ''), '')) LIKE '%air%'
        THEN 'FTTH'
      WHEN LOWER(COALESCE(NULLIF(BTRIM(REPLACE(t.product_type, CHR(160), ' ')), ''), '')) LIKE '%rise%'
        THEN 'FTTC'
      ELSE 'FTTB'
    END),
    service_type = COALESCE(t.service_type, 'Unknown')
WHERE t.year_month = :'month_key';

UPDATE public.servicelevels s
SET product_type = COALESCE(lm.product_type, 'Unknown'),
    product_group = COALESCE(lm.product_group, 'FTTB'),
    service_type = COALESCE(lm.service_type, 'Unknown'),
    region = COALESCE(lm.region, 'Unknown')
FROM tmp_sla_link_meta lm
WHERE s.frogfootlinklabel = lm.frogfootlinklabel
  AND s.year_month = :'month_key';

UPDATE public.reporting r
SET product_type = COALESCE(s.product_type, 'Unknown'),
    product_group = COALESCE(s.product_group, 'FTTB'),
    service_type = COALESCE(s.service_type, 'Unknown'),
    region = COALESCE(s.region, 'Unknown')
FROM public.servicelevels s
WHERE s.frogfootlinklabel = r.frogfootlinklabel
  AND s.year_month = r.year_month
  AND r.year_month = :'month_key';

UPDATE public.isp_table i
SET region = COALESCE(r.region, lm.region, 'Unknown'),
    producttype = COALESCE(r.product_type, lm.product_type, COALESCE(NULLIF(BTRIM(REPLACE(i.producttype, CHR(160), ' ')), ''), 'Unknown')),
    product_group = COALESCE(r.product_group, lm.product_group, 'FTTB'),
    service_type = COALESCE(r.service_type, lm.service_type, 'Unknown')
FROM public.reporting r
LEFT JOIN tmp_sla_link_meta lm
  ON lm.frogfootlinklabel = r.frogfootlinklabel
WHERE r.frogfootlinklabel = i.frogfootlinklabel
  AND r.year_month = i.year_month
  AND i.year_month = :'month_key';

DELETE FROM public.sla_ticket_monthly_fact
WHERE year_month = :'month_key';

WITH zendesk_dim AS (
  SELECT DISTINCT ON (z.ticketid::text)
    z.ticketid::text AS ticket_id,
    z.severity,
    z.partyatfault,
    z.stoptime,
    z.ticketcreated
  FROM public.zendesktickets z
  WHERE z.ticketid IS NOT NULL
  ORDER BY z.ticketid::text, z.stoptime DESC NULLS LAST, z.ticketcreated DESC NULLS LAST
)
INSERT INTO public.sla_ticket_monthly_fact (
  year_month,
  frg,
  isp,
  region,
  product_type,
  product_group,
  service_type,
  ticket_id,
  created_date,
  impact_stop_time,
  category,
  severity,
  party_at_fault,
  site_access_times,
  site_access_schedule,
  raw_hours,
  excluded_hours,
  final_hours,
  service_impacting
)
SELECT DISTINCT ON (t.year_month, t.ticket_id::text)
  t.year_month,
  COALESCE(t.frg, 'Unknown') AS frg,
  COALESCE(lm.isp, 'Unknown') AS isp,
  COALESCE(lm.region, 'Unknown') AS region,
  COALESCE(NULLIF(BTRIM(REPLACE(t.product_type, CHR(160), ' ')), ''), lm.product_type, 'Unknown') AS product_type,
  COALESCE(NULLIF(BTRIM(REPLACE(t.product_group, CHR(160), ' ')), ''), lm.product_group, 'FTTB') AS product_group,
  COALESCE(NULLIF(BTRIM(REPLACE(t.service_type, CHR(160), ' ')), ''), lm.service_type, 'Unknown') AS service_type,
  t.ticket_id::text,
  t.created_date,
  t.impact_stop_time,
  COALESCE(NULLIF(BTRIM(REPLACE(t."Category", CHR(160), ' ')), ''), 'Unknown') AS category,
  COALESCE(NULLIF(BTRIM(REPLACE(z.severity, CHR(160), ' ')), ''), 'Unknown') AS severity,
  COALESCE(NULLIF(BTRIM(REPLACE(z.partyatfault, CHR(160), ' ')), ''), 'Unknown') AS party_at_fault,
  t.site_access_times,
  t.site_access_schedule,
  ROUND((EXTRACT(EPOCH FROM COALESCE(t.raw_downtime, interval '0 second')) / 3600.0)::numeric, 2) AS raw_hours,
  ROUND((EXTRACT(EPOCH FROM COALESCE(t.excluded_site_access_duration, interval '0 second')) / 3600.0)::numeric, 2) AS excluded_hours,
  ROUND((EXTRACT(EPOCH FROM COALESCE(t.final_ticket_downtime, interval '0 second')) / 3600.0)::numeric, 2) AS final_hours,
  (COALESCE(t."Category", '') = 'Service impacting') AS service_impacting
FROM public.tickets_output t
LEFT JOIN zendesk_dim z
  ON z.ticket_id = t.ticket_id::text
LEFT JOIN tmp_sla_link_meta lm
  ON lm.frogfootlinklabel = t.frg
WHERE t.year_month = :'month_key'
  AND t.ticket_id IS NOT NULL
ORDER BY t.year_month, t.ticket_id::text, t.impact_stop_time DESC NULLS LAST, t.created_date DESC NULLS LAST;

DELETE FROM public.sla_outage_link_monthly_fact
WHERE year_month = :'month_key';

INSERT INTO public.sla_outage_link_monthly_fact (
  year_month,
  outage_ref,
  frogfootlinklabel,
  isp,
  link_region,
  product_type,
  product_group,
  service_type,
  impact_start,
  impact_stop,
  impact_type,
  cause_class,
  cause_class_sub,
  outage_region,
  party_at_fault,
  summary,
  client_count,
  affected_links_total,
  incident_class,
  duration_hours
)
WITH outage_base AS (
  SELECT DISTINCT
    o.year_month,
    o.outage_ref,
    os.frogfootlinklabel,
    COALESCE(lm.isp, 'Unknown') AS isp,
    COALESCE(lm.region, 'Unknown') AS link_region,
    COALESCE(lm.product_type, 'Unknown') AS product_type,
    COALESCE(lm.product_group, 'FTTB') AS product_group,
    COALESCE(lm.service_type, 'Unknown') AS service_type,
    o.impact_start,
    o.impact_stop,
    COALESCE(NULLIF(BTRIM(REPLACE(o.impact_type, CHR(160), ' ')), ''), 'Unknown') AS impact_type,
    COALESCE(NULLIF(BTRIM(REPLACE(o.cause_class, CHR(160), ' ')), ''), 'Unknown') AS cause_class,
    COALESCE(NULLIF(BTRIM(REPLACE(o.cause_class_sub, CHR(160), ' ')), ''), 'Unknown') AS cause_class_sub,
    COALESCE(NULLIF(BTRIM(REPLACE(o.region, CHR(160), ' ')), ''), 'Unknown') AS outage_region,
    COALESCE(NULLIF(BTRIM(REPLACE(o.party_at_fault, CHR(160), ' ')), ''), 'Unknown') AS party_at_fault,
    COALESCE(o.summary, '') AS summary,
    COALESCE(NULLIF(REGEXP_REPLACE(COALESCE(o.sub_count::text, ''), '[^0-9.-]', '', 'g'), ''), '0')::integer AS client_count,
    ROUND((EXTRACT(EPOCH FROM GREATEST(COALESCE(o.impact_stop, o.impact_start) - o.impact_start, interval '0 second')) / 3600.0)::numeric, 2) AS duration_hours
  FROM public.outage_resolvers os
  JOIN public.outages_outage o
    ON o.outage_ref = os.outageref
  LEFT JOIN tmp_sla_link_meta lm
    ON lm.frogfootlinklabel = os.frogfootlinklabel
  WHERE o.year_month = :'month_key'
    AND o.outage_ref IS NOT NULL
    AND os.frogfootlinklabel IS NOT NULL
), outage_rollup AS (
  SELECT
    year_month,
    outage_ref,
    COUNT(DISTINCT frogfootlinklabel)::integer AS affected_links_total,
    MAX(client_count)::integer AS client_count
  FROM outage_base
  GROUP BY year_month, outage_ref
)
SELECT
  ob.year_month,
  ob.outage_ref,
  ob.frogfootlinklabel,
  ob.isp,
  ob.link_region,
  ob.product_type,
  ob.product_group,
  ob.service_type,
  ob.impact_start,
  ob.impact_stop,
  ob.impact_type,
  ob.cause_class,
  ob.cause_class_sub,
  ob.outage_region,
  ob.party_at_fault,
  ob.summary,
  oru.client_count,
  oru.affected_links_total,
  CASE WHEN oru.client_count >= 20 THEN 'Major Outage' ELSE 'Minor Incident' END AS incident_class,
  ob.duration_hours
FROM outage_base ob
JOIN outage_rollup oru
  ON oru.year_month = ob.year_month
 AND oru.outage_ref = ob.outage_ref;

DELETE FROM public.sla_link_monthly_fact
WHERE year_month = :'month_key';

INSERT INTO public.sla_link_monthly_fact (
  year_month,
  frogfootlinklabel,
  isp,
  region,
  product_type,
  product_group,
  service_type,
  uptime_pct,
  active_hours,
  total_downtime_hours,
  outage_downtime_hours,
  ticket_downtime_hours,
  ticket_count,
  service_impacting_ticket_count,
  outage_count,
  outage_impact_count,
  unique_outage_link_count,
  impacted,
  breach
)
WITH ticket_counts AS (
  SELECT
    stmf.year_month,
    stmf.frg AS frogfootlinklabel,
    COUNT(*)::integer AS ticket_count,
    COUNT(*) FILTER (WHERE stmf.service_impacting)::integer AS service_impacting_ticket_count
  FROM public.sla_ticket_monthly_fact stmf
  WHERE stmf.year_month = :'month_key'
  GROUP BY stmf.year_month, stmf.frg
), outage_counts AS (
  SELECT
    so.year_month,
    so.frogfootlinklabel,
    COUNT(DISTINCT so.outage_ref)::integer AS outage_count,
    COUNT(*)::integer AS outage_impact_count
  FROM public.sla_outage_link_monthly_fact so
  WHERE so.year_month = :'month_key'
  GROUP BY so.year_month, so.frogfootlinklabel
)
SELECT
  s.year_month,
  s.frogfootlinklabel,
  COALESCE(NULLIF(BTRIM(REPLACE(s.isp, CHR(160), ' ')), ''), lm.isp, 'Unknown') AS isp,
  COALESCE(NULLIF(BTRIM(REPLACE(s.region, CHR(160), ' ')), ''), lm.region, 'Unknown') AS region,
  COALESCE(NULLIF(BTRIM(REPLACE(s.product_type, CHR(160), ' ')), ''), lm.product_type, 'Unknown') AS product_type,
  COALESCE(NULLIF(BTRIM(REPLACE(s.product_group, CHR(160), ' ')), ''), lm.product_group, 'FTTB') AS product_group,
  COALESCE(NULLIF(BTRIM(REPLACE(s.service_type, CHR(160), ' ')), ''), lm.service_type, 'Unknown') AS service_type,
  ROUND(s."uptime%"::numeric, 2) AS uptime_pct,
  ROUND((EXTRACT(EPOCH FROM COALESCE(s.active_days, interval '0 second')) / 3600.0)::numeric, 2) AS active_hours,
  ROUND((EXTRACT(EPOCH FROM COALESCE(s.total_downtime, interval '0 second')) / 3600.0)::numeric, 2) AS total_downtime_hours,
  ROUND((EXTRACT(EPOCH FROM COALESCE(s.total_outage_downtime, interval '0 second')) / 3600.0)::numeric, 2) AS outage_downtime_hours,
  ROUND((EXTRACT(EPOCH FROM COALESCE(s.total_ticket_downtime, interval '0 second')) / 3600.0)::numeric, 2) AS ticket_downtime_hours,
  COALESCE(tc.ticket_count, 0) AS ticket_count,
  COALESCE(tc.service_impacting_ticket_count, 0) AS service_impacting_ticket_count,
  COALESCE(oc.outage_count, 0) AS outage_count,
  COALESCE(oc.outage_impact_count, 0) AS outage_impact_count,
  CASE WHEN COALESCE(oc.outage_count, 0) > 0 THEN 1 ELSE 0 END AS unique_outage_link_count,
  CASE WHEN COALESCE(s."uptime%", 100) < 100 THEN 1 ELSE 0 END AS impacted,
  CASE WHEN COALESCE(s."uptime%", 100) < 99.5 THEN 1 ELSE 0 END AS breach
FROM public.servicelevels s
LEFT JOIN tmp_sla_link_meta lm
  ON lm.frogfootlinklabel = s.frogfootlinklabel
LEFT JOIN ticket_counts tc
  ON tc.year_month = s.year_month
 AND tc.frogfootlinklabel = s.frogfootlinklabel
LEFT JOIN outage_counts oc
  ON oc.year_month = s.year_month
 AND oc.frogfootlinklabel = s.frogfootlinklabel
WHERE s.year_month = :'month_key'
  AND s.frogfootlinklabel IS NOT NULL;

DELETE FROM public.sla_isp_monthly_summary
WHERE year_month = :'month_key';

INSERT INTO public.sla_isp_monthly_summary (
  year_month,
  isp,
  product_type,
  product_group,
  service_type,
  link_count,
  impacted_links,
  breach_links,
  avg_uptime_pct,
  worst_uptime_pct,
  total_downtime_hours
)
SELECT
  l.year_month,
  l.isp,
  l.product_type,
  l.product_group,
  l.service_type,
  COUNT(*)::integer AS link_count,
  SUM(l.impacted)::integer AS impacted_links,
  SUM(l.breach)::integer AS breach_links,
  ROUND(AVG(l.uptime_pct)::numeric, 2) AS avg_uptime_pct,
  ROUND(MIN(l.uptime_pct)::numeric, 2) AS worst_uptime_pct,
  ROUND(SUM(COALESCE(l.total_downtime_hours, 0))::numeric, 2) AS total_downtime_hours
FROM public.sla_link_monthly_fact l
WHERE l.year_month = :'month_key'
GROUP BY l.year_month, l.isp, l.product_type, l.product_group, l.service_type;

DELETE FROM public.sla_monthly_kpi
WHERE year_month = :'month_key';

INSERT INTO public.sla_monthly_kpi (
  year_month,
  product_type,
  product_group,
  service_type,
  total_links,
  impacted_links,
  breach_links,
  avg_uptime_pct,
  worst_uptime_pct,
  total_downtime_hours,
  ticket_count,
  service_impacting_ticket_count,
  outage_count,
  outage_impact_count,
  unique_outage_link_count,
  minor_outage_count,
  major_outage_count
)
WITH link_rollup AS (
  SELECT
    l.year_month,
    l.product_type,
    l.product_group,
    l.service_type,
    COUNT(*)::integer AS total_links,
    SUM(l.impacted)::integer AS impacted_links,
    SUM(l.breach)::integer AS breach_links,
    ROUND(AVG(l.uptime_pct)::numeric, 2) AS avg_uptime_pct,
    ROUND(MIN(l.uptime_pct)::numeric, 2) AS worst_uptime_pct,
    ROUND(SUM(COALESCE(l.total_downtime_hours, 0))::numeric, 2) AS total_downtime_hours,
    SUM(COALESCE(l.ticket_count, 0))::integer AS ticket_count,
    SUM(COALESCE(l.service_impacting_ticket_count, 0))::integer AS service_impacting_ticket_count,
    SUM(COALESCE(l.outage_impact_count, 0))::integer AS outage_impact_count,
    SUM(COALESCE(l.unique_outage_link_count, 0))::integer AS unique_outage_link_count
  FROM public.sla_link_monthly_fact l
  WHERE l.year_month = :'month_key'
  GROUP BY l.year_month, l.product_type, l.product_group, l.service_type
), outage_rollup AS (
  SELECT
    o.year_month,
    o.product_type,
    o.product_group,
    o.service_type,
    COUNT(DISTINCT o.outage_ref)::integer AS outage_count,
    COUNT(DISTINCT o.outage_ref) FILTER (WHERE o.incident_class = 'Minor Incident')::integer AS minor_outage_count,
    COUNT(DISTINCT o.outage_ref) FILTER (WHERE o.incident_class = 'Major Outage')::integer AS major_outage_count
  FROM public.sla_outage_link_monthly_fact o
  WHERE o.year_month = :'month_key'
  GROUP BY o.year_month, o.product_type, o.product_group, o.service_type
)
SELECT
  lr.year_month,
  lr.product_type,
  lr.product_group,
  lr.service_type,
  lr.total_links,
  lr.impacted_links,
  lr.breach_links,
  lr.avg_uptime_pct,
  lr.worst_uptime_pct,
  lr.total_downtime_hours,
  lr.ticket_count,
  lr.service_impacting_ticket_count,
  COALESCE(orw.outage_count, 0) AS outage_count,
  lr.outage_impact_count,
  lr.unique_outage_link_count,
  COALESCE(orw.minor_outage_count, 0) AS minor_outage_count,
  COALESCE(orw.major_outage_count, 0) AS major_outage_count
FROM link_rollup lr
LEFT JOIN outage_rollup orw
  ON orw.year_month = lr.year_month
 AND orw.product_type = lr.product_type
 AND orw.product_group = lr.product_group
 AND orw.service_type = lr.service_type;

DROP TABLE IF EXISTS tmp_sla_link_meta;

\echo [INFO] SLA dashboard fact tables refreshed for month :month_key
