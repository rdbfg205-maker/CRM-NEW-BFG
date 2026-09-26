-- 005_sales_chain: complete the Customer→Product→PriceList→Quote→Order→Invoice→Payment→Commission chain
-- Price list: per-customer pricing + full item fields
ALTER TABLE price_list_items ADD COLUMN customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE price_list_items ADD COLUMN discount_pct REAL NOT NULL DEFAULT 0;
ALTER TABLE price_list_items ADD COLUMN tax_rate REAL NOT NULL DEFAULT 0;
ALTER TABLE price_list_items ADD COLUMN max_qty REAL;
ALTER TABLE price_list_items ADD COLUMN valid_from TEXT;
ALTER TABLE price_list_items ADD COLUMN valid_until TEXT;
CREATE INDEX IF NOT EXISTS idx_pli_list_prod ON price_list_items(price_list_id, product_id, customer_id);
ALTER TABLE price_lists ADD COLUMN description TEXT;
-- quote/order items: per-line tax rate (falls back to document tax_rate)
ALTER TABLE quote_items ADD COLUMN tax_rate REAL;
ALTER TABLE order_items ADD COLUMN tax_rate REAL;
-- Payments: bank/account/status + customer index
ALTER TABLE payments ADD COLUMN bank TEXT;
ALTER TABLE payments ADD COLUMN account TEXT;
ALTER TABLE payments ADD COLUMN status TEXT NOT NULL DEFAULT 'paid';
CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments(customer_id);
-- Commission rules: basis type, tiers, validity, target salesperson
ALTER TABLE commission_rules ADD COLUMN basis_type TEXT NOT NULL DEFAULT 'percent_sales';
ALTER TABLE commission_rules ADD COLUMN min_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE commission_rules ADD COLUMN max_amount REAL;
ALTER TABLE commission_rules ADD COLUMN valid_from TEXT;
ALTER TABLE commission_rules ADD COLUMN valid_until TEXT;
ALTER TABLE commission_rules ADD COLUMN salesperson_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
-- Commissions: real references + rule snapshot + dedup keys
ALTER TABLE commissions ADD COLUMN invoice_id INTEGER;
ALTER TABLE commissions ADD COLUMN payment_id INTEGER;
ALTER TABLE commissions ADD COLUMN customer_id INTEGER;
ALTER TABLE commissions ADD COLUMN basis TEXT;
ALTER TABLE commissions ADD COLUMN rate REAL;
CREATE INDEX IF NOT EXISTS idx_comms_rule_invoice ON commissions(rule_id, invoice_id);
CREATE INDEX IF NOT EXISTS idx_comms_rule_payment ON commissions(rule_id, payment_id);
CREATE INDEX IF NOT EXISTS idx_comms_user_period ON commissions(user_id, period, status);
