-- ============================================================
-- Migration: Backup & Reset Audit Logs
-- ============================================================

-- Track all backup operations
CREATE TABLE IF NOT EXISTS backup_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_type   text NOT NULL CHECK (backup_type IN ('excel', 'json', 'manual')),
  file_name     text NOT NULL,
  user_email    text NOT NULL,
  user_name     text,
  user_role     text,
  record_count  integer DEFAULT 0,
  file_size     integer DEFAULT 0,
  action        text NOT NULL DEFAULT 'created' CHECK (action IN ('created', 'downloaded', 'deleted', 'restored')),
  created_at    timestamptz DEFAULT now()
);

-- Track all reset operations
CREATE TABLE IF NOT EXISTS reset_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reset_type      text NOT NULL CHECK (reset_type IN ('patient_data', 'operational_data')),
  user_email      text NOT NULL,
  user_name       text,
  user_role       text,
  records_deleted integer DEFAULT 0,
  backup_file     text,
  ip_address      text,
  created_at      timestamptz DEFAULT now()
);

-- Track simulation mode operations
CREATE TABLE IF NOT EXISTS simulation_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action          text NOT NULL CHECK (action IN ('enabled', 'disabled', 'generated', 'removed')),
  user_email      text NOT NULL,
  user_name       text,
  record_count    integer DEFAULT 0,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_backup_logs_created ON backup_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_reset_logs_created ON reset_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_simulation_logs_created ON simulation_logs(created_at);
