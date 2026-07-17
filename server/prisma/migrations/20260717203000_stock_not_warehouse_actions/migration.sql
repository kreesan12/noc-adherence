CREATE TABLE IF NOT EXISTS "stock_not_warehouse_action" (
  "id" SERIAL PRIMARY KEY,
  "template_item_id" INTEGER NOT NULL,
  "site_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  "notes" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stock_not_warehouse_action_template_item_id_fkey"
    FOREIGN KEY ("template_item_id") REFERENCES "stock_template_item"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_stock_not_warehouse_action_template_site"
  ON "stock_not_warehouse_action"("template_item_id", "site_id");

CREATE INDEX IF NOT EXISTS "idx_stock_not_warehouse_action_status"
  ON "stock_not_warehouse_action"("status");

CREATE INDEX IF NOT EXISTS "idx_stock_not_warehouse_action_site"
  ON "stock_not_warehouse_action"("site_id");
