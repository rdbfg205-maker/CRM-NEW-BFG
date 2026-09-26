-- 006: commissions table rebuild — remove legacy UNIQUE(user_id, period, rule_id)
-- (a rule can legitimately produce several commissions in one period: one per invoice/payment).
-- Uniqueness is now per reference record: (rule_id, invoice_id) and (rule_id, payment_id).
CREATE TABLE commissions_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  period TEXT NOT NULL,
  rule_id INTEGER,
  invoice_id INTEGER,
  payment_id INTEGER,
  customer_id INTEGER,
  basis TEXT,
  rate REAL,
  base REAL,
  amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'calculated',
  created_at TEXT
);
INSERT INTO commissions_new(id, user_id, period, rule_id, invoice_id, payment_id, customer_id, basis, rate, base, amount, status, created_at)
  SELECT id, user_id, period, rule_id, invoice_id, payment_id, customer_id, basis, rate, base, amount, status, created_at FROM commissions;
DROP TABLE commissions;
ALTER TABLE commissions_new RENAME TO commissions;
CREATE UNIQUE INDEX idx_commissions_rule_invoice ON commissions(rule_id, invoice_id) WHERE invoice_id IS NOT NULL;
CREATE UNIQUE INDEX idx_commissions_rule_payment ON commissions(rule_id, payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX idx_commissions_user_period ON commissions(user_id, period, status);
