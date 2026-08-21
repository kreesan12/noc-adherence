CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "public_rating_submission"
ADD COLUMN "rating_token_hash" CHAR(64);

UPDATE "public_rating_submission"
SET "rating_token_hash" = encode(digest("rating_token", 'sha256'), 'hex')
WHERE "rating_token_hash" IS NULL;

WITH ranked AS (
    SELECT
        "submission_id",
        ROW_NUMBER() OVER (
            PARTITION BY "rating_token_hash"
            ORDER BY
                CASE "status"
                    WHEN 'ACCEPTED' THEN 1
                    WHEN 'PENDING' THEN 2
                    WHEN 'REJECTED' THEN 3
                    ELSE 4
                END,
                COALESCE("acknowledged_at", "submitted_at", "created_at") DESC,
                "created_at" DESC,
                "submission_id" DESC
        ) AS row_rank
    FROM "public_rating_submission"
)
DELETE FROM "public_rating_submission" prs
USING ranked
WHERE prs."submission_id" = ranked."submission_id"
  AND ranked.row_rank > 1;

ALTER TABLE "public_rating_submission"
ALTER COLUMN "rating_token_hash" SET NOT NULL;

ALTER TABLE "public_rating_submission"
ADD CONSTRAINT "uq_public_rating_submission_rating_token_hash"
UNIQUE ("rating_token_hash");
