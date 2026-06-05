-- ============================================================
-- نظام مبادرة الأمراض المزمنة - Supabase Migration
-- Run this in Supabase SQL Editor
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- Table: departments
-- ============================================================
CREATE TABLE IF NOT EXISTS departments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text UNIQUE NOT NULL,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- ============================================================
-- Table: health_units
-- ============================================================
CREATE TABLE IF NOT EXISTS health_units (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text UNIQUE NOT NULL,
  name            text NOT NULL,
  department_id   uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  daily_target    integer DEFAULT 15,
  monthly_target  integer DEFAULT 300,
  active          boolean DEFAULT true,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- ============================================================
-- Table: patients
-- ============================================================
CREATE TABLE IF NOT EXISTS patients (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  national_id       text UNIQUE NOT NULL,
  full_name         text NOT NULL,
  phone             text,
  birth_date        text,
  age               integer,
  gender            text CHECK (gender IN ('ذكر', 'أنثى')),
  governorate       text,
  first_visit_date  timestamptz DEFAULT now(),
  active            boolean DEFAULT true,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

-- ============================================================
-- Table: visits
-- ============================================================
CREATE TABLE IF NOT EXISTS visits (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  unit_id       uuid NOT NULL REFERENCES health_units(id) ON DELETE CASCADE,
  visit_type    text CHECK (visit_type IN ('أول مرة', 'متردد')),
  visit_date    timestamptz DEFAULT now(),
  weight        numeric,
  height        numeric,
  sugar_type    text CHECK (sugar_type IN ('صائم', 'عشوائي')),
  sugar_level   numeric,
  hba1c         numeric,
  systolic      numeric,
  diastolic     numeric,
  cholesterol   numeric,
  triglycerides numeric,
  ldl           numeric,
  hdl           numeric,
  creatinine    numeric,
  egfr          numeric,
  referred      boolean DEFAULT false,
  referral_dest text,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  UNIQUE (patient_id, unit_id, visit_date)
);

-- ============================================================
-- Table: users (mirrors auth.users with role data)
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name      text NOT NULL,
  email          text UNIQUE NOT NULL,
  role           text NOT NULL CHECK (role IN ('nurse', 'supervisor')),
  department_id  uuid REFERENCES departments(id),
  unit_id        uuid REFERENCES health_units(id),
  active         boolean DEFAULT true,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

-- ============================================================
-- Indexes for performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_visits_unit_id     ON visits(unit_id);
CREATE INDEX IF NOT EXISTS idx_visits_patient_id  ON visits(patient_id);
CREATE INDEX IF NOT EXISTS idx_visits_visit_date  ON visits(visit_date);
CREATE INDEX IF NOT EXISTS idx_patients_national_id ON patients(national_id);
CREATE INDEX IF NOT EXISTS idx_health_units_dept  ON health_units(department_id);

-- ============================================================
-- Seed: Sample departments for Sohag governorate
-- ============================================================
INSERT INTO departments (name) VALUES
  ('إدارة سوهاج الصحية'),
  ('إدارة طهطا الصحية'),
  ('إدارة جهينة الصحية'),
  ('إدارة المراغة الصحية'),
  ('إدارة ساقلتة الصحية'),
  ('إدارة البلينا الصحية'),
  ('إدارة المنشاة الصحية'),
  ('إدارة دار السلام الصحية'),
  ('إدارة أخميم الصحية'),
  ('إدارة العسيرات الصحية')
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- Seed: Sample health units
-- ============================================================
INSERT INTO health_units (code, name, department_id, daily_target, monthly_target)
SELECT 'SHG-001', 'وحدة صحية سوهاج المركزية', id, 20, 400 FROM departments WHERE name = 'إدارة سوهاج الصحية'
ON CONFLICT (code) DO NOTHING;

INSERT INTO health_units (code, name, department_id, daily_target, monthly_target)
SELECT 'SHG-002', 'وحدة صحية كوم أوشيم', id, 15, 300 FROM departments WHERE name = 'إدارة سوهاج الصحية'
ON CONFLICT (code) DO NOTHING;

INSERT INTO health_units (code, name, department_id, daily_target, monthly_target)
SELECT 'TAH-001', 'وحدة صحية طهطا المركزية', id, 18, 350 FROM departments WHERE name = 'إدارة طهطا الصحية'
ON CONFLICT (code) DO NOTHING;

INSERT INTO health_units (code, name, department_id, daily_target, monthly_target)
SELECT 'TAH-002', 'وحدة صحية البيضاء', id, 12, 250 FROM departments WHERE name = 'إدارة طهطا الصحية'
ON CONFLICT (code) DO NOTHING;

INSERT INTO health_units (code, name, department_id, daily_target, monthly_target)
SELECT 'JUH-001', 'وحدة صحية جهينة المركزية', id, 15, 300 FROM departments WHERE name = 'إدارة جهينة الصحية'
ON CONFLICT (code) DO NOTHING;

INSERT INTO health_units (code, name, department_id, daily_target, monthly_target)
SELECT 'MAR-001', 'وحدة صحية المراغة المركزية', id, 15, 300 FROM departments WHERE name = 'إدارة المراغة الصحية'
ON CONFLICT (code) DO NOTHING;

INSERT INTO health_units (code, name, department_id, daily_target, monthly_target)
SELECT 'SAQ-001', 'وحدة صحية ساقلتة المركزية', id, 15, 300 FROM departments WHERE name = 'إدارة ساقلتة الصحية'
ON CONFLICT (code) DO NOTHING;

INSERT INTO health_units (code, name, department_id, daily_target, monthly_target)
SELECT 'BAL-001', 'وحدة صحية البلينا المركزية', id, 15, 300 FROM departments WHERE name = 'إدارة البلينا الصحية'
ON CONFLICT (code) DO NOTHING;

INSERT INTO health_units (code, name, department_id, daily_target, monthly_target)
SELECT 'MAN-001', 'وحدة صحية المنشاة المركزية', id, 15, 300 FROM departments WHERE name = 'إدارة المنشاة الصحية'
ON CONFLICT (code) DO NOTHING;

INSERT INTO health_units (code, name, department_id, daily_target, monthly_target)
SELECT 'DAR-001', 'وحدة صحية دار السلام المركزية', id, 15, 300 FROM departments WHERE name = 'إدارة دار السلام الصحية'
ON CONFLICT (code) DO NOTHING;

INSERT INTO health_units (code, name, department_id, daily_target, monthly_target)
SELECT 'AKH-001', 'وحدة صحية أخميم المركزية', id, 15, 300 FROM departments WHERE name = 'إدارة أخميم الصحية'
ON CONFLICT (code) DO NOTHING;

INSERT INTO health_units (code, name, department_id, daily_target, monthly_target)
SELECT 'ASR-001', 'وحدة صحية العسيرات المركزية', id, 15, 300 FROM departments WHERE name = 'إدارة العسيرات الصحية'
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- NOTE: Create supervisor user in Supabase Auth Dashboard:
-- Email: supervisor@example.com
-- Password: admin123
-- Then insert into users table:
-- INSERT INTO users (id, full_name, email, role)
-- VALUES ('<auth_user_id>', 'المشرف الرئيسي', 'supervisor@example.com', 'supervisor');
-- ============================================================
