CREATE TABLE "whatsapp_group_directory" (
    "jid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "participant_count" INTEGER NOT NULL DEFAULT 0,
    "session_id" TEXT,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_group_directory_pkey" PRIMARY KEY ("jid")
);

CREATE INDEX "whatsapp_group_directory_name_idx" ON "whatsapp_group_directory"("name");
CREATE INDEX "whatsapp_group_directory_last_seen_at_idx" ON "whatsapp_group_directory"("last_seen_at");
