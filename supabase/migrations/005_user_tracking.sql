-- ============================================================
-- Migration 005: User Tracking Enhancements
-- Adds last_login to users, created_by to visits
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Add last_login to public.users
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_login timestamptz;

-- 2. Add created_by to public.visits
ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.users(id);

-- 3. Create or update trigger to sync last_sign_in_at from auth.users
CREATE OR REPLACE FUNCTION public.sync_last_login()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.last_sign_in_at IS DISTINCT FROM OLD.last_sign_in_at THEN
    UPDATE public.users SET last_login = NEW.last_sign_in_at WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

-- Drop trigger if exists
DROP TRIGGER IF EXISTS sync_last_login_trigger ON auth.users;

-- Recreate trigger
CREATE TRIGGER sync_last_login_trigger
AFTER UPDATE ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.sync_last_login();

-- 4. Set initial last_login from auth.users for existing users
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id, last_sign_in_at FROM auth.users WHERE last_sign_in_at IS NOT NULL LOOP
    UPDATE public.users SET last_login = r.last_sign_in_at WHERE id = r.id;
  END LOOP;
END;
$$;
