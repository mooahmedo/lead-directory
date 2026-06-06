-- ============================================================
-- Migration 004: User Management Enhancements
-- Adds username, phone, must_change_password, audit_logs
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Add new columns to public.users
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS username text UNIQUE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS must_change_password boolean DEFAULT false;

-- 2. Create audit_logs table
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  performed_by uuid REFERENCES public.users(id),
  details jsonb,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS on audit_logs (service role bypasses this anyway)
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_logs_supervisor_all" ON public.audit_logs
  FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'supervisor')
  );

-- 3. Update auth user created trigger to include username, phone, must_change_password
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (
    id, full_name, email, role,
    department_id, unit_id, active,
    username, phone, must_change_password
  )
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'nurse'),
    CASE
      WHEN NEW.raw_user_meta_data->>'department_id' IS NOT NULL
        AND NEW.raw_user_meta_data->>'department_id' != ''
      THEN (NEW.raw_user_meta_data->>'department_id')::uuid ELSE NULL
    END,
    CASE
      WHEN NEW.raw_user_meta_data->>'unit_id' IS NOT NULL
        AND NEW.raw_user_meta_data->>'unit_id' != ''
      THEN (NEW.raw_user_meta_data->>'unit_id')::uuid ELSE NULL
    END,
    true,
    NEW.raw_user_meta_data->>'username',
    NEW.raw_user_meta_data->>'phone',
    COALESCE((NEW.raw_user_meta_data->>'must_change_password')::boolean, false)
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- 4. Update auth user updated trigger to sync username, phone
CREATE OR REPLACE FUNCTION public.handle_auth_user_updated()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.users SET
    email      = NEW.email,
    full_name  = COALESCE(NEW.raw_user_meta_data->>'full_name', public.users.full_name),
    username   = COALESCE(NEW.raw_user_meta_data->>'username', public.users.username),
    phone      = COALESCE(NEW.raw_user_meta_data->>'phone', public.users.phone),
    updated_at = now()
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;
