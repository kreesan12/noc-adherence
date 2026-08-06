CREATE TABLE "watcher_alert_log" (
    "id" SERIAL NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "watcher_key" TEXT NOT NULL,
    "alert_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "payload" JSONB,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "watcher_alert_log_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "watcher_alert_log_dedupe_key_key" ON "watcher_alert_log"("dedupe_key");
CREATE INDEX "watcher_alert_log_watcher_key_sent_at_idx" ON "watcher_alert_log"("watcher_key", "sent_at");
