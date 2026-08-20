CREATE TYPE "public_rating_submission_status" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

CREATE TABLE "public_rating_submission" (
    "submission_id" UUID NOT NULL,
    "rating_token" VARCHAR(255) NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "customer_name" VARCHAR(120),
    "status" "public_rating_submission_status" NOT NULL DEFAULT 'PENDING',
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMP(3),
    "acknowledgement_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "public_rating_submission_pkey" PRIMARY KEY ("submission_id")
);

CREATE INDEX "idx_public_rating_submission_status_submitted_at"
    ON "public_rating_submission"("status", "submitted_at");

CREATE INDEX "idx_public_rating_submission_rating_token"
    ON "public_rating_submission"("rating_token");
