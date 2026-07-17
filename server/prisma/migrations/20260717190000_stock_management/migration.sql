DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StockTemplateRowType') THEN
    CREATE TYPE "StockTemplateRowType" AS ENUM ('SECTION', 'ITEM');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "stock_template_item" (
  "id" SERIAL PRIMARY KEY,
  "row_order" INTEGER NOT NULL,
  "row_type" "StockTemplateRowType" NOT NULL,
  "section_name" TEXT,
  "item_description" TEXT,
  "stock_code" TEXT,
  "unit_price_zar" TEXT,
  "unit_price_usd" TEXT,
  "division" TEXT,
  "required_cpt" INTEGER NOT NULL DEFAULT 0,
  "required_jhb" INTEGER NOT NULL DEFAULT 0,
  "required_dbn" INTEGER NOT NULL DEFAULT 0,
  "required_pel" INTEGER NOT NULL DEFAULT 0,
  "required_bfn" INTEGER NOT NULL DEFAULT 0,
  "required_geo" INTEGER NOT NULL DEFAULT 0,
  "required_pol" INTEGER NOT NULL DEFAULT 0,
  "required_nel" INTEGER NOT NULL DEFAULT 0,
  "manual_match_item_no" TEXT,
  "manual_match_description" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "stock_template_item_row_order_key"
  ON "stock_template_item"("row_order");
CREATE INDEX IF NOT EXISTS "idx_stock_template_item_row_type"
  ON "stock_template_item"("row_type");
CREATE INDEX IF NOT EXISTS "idx_stock_template_item_division"
  ON "stock_template_item"("division");

CREATE TABLE IF NOT EXISTS "stock_import_run" (
  "id" SERIAL PRIMARY KEY,
  "report_date" TIMESTAMP(3),
  "source_filename" TEXT,
  "source_email_id" TEXT,
  "source_subject" TEXT,
  "status_row_count" INTEGER NOT NULL DEFAULT 0,
  "matched_item_count" INTEGER NOT NULL DEFAULT 0,
  "low_confidence_count" INTEGER NOT NULL DEFAULT 0,
  "unresolved_item_count" INTEGER NOT NULL DEFAULT 0,
  "unknown_site_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_stock_import_run_created_at"
  ON "stock_import_run"("created_at");

CREATE TABLE IF NOT EXISTS "stock_status_current_row" (
  "id" SERIAL PRIMARY KEY,
  "import_run_id" INTEGER NOT NULL,
  "item_no" TEXT NOT NULL,
  "item_description" TEXT NOT NULL,
  "item_short_name" TEXT,
  "item_class" TEXT,
  "site_id" TEXT,
  "item_generic_description" TEXT,
  "item_tracking_option" TEXT,
  "qty_on_order" INTEGER NOT NULL DEFAULT 0,
  "qty_allocated" INTEGER NOT NULL DEFAULT 0,
  "qty_on_hand" INTEGER NOT NULL DEFAULT 0,
  "qty_available" INTEGER NOT NULL DEFAULT 0,
  "valuation_text" TEXT,
  "region_hint" TEXT,
  "is_warehouse_like" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stock_status_current_row_import_run_id_fkey"
    FOREIGN KEY ("import_run_id") REFERENCES "stock_import_run"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_stock_status_current_row_item_no"
  ON "stock_status_current_row"("item_no");
CREATE INDEX IF NOT EXISTS "idx_stock_status_current_row_site_id"
  ON "stock_status_current_row"("site_id");
CREATE INDEX IF NOT EXISTS "idx_stock_status_current_row_region_hint"
  ON "stock_status_current_row"("region_hint");
CREATE INDEX IF NOT EXISTS "idx_stock_status_current_row_import_run_id"
  ON "stock_status_current_row"("import_run_id");
