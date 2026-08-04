CREATE TABLE IF NOT EXISTS "stock_run_rate_snapshot" (
  "id" SERIAL PRIMARY KEY,
  "snapshot_key" TEXT NOT NULL DEFAULT 'current',
  "latest_import_run_id" INTEGER NULL,
  "latest_snapshot_date" TIMESTAMP(3) NULL,
  "default_month" TEXT NULL,
  "month_options_json" JSONB NOT NULL,
  "summary_json" JSONB NOT NULL,
  "month_summary_json" JSONB NOT NULL,
  "rows_json" JSONB NOT NULL,
  "has_enough_history" BOOLEAN NOT NULL DEFAULT false,
  "seeded_current_snapshot" BOOLEAN NOT NULL DEFAULT false,
  "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stock_run_rate_snapshot_latest_import_run_id_fkey"
    FOREIGN KEY ("latest_import_run_id") REFERENCES "stock_import_run"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_stock_run_rate_snapshot_key"
  ON "stock_run_rate_snapshot"("snapshot_key");
