-- 022: customer portal (restricted self-service) + structured complaint bank
-- additive only: new columns + one new dictionary table; nothing existing is altered

-- ---------- 1) customer portal credentials & access ----------
ALTER TABLE customers ADD COLUMN portal_username TEXT DEFAULT '';
ALTER TABLE customers ADD COLUMN portal_password_hash TEXT DEFAULT '';
ALTER TABLE customers ADD COLUMN portal_enabled INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_customers_portal_username ON customers(portal_username);

-- ---------- 2) structured complaint bank fields ----------
ALTER TABLE complaints ADD COLUMN defect_family TEXT DEFAULT '';        -- foam_sponge | polyurethane | foam_mattress | bed_related | other
ALTER TABLE complaints ADD COLUMN defect_type TEXT DEFAULT '';          -- structured defect feature (from bank)
ALTER TABLE complaints ADD COLUMN probable_cause TEXT DEFAULT '';       -- علت احتمالی (manual)
ALTER TABLE complaints ADD COLUMN corrective_action TEXT DEFAULT '';    -- اقدام اصلاحی
ALTER TABLE complaints ADD COLUMN preventive_action TEXT DEFAULT '';    -- اقدام پیشگیرانه
ALTER TABLE complaints ADD COLUMN review_result TEXT DEFAULT '';        -- نتیجه بررسی

-- ---------- 3) complaint defect bank (structured defect dictionary) ----------
CREATE TABLE IF NOT EXISTS complaint_defect_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family TEXT NOT NULL,
  family_fa TEXT NOT NULL,
  defect_key TEXT NOT NULL,
  defect_fa TEXT NOT NULL
);

