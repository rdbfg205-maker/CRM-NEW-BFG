-- ============ 026 — FINAL MASTER AUDIT (additive, migration-safe) ============
-- No table duplication, no data loss. Only new columns on existing tables.

-- Meeting Action Items (Section 13): each meeting decision/action is a real Task.
-- tasks.follower_id = پیگیری‌کننده (may differ from the responsible assignee_id)
-- tasks.result      = نتیجهٔ انجام‌شده
ALTER TABLE tasks ADD COLUMN follower_id INTEGER;
ALTER TABLE tasks ADD COLUMN result TEXT;

-- Voice Contact registration (Section 1): track that a contact was created
-- by the Voice Assistant (Source = 'Voice Assistant'), same as customers.source.
ALTER TABLE customer_contacts ADD COLUMN source TEXT;
