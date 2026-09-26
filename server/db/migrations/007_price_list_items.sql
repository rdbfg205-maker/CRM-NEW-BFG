-- 007: price_list_items rebuild — allow per-customer pricing
-- legacy UNIQUE(price_list_id, product_id) blocked a second (customer-specific) row
-- for the same product. New uniqueness: (list, product, customer) with customer 0 = general.
CREATE TABLE price_list_items_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  price_list_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  customer_id INTEGER,
  price REAL NOT NULL,
  min_qty REAL DEFAULT 0,
  max_qty REAL,
  discount_pct REAL NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 0,
  valid_from TEXT,
  valid_until TEXT
);
INSERT INTO price_list_items_new(id, price_list_id, product_id, customer_id, price, min_qty, max_qty, discount_pct, tax_rate, valid_from, valid_until)
  SELECT id, price_list_id, product_id, customer_id, price, min_qty, max_qty, discount_pct, tax_rate, valid_from, valid_until FROM price_list_items;
DROP TABLE price_list_items;
ALTER TABLE price_list_items_new RENAME TO price_list_items;
CREATE UNIQUE INDEX idx_pli_unique ON price_list_items(price_list_id, product_id, COALESCE(customer_id, 0));
CREATE INDEX idx_pli_list_prod ON price_list_items(price_list_id, product_id);
