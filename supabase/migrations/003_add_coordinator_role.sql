-- ============================================================
-- Migration 003: Update users role check constraint
-- Run this in Supabase SQL Editor to allow the 'coordinator' role
-- ============================================================

DO $$
DECLARE
    const_name text;
BEGIN
    -- Find the automatically generated check constraint name for the 'role' column
    SELECT constraint_name INTO const_name
    FROM information_schema.constraint_column_usage
    WHERE table_name = 'users' AND column_name = 'role'
    LIMIT 1;

    -- Drop the old constraint
    IF const_name IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.users DROP CONSTRAINT ' || const_name;
    END IF;
END $$;

-- Add the new constraint including 'coordinator'
ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role IN ('nurse', 'supervisor', 'coordinator'));
