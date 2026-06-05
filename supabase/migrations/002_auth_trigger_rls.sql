-- ============================================================
-- Migration 002: Auth Trigger + Row Level Security
-- Run this in Supabase SQL Editor AFTER 001_init.sql
-- ============================================================

-- ============================================================
-- TRIGGER: Auto-create users row on auth.users insert
-- When an admin creates a user in Supabase Auth, this trigger
-- automatically creates the matching row in public.users
-- using metadata passed at user creation time.
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (
    id,
    full_name,
    email,
    role,
    department_id,
    unit_id,
    active
  )
  VALUES (
    NEW.id,
    -- Pull full_name from user metadata, fall back to email prefix
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      split_part(NEW.email, '@', 1)
    ),
    NEW.email,
    -- Pull role from metadata, default to 'nurse'
    COALESCE(NEW.raw_user_meta_data->>'role', 'nurse'),
    -- Optional department_id from metadata (cast to uuid if present)
    CASE
      WHEN NEW.raw_user_meta_data->>'department_id' IS NOT NULL
        AND NEW.raw_user_meta_data->>'department_id' != ''
      THEN (NEW.raw_user_meta_data->>'department_id')::uuid
      ELSE NULL
    END,
    -- Optional unit_id from metadata
    CASE
      WHEN NEW.raw_user_meta_data->>'unit_id' IS NOT NULL
        AND NEW.raw_user_meta_data->>'unit_id' != ''
      THEN (NEW.raw_user_meta_data->>'unit_id')::uuid
      ELSE NULL
    END,
    true
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Drop trigger if it already exists, then recreate
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_auth_user();

-- ============================================================
-- Also sync email changes from auth.users → public.users
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_auth_user_updated()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.users
  SET
    email      = NEW.email,
    full_name  = COALESCE(NEW.raw_user_meta_data->>'full_name', public.users.full_name),
    updated_at = now()
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;

CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_auth_user_updated();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE departments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_units  ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients      ENABLE ROW LEVEL SECURITY;
ALTER TABLE visits        ENABLE ROW LEVEL SECURITY;
ALTER TABLE users         ENABLE ROW LEVEL SECURITY;

-- ── departments: readable by authenticated users ──────────────
CREATE POLICY "departments_read" ON departments
  FOR SELECT
  TO authenticated
  USING (true);

-- ── health_units: readable by authenticated users ─────────────
CREATE POLICY "health_units_read" ON health_units
  FOR SELECT
  TO authenticated
  USING (true);

-- ── patients: insert/select by authenticated users ────────────
CREATE POLICY "patients_read" ON patients
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "patients_insert" ON patients
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "patients_update" ON patients
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ── visits: insert/select by authenticated users ──────────────
CREATE POLICY "visits_read" ON visits
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "visits_insert" ON visits
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ── users: each user reads their own row; supervisors read all ─
CREATE POLICY "users_read_own" ON users
  FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role = 'supervisor'
    )
  );

CREATE POLICY "users_update_own" ON users
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ============================================================
-- NOTE: The API routes use the service role key (server-admin.ts)
-- which bypasses RLS entirely. RLS protects direct Supabase
-- client access (e.g. from the browser client).
-- ============================================================

-- ============================================================
-- IMPORTANT: After running this migration, create the supervisor
-- user in Supabase Auth Dashboard with these metadata fields:
--
--   {
--     "full_name": "المشرف الرئيسي",
--     "role": "supervisor"
--   }
--
-- The trigger will auto-create the public.users row.
-- ============================================================
