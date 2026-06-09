DROP INDEX IF EXISTS "uq_blank_daily_light_issue";

ALTER TABLE "blank_daily_light_issue"
  ALTER COLUMN "circuit_id" DROP NOT NULL;

DROP INDEX IF EXISTS "idx_blank_daily_light_issue_sample_time";
DROP INDEX IF EXISTS "idx_blank_daily_light_issue_parsed_code";

CREATE UNIQUE INDEX "uq_blank_daily_light_issue"
  ON "blank_daily_light_issue"("sample_time", "mnemonic", "router_name");

CREATE INDEX "idx_blank_daily_light_issue_sample_time"
  ON "blank_daily_light_issue"("sample_time");

CREATE INDEX "idx_blank_daily_light_issue_parsed_code"
  ON "blank_daily_light_issue"("parsed_code");
