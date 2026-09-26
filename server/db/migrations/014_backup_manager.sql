-- 014_backup_manager.sql — Backup Manager enhancements (additive; touches nothing existing)
ALTER TABLE backups ADD COLUMN status TEXT DEFAULT 'success';   -- success | failed
ALTER TABLE backups ADD COLUMN error TEXT DEFAULT '';
