ALTER TABLE "stock_template_item"
  ADD COLUMN IF NOT EXISTS "sub_section_name" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StockDivisionContactRole') THEN
    CREATE TYPE "StockDivisionContactRole" AS ENUM ('DIVISION_HEAD', 'DIVISION_ADMIN');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StockRedistributionStatus') THEN
    CREATE TYPE "StockRedistributionStatus" AS ENUM ('DRAFT', 'SENT', 'SUPERSEDED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "stock_division_contact" (
  "id" SERIAL PRIMARY KEY,
  "division" TEXT NOT NULL,
  "full_name" TEXT,
  "email" TEXT NOT NULL,
  "role" "StockDivisionContactRole" NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "receives_redistribution" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_stock_division_contact"
  ON "stock_division_contact"("division", "email", "role");
CREATE INDEX IF NOT EXISTS "idx_stock_division_contact_email_active"
  ON "stock_division_contact"("email", "is_active");
CREATE INDEX IF NOT EXISTS "idx_stock_division_contact_division_role"
  ON "stock_division_contact"("division", "role", "is_active");

ALTER TABLE "stock_division_contact"
  ADD COLUMN IF NOT EXISTS "receives_redistribution" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "stock_redistribution_run" (
  "id" SERIAL PRIMARY KEY,
  "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "source" TEXT NOT NULL DEFAULT 'daily',
  "summary" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "idx_stock_redistribution_run_generated_at"
  ON "stock_redistribution_run"("generated_at");

CREATE TABLE IF NOT EXISTS "stock_redistribution_recommendation" (
  "id" SERIAL PRIMARY KEY,
  "run_id" INTEGER NOT NULL REFERENCES "stock_redistribution_run"("id") ON DELETE CASCADE,
  "pool_key" TEXT NOT NULL,
  "stock_code" TEXT,
  "item_description" TEXT,
  "from_region" TEXT NOT NULL,
  "to_region" TEXT NOT NULL,
  "recommended_qty" INTEGER NOT NULL,
  "delta_qty" INTEGER NOT NULL DEFAULT 0,
  "unit_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status" "StockRedistributionStatus" NOT NULL DEFAULT 'DRAFT',
  "sent_at" TIMESTAMP(3),
  "sent_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_stock_redistribution_run_leg"
  ON "stock_redistribution_recommendation"("run_id", "pool_key", "from_region", "to_region");
CREATE INDEX IF NOT EXISTS "idx_stock_redistribution_status_created"
  ON "stock_redistribution_recommendation"("status", "created_at");
CREATE INDEX IF NOT EXISTS "idx_stock_redistribution_pool_leg"
  ON "stock_redistribution_recommendation"("pool_key", "from_region", "to_region");

CREATE TABLE IF NOT EXISTS "stock_daily_report" (
  "id" SERIAL PRIMARY KEY,
  "division" TEXT,
  "recipients" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "report_data" JSONB NOT NULL,
  "sent_at" TIMESTAMP(3),
  "sent_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "idx_stock_daily_report_division_created"
  ON "stock_daily_report"("division", "created_at");
