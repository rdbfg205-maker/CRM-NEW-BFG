-- 017: allow multiple payment stages (cash / 3_month / 6_month / custom) per product
-- in a price list. The legacy unique index blocked a second stage for the same product,
-- so each stage is now part of the uniqueness key (COALESCE for nulls).
DROP INDEX IF EXISTS idx_pli_unique;
CREATE UNIQUE INDEX idx_pli_unique ON price_list_items(price_list_id, product_id, COALESCE(customer_id, 0), COALESCE(payment_stage, 'cash'));
