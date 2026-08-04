ALTER TABLE "stock_template_item"
  ADD COLUMN "required_cpt_confirmed" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "required_jhb_confirmed" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "required_dbn_confirmed" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "required_pel_confirmed" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "required_bfn_confirmed" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "required_geo_confirmed" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "required_pol_confirmed" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "required_nel_confirmed" BOOLEAN NOT NULL DEFAULT true;
