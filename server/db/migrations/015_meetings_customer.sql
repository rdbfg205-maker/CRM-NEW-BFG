-- 015: Meetings module enhancement + Customer payment terms + product categories
-- Additive only; no existing column/schema is modified. Safe & idempotent.

-- Meetings: type / mode / online link / linked contact / organizer / reminders
ALTER TABLE meetings ADD COLUMN meeting_type TEXT DEFAULT 'internal';
ALTER TABLE meetings ADD COLUMN mode TEXT DEFAULT 'inperson';
ALTER TABLE meetings ADD COLUMN online_url TEXT;
ALTER TABLE meetings ADD COLUMN contact_id INTEGER;
ALTER TABLE meetings ADD COLUMN organizer_id INTEGER;
ALTER TABLE meetings ADD COLUMN reminder_minutes INTEGER;
ALTER TABLE meetings ADD COLUMN reminder_sent_at TEXT;
ALTER TABLE meetings ADD COLUMN updated_at TEXT;

-- Customers: payment terms (نقد / اعتباری / سایر) + free-text note for "سایر"
ALTER TABLE customers ADD COLUMN payment_terms TEXT DEFAULT 'cash';
ALTER TABLE customers ADD COLUMN payment_terms_note TEXT;

-- Product-type customer categories (idempotent: only added if not already present)
INSERT INTO customer_categories (name, name_en)
SELECT 'اسفنج', 'Sponge' WHERE NOT EXISTS (SELECT 1 FROM customer_categories WHERE name = 'اسفنج');
INSERT INTO customer_categories (name, name_en)
SELECT 'فوم', 'Foam' WHERE NOT EXISTS (SELECT 1 FROM customer_categories WHERE name = 'فوم');
INSERT INTO customer_categories (name, name_en)
SELECT 'مواد اولیه', 'Raw Material' WHERE NOT EXISTS (SELECT 1 FROM customer_categories WHERE name = 'مواد اولیه');
INSERT INTO customer_categories (name, name_en)
SELECT 'تشک', 'Mattress' WHERE NOT EXISTS (SELECT 1 FROM customer_categories WHERE name = 'تشک');
INSERT INTO customer_categories (name, name_en)
SELECT 'مبل', 'Furniture' WHERE NOT EXISTS (SELECT 1 FROM customer_categories WHERE name = 'مبل');
