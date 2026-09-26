-- ============ 027 — notification actor (bell "ایجادکننده" requirement) ============
-- Additive: who created each notification (user id; 0 = system). No data loss.
ALTER TABLE notifications ADD COLUMN created_by INTEGER DEFAULT 0;
