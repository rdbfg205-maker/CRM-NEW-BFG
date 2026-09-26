-- 016: Production additions (SELEN-CARPET-3007) — ADDITIVE only, no existing column/table altered.

-- Item 10: Product dimensions (cm) + weight (kg)
ALTER TABLE products ADD COLUMN length_cm REAL;
ALTER TABLE products ADD COLUMN width_cm REAL;
ALTER TABLE products ADD COLUMN height_cm REAL;
ALTER TABLE products ADD COLUMN weight_kg REAL;

-- Item 22: Complaint linked product + referral team (e.g. CFT)
ALTER TABLE complaints ADD COLUMN product_id INTEGER;
ALTER TABLE complaints ADD COLUMN referred_team TEXT;

-- Item 5: Price List payment stage per product (cash / 3_month / 6_month / custom)
ALTER TABLE price_list_items ADD COLUMN payment_stage TEXT DEFAULT 'cash';
