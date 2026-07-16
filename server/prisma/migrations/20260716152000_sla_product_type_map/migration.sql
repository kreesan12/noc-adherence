CREATE TABLE "SlaProductTypeMap" (
    "id" SERIAL NOT NULL,
    "raw_product_type" TEXT NOT NULL,
    "product_group" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 99,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlaProductTypeMap_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SlaProductTypeMap_raw_product_type_key" ON "SlaProductTypeMap"("raw_product_type");
CREATE INDEX "idx_sla_product_type_map_group" ON "SlaProductTypeMap"("product_group");
CREATE INDEX "idx_sla_product_type_map_active" ON "SlaProductTypeMap"("is_active");

INSERT INTO "SlaProductTypeMap" (
    "raw_product_type",
    "product_group",
    "sort_order"
)
SELECT
    src.product_type,
    CASE
        WHEN LOWER(src.product_type) LIKE '%home%' OR LOWER(src.product_type) LIKE '%air%' THEN 'FTTH'
        WHEN LOWER(src.product_type) LIKE '%rise%' THEN 'FTTC'
        ELSE 'FTTB'
    END AS product_group,
    CASE
        WHEN LOWER(src.product_type) LIKE '%home%' OR LOWER(src.product_type) LIKE '%air%' THEN 2
        WHEN LOWER(src.product_type) LIKE '%rise%' THEN 3
        ELSE 1
    END AS sort_order
FROM (
    SELECT DISTINCT COALESCE(NULLIF(sb.producttype, ''), 'Unknown') AS product_type
    FROM public.solidbase sb
    UNION
    SELECT DISTINCT COALESCE(NULLIF(i.producttype, ''), 'Unknown') AS product_type
    FROM public.isp_table i
) src
ON CONFLICT ("raw_product_type") DO NOTHING;
