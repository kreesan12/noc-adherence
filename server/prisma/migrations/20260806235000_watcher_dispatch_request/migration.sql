CREATE TABLE "watcher_dispatch_request" (
    "id" SERIAL NOT NULL,
    "watcher_key" TEXT NOT NULL,
    "dispatch_type" TEXT NOT NULL DEFAULT 'test',
    "target_group_ids" JSONB NOT NULL,
    "message" TEXT NOT NULL,
    "requested_by" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "watcher_dispatch_request_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "watcher_dispatch_request_status_created_at_idx" ON "watcher_dispatch_request"("status", "created_at");
CREATE INDEX "watcher_dispatch_request_watcher_key_created_at_idx" ON "watcher_dispatch_request"("watcher_key", "created_at");
