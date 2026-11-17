-- Additive, isolated module. Does not modify operational NLD/Circuit/Node tables.
CREATE SCHEMA IF NOT EXISTS network_inventory;
CREATE TABLE IF NOT EXISTS network_inventory.state (
  id integer PRIMARY KEY CHECK (id = 1), revision integer NOT NULL DEFAULT 0
);
INSERT INTO network_inventory.state (id) VALUES (1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS network_inventory.imports (
  id text PRIMARY KEY, filename text NOT NULL, sha256 text NOT NULL,
  status text NOT NULL CHECK (status IN ('preview','applied')), payload jsonb NOT NULL,
  baseline_revision integer NOT NULL, actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), applied_at timestamptz
);
CREATE TABLE IF NOT EXISTS network_inventory.source_rows (
  import_id text NOT NULL REFERENCES network_inventory.imports(id), sheet text NOT NULL,
  row_number integer NOT NULL, raw_data jsonb NOT NULL,
  PRIMARY KEY(import_id, sheet, row_number)
);
DO $$ DECLARE entity text; BEGIN
  FOREACH entity IN ARRAY ARRAY['sites','devices','ladders','memberships','backhauls','segments','olts'] LOOP
    EXECUTE format('CREATE TABLE IF NOT EXISTS network_inventory.%I (
      id text PRIMARY KEY, data jsonb NOT NULL, imported_data jsonb NOT NULL,
      source_refs jsonb NOT NULL DEFAULT ''[]''::jsonb, version integer NOT NULL DEFAULT 1,
      updated_at timestamptz NOT NULL DEFAULT now()
    )', entity);
  END LOOP;
END $$;
CREATE INDEX IF NOT EXISTS devices_site_idx ON network_inventory.devices ((data->>'siteId'));
CREATE INDEX IF NOT EXISTS memberships_ladder_idx ON network_inventory.memberships ((data->>'ladderId'));
CREATE INDEX IF NOT EXISTS memberships_site_idx ON network_inventory.memberships ((data->>'siteId'));
CREATE INDEX IF NOT EXISTS segments_backhaul_idx ON network_inventory.segments ((data->>'backhaulId'));
CREATE INDEX IF NOT EXISTS backhauls_code_idx ON network_inventory.backhauls ((data->>'code'));
CREATE TABLE IF NOT EXISTS network_inventory.changes (
  id text PRIMARY KEY, kind text NOT NULL, record_id text NOT NULL, action text NOT NULL,
  actor text NOT NULL, note text NOT NULL, before_data jsonb, after_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS changes_subject_idx ON network_inventory.changes(kind, record_id, created_at DESC);
CREATE TABLE IF NOT EXISTS network_inventory.reviews (
  kind text NOT NULL, record_id text NOT NULL, fingerprint text NOT NULL,
  actor text NOT NULL, note text NOT NULL, reviewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(kind, record_id)
);
CREATE TABLE IF NOT EXISTS network_inventory.issue_reviews (
  id text PRIMARY KEY, evidence_hash text NOT NULL, actor text NOT NULL, note text NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now()
);
