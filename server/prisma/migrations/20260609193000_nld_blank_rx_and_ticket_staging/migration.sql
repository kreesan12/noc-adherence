CREATE TABLE "blank_daily_light_issue" (
    "id" SERIAL NOT NULL,
    "circuit_id" INTEGER NOT NULL,
    "side" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "raw_rx" TEXT,
    "mnemonic" TEXT,
    "router_name" TEXT,
    "parsed_code" TEXT,
    "source_email_id" TEXT,
    "sample_time" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blank_daily_light_issue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "staged_zendesk_ticket" (
    "id" SERIAL NOT NULL,
    "reference" TEXT NOT NULL,
    "circuit_id" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "latest_comment_body" TEXT,
    "priority" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "group_name" TEXT NOT NULL DEFAULT 'NOC Tier3',
    "ticket_type" TEXT NOT NULL DEFAULT 'task',
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "breach_side" TEXT,
    "breach_level" INTEGER NOT NULL DEFAULT 1,
    "initial_light_level" DOUBLE PRECISION,
    "latest_light_level" DOUBLE PRECISION,
    "delta_light_level" DOUBLE PRECISION,
    "date_created" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opened_at" TIMESTAMP(3),
    "escalated_at" TIMESTAMP(3),
    "last_evaluated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staged_zendesk_ticket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "staged_zendesk_ticket_comment" (
    "id" SERIAL NOT NULL,
    "ticket_id" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "event_kind" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staged_zendesk_ticket_comment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_blank_daily_light_issue" ON "blank_daily_light_issue"("circuit_id", "side", "sample_time", "mnemonic");
CREATE INDEX "idx_blank_daily_light_issue_sample_time" ON "blank_daily_light_issue"("sample_time");
CREATE INDEX "idx_blank_daily_light_issue_parsed_code" ON "blank_daily_light_issue"("parsed_code");

CREATE UNIQUE INDEX "staged_zendesk_ticket_reference_key" ON "staged_zendesk_ticket"("reference");
CREATE UNIQUE INDEX "staged_zendesk_ticket_circuit_id_key" ON "staged_zendesk_ticket"("circuit_id");
CREATE INDEX "idx_staged_zendesk_ticket_priority" ON "staged_zendesk_ticket"("priority");
CREATE INDEX "idx_staged_zendesk_ticket_status" ON "staged_zendesk_ticket"("status");

CREATE INDEX "idx_staged_zendesk_ticket_comment_ticket_created" ON "staged_zendesk_ticket_comment"("ticket_id", "created_at");

ALTER TABLE "blank_daily_light_issue"
ADD CONSTRAINT "blank_daily_light_issue_circuit_id_fkey"
FOREIGN KEY ("circuit_id") REFERENCES "Circuit"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "staged_zendesk_ticket"
ADD CONSTRAINT "staged_zendesk_ticket_circuit_id_fkey"
FOREIGN KEY ("circuit_id") REFERENCES "Circuit"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "staged_zendesk_ticket_comment"
ADD CONSTRAINT "staged_zendesk_ticket_comment_ticket_id_fkey"
FOREIGN KEY ("ticket_id") REFERENCES "staged_zendesk_ticket"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
