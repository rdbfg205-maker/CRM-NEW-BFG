-- 008: fix commissions unique scope — an invoice can have several payments,
-- each with its own commission (percent_collected basis). The invoice-level
-- uniqueness only applies to invoice-based commissions (payment_id IS NULL).
DROP INDEX idx_commissions_rule_invoice;
CREATE UNIQUE INDEX idx_commissions_rule_invoice ON commissions(rule_id, invoice_id) WHERE invoice_id IS NOT NULL AND payment_id IS NULL;
