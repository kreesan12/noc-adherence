ALTER TABLE IF EXISTS public.tickets_output
  ADD COLUMN IF NOT EXISTS product_group text,
  ADD COLUMN IF NOT EXISTS service_type text;

ALTER TABLE IF EXISTS public.solidbase
  ADD COLUMN IF NOT EXISTS product_group text;

ALTER TABLE IF EXISTS public.servicelevels
  ADD COLUMN IF NOT EXISTS product_type text,
  ADD COLUMN IF NOT EXISTS product_group text,
  ADD COLUMN IF NOT EXISTS service_type text,
  ADD COLUMN IF NOT EXISTS region text;

ALTER TABLE IF EXISTS public.reporting
  ADD COLUMN IF NOT EXISTS product_type text,
  ADD COLUMN IF NOT EXISTS product_group text,
  ADD COLUMN IF NOT EXISTS service_type text,
  ADD COLUMN IF NOT EXISTS region text;

ALTER TABLE IF EXISTS public.isp_table
  ADD COLUMN IF NOT EXISTS product_group text,
  ADD COLUMN IF NOT EXISTS service_type text;

CREATE TABLE IF NOT EXISTS public.sla_link_monthly_fact (
  id SERIAL PRIMARY KEY,
  year_month text NOT NULL,
  frogfootlinklabel text NOT NULL,
  isp text NOT NULL DEFAULT 'Unknown',
  region text NOT NULL DEFAULT 'Unknown',
  product_type text NOT NULL DEFAULT 'Unknown',
  product_group text NOT NULL DEFAULT 'FTTB',
  service_type text NOT NULL DEFAULT 'Unknown',
  uptime_pct numeric(7,2),
  active_hours numeric(18,2),
  total_downtime_hours numeric(18,2),
  outage_downtime_hours numeric(18,2),
  ticket_downtime_hours numeric(18,2),
  ticket_count integer NOT NULL DEFAULT 0,
  service_impacting_ticket_count integer NOT NULL DEFAULT 0,
  outage_count integer NOT NULL DEFAULT 0,
  outage_impact_count integer NOT NULL DEFAULT 0,
  unique_outage_link_count integer NOT NULL DEFAULT 0,
  impacted integer NOT NULL DEFAULT 0,
  breach integer NOT NULL DEFAULT 0,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sla_link_monthly_fact
  ON public.sla_link_monthly_fact (year_month, frogfootlinklabel);
CREATE INDEX IF NOT EXISTS idx_sla_link_monthly_fact_month
  ON public.sla_link_monthly_fact (year_month);
CREATE INDEX IF NOT EXISTS idx_sla_link_monthly_fact_isp_month
  ON public.sla_link_monthly_fact (isp, year_month);
CREATE INDEX IF NOT EXISTS idx_sla_link_monthly_fact_product_group_month
  ON public.sla_link_monthly_fact (product_group, year_month);
CREATE INDEX IF NOT EXISTS idx_sla_link_monthly_fact_product_type_month
  ON public.sla_link_monthly_fact (product_type, year_month);
CREATE INDEX IF NOT EXISTS idx_sla_link_monthly_fact_service_type_month
  ON public.sla_link_monthly_fact (service_type, year_month);
CREATE INDEX IF NOT EXISTS idx_sla_link_monthly_fact_frg_month
  ON public.sla_link_monthly_fact (frogfootlinklabel, year_month);

CREATE TABLE IF NOT EXISTS public.sla_ticket_monthly_fact (
  id SERIAL PRIMARY KEY,
  year_month text NOT NULL,
  frg text NOT NULL DEFAULT 'Unknown',
  isp text NOT NULL DEFAULT 'Unknown',
  region text NOT NULL DEFAULT 'Unknown',
  product_type text NOT NULL DEFAULT 'Unknown',
  product_group text NOT NULL DEFAULT 'FTTB',
  service_type text NOT NULL DEFAULT 'Unknown',
  ticket_id text NOT NULL,
  created_date timestamp(3),
  impact_stop_time timestamp(3),
  category text NOT NULL DEFAULT 'Unknown',
  severity text NOT NULL DEFAULT 'Unknown',
  party_at_fault text NOT NULL DEFAULT 'Unknown',
  site_access_times text,
  site_access_schedule text,
  raw_hours numeric(18,2) NOT NULL DEFAULT 0,
  excluded_hours numeric(18,2) NOT NULL DEFAULT 0,
  final_hours numeric(18,2) NOT NULL DEFAULT 0,
  service_impacting boolean NOT NULL DEFAULT false,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sla_ticket_monthly_fact
  ON public.sla_ticket_monthly_fact (year_month, ticket_id);
CREATE INDEX IF NOT EXISTS idx_sla_ticket_monthly_fact_month
  ON public.sla_ticket_monthly_fact (year_month);
CREATE INDEX IF NOT EXISTS idx_sla_ticket_monthly_fact_frg_month
  ON public.sla_ticket_monthly_fact (frg, year_month);
CREATE INDEX IF NOT EXISTS idx_sla_ticket_monthly_fact_product_group_month
  ON public.sla_ticket_monthly_fact (product_group, year_month);
CREATE INDEX IF NOT EXISTS idx_sla_ticket_monthly_fact_product_type_month
  ON public.sla_ticket_monthly_fact (product_type, year_month);
CREATE INDEX IF NOT EXISTS idx_sla_ticket_monthly_fact_service_type_month
  ON public.sla_ticket_monthly_fact (service_type, year_month);

CREATE TABLE IF NOT EXISTS public.sla_outage_link_monthly_fact (
  id SERIAL PRIMARY KEY,
  year_month text NOT NULL,
  outage_ref text NOT NULL,
  frogfootlinklabel text NOT NULL,
  isp text NOT NULL DEFAULT 'Unknown',
  link_region text NOT NULL DEFAULT 'Unknown',
  product_type text NOT NULL DEFAULT 'Unknown',
  product_group text NOT NULL DEFAULT 'FTTB',
  service_type text NOT NULL DEFAULT 'Unknown',
  impact_start timestamp(3),
  impact_stop timestamp(3),
  impact_type text NOT NULL DEFAULT 'Unknown',
  cause_class text NOT NULL DEFAULT 'Unknown',
  cause_class_sub text NOT NULL DEFAULT 'Unknown',
  outage_region text NOT NULL DEFAULT 'Unknown',
  party_at_fault text NOT NULL DEFAULT 'Unknown',
  summary text,
  client_count integer NOT NULL DEFAULT 0,
  affected_links_total integer NOT NULL DEFAULT 0,
  incident_class text NOT NULL DEFAULT 'Minor Incident',
  duration_hours numeric(18,2) NOT NULL DEFAULT 0,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sla_outage_link_monthly_fact
  ON public.sla_outage_link_monthly_fact (year_month, outage_ref, frogfootlinklabel);
CREATE INDEX IF NOT EXISTS idx_sla_outage_link_monthly_fact_month
  ON public.sla_outage_link_monthly_fact (year_month);
CREATE INDEX IF NOT EXISTS idx_sla_outage_link_monthly_fact_outage_month
  ON public.sla_outage_link_monthly_fact (outage_ref, year_month);
CREATE INDEX IF NOT EXISTS idx_sla_outage_link_monthly_fact_frg_month
  ON public.sla_outage_link_monthly_fact (frogfootlinklabel, year_month);
CREATE INDEX IF NOT EXISTS idx_sla_outage_link_monthly_fact_product_group_month
  ON public.sla_outage_link_monthly_fact (product_group, year_month);
CREATE INDEX IF NOT EXISTS idx_sla_outage_link_monthly_fact_product_type_month
  ON public.sla_outage_link_monthly_fact (product_type, year_month);
CREATE INDEX IF NOT EXISTS idx_sla_outage_link_monthly_fact_service_type_month
  ON public.sla_outage_link_monthly_fact (service_type, year_month);

CREATE TABLE IF NOT EXISTS public.sla_monthly_kpi (
  id SERIAL PRIMARY KEY,
  year_month text NOT NULL,
  product_type text NOT NULL DEFAULT 'Unknown',
  product_group text NOT NULL DEFAULT 'FTTB',
  service_type text NOT NULL DEFAULT 'Unknown',
  total_links integer NOT NULL DEFAULT 0,
  impacted_links integer NOT NULL DEFAULT 0,
  breach_links integer NOT NULL DEFAULT 0,
  avg_uptime_pct numeric(7,2) NOT NULL DEFAULT 0,
  worst_uptime_pct numeric(7,2) NOT NULL DEFAULT 0,
  total_downtime_hours numeric(18,2) NOT NULL DEFAULT 0,
  ticket_count integer NOT NULL DEFAULT 0,
  service_impacting_ticket_count integer NOT NULL DEFAULT 0,
  outage_count integer NOT NULL DEFAULT 0,
  outage_impact_count integer NOT NULL DEFAULT 0,
  unique_outage_link_count integer NOT NULL DEFAULT 0,
  minor_outage_count integer NOT NULL DEFAULT 0,
  major_outage_count integer NOT NULL DEFAULT 0,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sla_monthly_kpi
  ON public.sla_monthly_kpi (year_month, product_type, product_group, service_type);
CREATE INDEX IF NOT EXISTS idx_sla_monthly_kpi_month
  ON public.sla_monthly_kpi (year_month);
CREATE INDEX IF NOT EXISTS idx_sla_monthly_kpi_product_group_month
  ON public.sla_monthly_kpi (product_group, year_month);
CREATE INDEX IF NOT EXISTS idx_sla_monthly_kpi_product_type_month
  ON public.sla_monthly_kpi (product_type, year_month);
CREATE INDEX IF NOT EXISTS idx_sla_monthly_kpi_service_type_month
  ON public.sla_monthly_kpi (service_type, year_month);

CREATE TABLE IF NOT EXISTS public.sla_isp_monthly_summary (
  id SERIAL PRIMARY KEY,
  year_month text NOT NULL,
  isp text NOT NULL DEFAULT 'Unknown',
  product_type text NOT NULL DEFAULT 'Unknown',
  product_group text NOT NULL DEFAULT 'FTTB',
  service_type text NOT NULL DEFAULT 'Unknown',
  link_count integer NOT NULL DEFAULT 0,
  impacted_links integer NOT NULL DEFAULT 0,
  breach_links integer NOT NULL DEFAULT 0,
  avg_uptime_pct numeric(7,2) NOT NULL DEFAULT 0,
  worst_uptime_pct numeric(7,2) NOT NULL DEFAULT 0,
  total_downtime_hours numeric(18,2) NOT NULL DEFAULT 0,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sla_isp_monthly_summary
  ON public.sla_isp_monthly_summary (year_month, isp, product_type, product_group, service_type);
CREATE INDEX IF NOT EXISTS idx_sla_isp_monthly_summary_month
  ON public.sla_isp_monthly_summary (year_month);
CREATE INDEX IF NOT EXISTS idx_sla_isp_monthly_summary_isp_month
  ON public.sla_isp_monthly_summary (isp, year_month);
CREATE INDEX IF NOT EXISTS idx_sla_isp_monthly_summary_product_group_month
  ON public.sla_isp_monthly_summary (product_group, year_month);
CREATE INDEX IF NOT EXISTS idx_sla_isp_monthly_summary_product_type_month
  ON public.sla_isp_monthly_summary (product_type, year_month);
CREATE INDEX IF NOT EXISTS idx_sla_isp_monthly_summary_service_type_month
  ON public.sla_isp_monthly_summary (service_type, year_month);
