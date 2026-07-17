CREATE TABLE IF NOT EXISTS "stock_status_history_row" (
  "id" SERIAL NOT NULL,
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

  CONSTRAINT "stock_status_history_row_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_status_history_row_import_run_id_fkey"
    FOREIGN KEY ("import_run_id") REFERENCES "stock_import_run"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_stock_status_history_row_item_no"
  ON "stock_status_history_row"("item_no");

CREATE INDEX IF NOT EXISTS "idx_stock_status_history_row_site_id"
  ON "stock_status_history_row"("site_id");

CREATE INDEX IF NOT EXISTS "idx_stock_status_history_row_region_hint"
  ON "stock_status_history_row"("region_hint");

CREATE INDEX IF NOT EXISTS "idx_stock_status_history_row_import_run_id"
  ON "stock_status_history_row"("import_run_id");
