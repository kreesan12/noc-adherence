\echo [INFO] Starting data retention trim older than :cutoff_date
\echo [INFO] solidbase is intentionally excluded

BEGIN;

DELETE FROM reporting
WHERE year_month < :'cutoff_month';

DELETE FROM isp_table
WHERE year_month < :'cutoff_month';

DELETE FROM sip_table
WHERE sip_month < :'cutoff_month';

DELETE FROM servicelevels
WHERE year_month < :'cutoff_month';

DELETE FROM tickets_output
WHERE COALESCE(impact_stop_time, created_date) < :'cutoff_date'::timestamp;

DELETE FROM zendesktickets
WHERE COALESCE(stoptime, ticketcreated) < :'cutoff_date'::timestamp;

DELETE FROM outage_resolvers
WHERE year_month < :'cutoff_month';

DELETE FROM outages_outage
WHERE COALESCE(impact_stop, impact_start) < :'cutoff_date'::timestamp;

DELETE FROM outagezendeskrefs2
WHERE COALESCE(impact_stop, impact_start) < :'cutoff_date'::timestamp;

COMMIT;

\echo [INFO] Data retention trim completed