-- فوم و اسفنج
INSERT INTO complaint_defect_types (family, family_fa, defect_key, defect_fa) VALUES
('foam_sponge', 'فوم و اسفنج', 'density', 'دانسیته (چگالی)'),
('foam_sponge', 'فوم و اسفنج', 'hardness', 'سختی / شوری'),
('foam_sponge', 'فوم و اسفنج', 'crush_set', 'مانایی فشار (Crush Set)'),
('foam_sponge', 'فوم و اسفنج', 'tensile', 'کشش (Tensile)'),
('foam_sponge', 'فوم و اسفنج', 'elongation', 'تکانه/کشسانی (Elongation)'),
('foam_sponge', 'فوم و اسفنج', 'tear', 'مقاومت پارگی (Tear)'),
('foam_sponge', 'فوم و اسفنج', 'compression', 'فشار جانبی (Compression)'),
('foam_sponge', 'فوم و اسفنج', 'dimensions', 'ابعاد'),
('foam_sponge', 'فوم و اسفنج', 'recovery', 'برگشت‌پذیری'),
('foam_sponge', 'فوم و اسفنج', 'cell_structure', 'سلول‌بندی'),
('foam_sponge', 'فوم و اسفنج', 'color_change', 'تغییر رنگ'),
('foam_sponge', 'فوم و اسفنج', 'odor', 'بو'),
('foam_sponge', 'فوم و اسفنج', 'shrinkage', 'جمع‌شدگی'),
('foam_sponge', 'فوم و اسفنج', 'warping', 'تاب‌برداشتگی'),
('foam_sponge', 'فوم و اسفنج', 'moisture', 'رطوبت'),
('foam_sponge', 'فوم و اسفنج', 'weight', 'وزن'),
('foam_sponge', 'فوم و اسفنج', 'uniformity', 'یکنواختی'),
('foam_sponge', 'فوم و اسفنج', 'packaging', 'بسته‌بندی'),
('foam_sponge', 'فوم و اسفنج', 'other_quality', 'سایر موارد کیفی');
-- مواد اولیه پلی‌یورتان
INSERT INTO complaint_defect_types (family, family_fa, defect_key, defect_fa) VALUES
('polyurethane', 'مواد اولیه پلی‌یورتان', 'polyol', 'پلی‌ال (Polyol)'),
('polyurethane', 'مواد اولیه پلی‌یورتان', 'mdi_tdi', 'MDI / TDI'),
('polyurethane', 'مواد اولیه پلی‌یورتان', 'viscosity', 'ویسکوزیته'),
('polyurethane', 'مواد اولیه پلی‌یورتان', 'density_raw', 'دانسیته'),
('polyurethane', 'مواد اولیه پلی‌یورتان', 'nco', 'درصد NCO'),
('polyurethane', 'مواد اولیه پلی‌یورتان', 'moisture_raw', 'رطوبت'),
('polyurethane', 'مواد اولیه پلی‌یورتان', 'color', 'رنگ'),
('polyurethane', 'مواد اولیه پلی‌یورتان', 'purity', 'خلوص'),
('polyurethane', 'مواد اولیه پلی‌یورتان', 'mix_ratio', 'نسبت اختلاط'),
('polyurethane', 'مواد اولیه پلی‌یورتان', 'functionality', 'عملکرد (Functionality)'),
('polyurethane', 'مواد اولیه پلی‌یورتان', 'packaging_raw', 'بسته‌بندی'),
('polyurethane', 'مواد اولیه پلی‌یورتان', 'leak', 'نشتی'),
('polyurethane', 'مواد اولیه پلی‌یورتان', 'labeling', 'برچسب‌گذاری'),
('polyurethane', 'مواد اولیه پلی‌یورتان', 'tech_spec', 'مشخصات فنی'),
('polyurethane', 'مواد اولیه پلی‌یورتان', 'shelf_life', 'تاریخ انقضا / ماندگاری');
-- تشک تمام‌فوم
INSERT INTO complaint_defect_types (family, family_fa, defect_key, defect_fa) VALUES
('foam_mattress', 'تشک تمام‌فوم', 'mattress_dimensions', 'ابعاد'),
('foam_mattress', 'تشک تمام‌فوم', 'layer_density', 'دانسیته لایه‌ها'),
('foam_mattress', 'تشک تمام‌فوم', 'mattress_hardness', 'سختی'),
('foam_mattress', 'تشک تمام‌فوم', 'height', 'ارتفاع'),
('foam_mattress', 'تشک تمام‌فوم', 'sag', 'فرورفتگی'),
('foam_mattress', 'تشک تمام‌فوم', 'recovery_mattress', 'برگشت‌پذیری'),
('foam_mattress', 'تشک تمام‌فوم', 'tear_mattress', 'پارگی'),
('foam_mattress', 'تشک تمام‌فوم', 'deformation', 'تغییر شکل'),
('foam_mattress', 'تشک تمام‌فوم', 'odor_mattress', 'بو'),
('foam_mattress', 'تشک تمام‌فوم', 'cover', 'روکش'),
('foam_mattress', 'تشک تمام‌فوم', 'stitching', 'دوخت'),
('foam_mattress', 'تشک تمام‌فوم', 'packaging_mattress', 'بسته‌بندی'),
('foam_mattress', 'تشک تمام‌فوم', 'durability', 'دوام'),
('foam_mattress', 'تشک تمام‌فوم', 'edge_support', 'استحکام لبه');
-- تشک و محصولات مرتبط با تخت
INSERT INTO complaint_defect_types (family, family_fa, defect_key, defect_fa) VALUES
('bed_related', 'تشک و محصولات مرتبط با تخت', 'bed_dimensions', 'ابعاد'),
('bed_related', 'تشک و محصولات مرتبط با تخت', 'assembly', 'مونتاژ'),
('bed_related', 'تشک و محصولات مرتبط با تخت', 'parts_quality', 'کیفیت قطعات'),
('bed_related', 'تشک و محصولات مرتبط با تخت', 'strength', 'استحکام'),
('bed_related', 'تشک و محصولات مرتبط با تخت', 'appearance', 'ظاهر'),
('bed_related', 'تشک و محصولات مرتبط با تخت', 'color_bed', 'رنگ'),
('bed_related', 'تشک و محصولات مرتبط با تخت', 'cover_bed', 'روکش'),
('bed_related', 'تشک و محصولات مرتبط با تخت', 'packaging_bed', 'بسته‌بندی'),
('bed_related', 'تشک و محصولات مرتبط با تخت', 'shipping_damage', 'آسیب حمل و نقل');
