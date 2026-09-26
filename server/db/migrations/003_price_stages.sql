-- 003: price-list enhancements + pipeline stage probability
ALTER TABLE price_lists ADD COLUMN valid_from TEXT;
ALTER TABLE price_lists ADD COLUMN valid_until TEXT;
ALTER TABLE price_lists ADD COLUMN is_default INTEGER DEFAULT 0;
ALTER TABLE pipeline_stages ADD COLUMN probability INTEGER;
