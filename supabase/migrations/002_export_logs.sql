-- ============================================================
-- نظام مبادرة الأمراض المزمنة - Supabase Migration
-- Add export_logs table
-- ============================================================

CREATE TABLE IF NOT EXISTS export_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email  text NOT NULL,
  user_name   text NOT NULL,
  user_role   text NOT NULL,
  export_type text NOT NULL CHECK (export_type IN ('PDF', 'Excel')),
  created_at  timestamptz DEFAULT now()
);

-- Add index for performance on queries by date or user
CREATE INDEX IF NOT EXISTS idx_export_logs_created_at ON export_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_export_logs_user_email ON export_logs(user_email);
