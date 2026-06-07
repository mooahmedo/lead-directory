-- ============================================================
-- Migration 006: Fix User Deletion
-- Ensures that deleting an auth user properly deletes the public user
-- and prevents orphaned user records.
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Update foreign key constraints to ON DELETE SET NULL
-- This prevents audit logs and visits from blocking user deletion.
ALTER TABLE public.audit_logs
  DROP CONSTRAINT audit_logs_performed_by_fkey,
  ADD CONSTRAINT audit_logs_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- Only drop if it exists (in case it wasn't named visits_created_by_fkey or created_by doesn't exist)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='visits_created_by_fkey' AND table_name='visits') THEN
    ALTER TABLE public.visits DROP CONSTRAINT visits_created_by_fkey;
  END IF;
END $$;

ALTER TABLE public.visits
  ADD CONSTRAINT visits_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- 2. Delete existing orphaned users
-- This removes users that exist in public.users but not in auth.users
DELETE FROM public.users WHERE id NOT IN (SELECT id FROM auth.users);

-- 3. Link public.users to auth.users with ON DELETE CASCADE
-- This ensures future deletions from auth.users automatically cascade to public.users
ALTER TABLE public.users
  ADD CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
