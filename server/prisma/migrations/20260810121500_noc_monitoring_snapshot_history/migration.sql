CREATE TABLE "noc_monitoring_snapshot_history" (
    "id" SERIAL NOT NULL,
    "bucket_key" TEXT NOT NULL,
    "bucket_start" TIMESTAMP(3) NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL,
    "requested_by" TEXT,
    "total_live_tickets" INTEGER NOT NULL DEFAULT 0,
    "major_outage_open" INTEGER NOT NULL DEFAULT 0,
    "major_outage_subscribers" INTEGER NOT NULL DEFAULT 0,
    "nld_outage_open" INTEGER NOT NULL DEFAULT 0,
    "nld_outage_subscribers" INTEGER NOT NULL DEFAULT 0,
    "backhaul_open" INTEGER NOT NULL DEFAULT 0,
    "vip_open" INTEGER NOT NULL DEFAULT 0,
    "tier1_open" INTEGER NOT NULL DEFAULT 0,
    "tier1_urgent_open" INTEGER NOT NULL DEFAULT 0,
    "tier2_open" INTEGER NOT NULL DEFAULT 0,
    "tier2_new_unassigned" INTEGER NOT NULL DEFAULT 0,
    "tier2_handover_open" INTEGER NOT NULL DEFAULT 0,
    "outage_new_unassigned" INTEGER NOT NULL DEFAULT 0,
    "outage_p1" INTEGER NOT NULL DEFAULT 0,
    "outage_p2" INTEGER NOT NULL DEFAULT 0,
    "outage_p3" INTEGER NOT NULL DEFAULT 0,
    "outage_p4" INTEGER NOT NULL DEFAULT 0,
    "outage_power" INTEGER NOT NULL DEFAULT 0,
    "nld_partial_event_count" INTEGER NOT NULL DEFAULT 0,
    "nld_partial_cluster_count" INTEGER NOT NULL DEFAULT 0,
    "nld_partial_not_logged_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "telephony_queues" INTEGER NOT NULL DEFAULT 0,
    "telephony_waiting" INTEGER,
    "telephony_answered" INTEGER,
    "telephony_missed" INTEGER,
    "telephony_abandon_rate" DOUBLE PRECISION,
    "telephony_avg_answer_seconds" DOUBLE PRECISION,
    "payload_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "noc_monitoring_snapshot_history_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "noc_monitoring_snapshot_history_bucket_key_key"
    ON "noc_monitoring_snapshot_history"("bucket_key");

CREATE INDEX "idx_noc_monitoring_snapshot_history_bucket_start"
    ON "noc_monitoring_snapshot_history"("bucket_start");

CREATE INDEX "idx_noc_monitoring_snapshot_history_captured_at"
    ON "noc_monitoring_snapshot_history"("captured_at");
