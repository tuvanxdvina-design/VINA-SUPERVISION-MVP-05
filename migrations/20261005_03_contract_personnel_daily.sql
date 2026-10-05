BEGIN;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS consultant_contract_type varchar(50),
  ADD COLUMN IF NOT EXISTS consultant_price_type varchar(50),
  ADD COLUMN IF NOT EXISTS contract_duration_days integer,
  ADD COLUMN IF NOT EXISTS contractor_contract_type varchar(50),
  ADD COLUMN IF NOT EXISTS contractor_price_type varchar(50),
  ADD COLUMN IF NOT EXISTS contractor_start_date date,
  ADD COLUMN IF NOT EXISTS contractor_end_date date,
  ADD COLUMN IF NOT EXISTS contractor_duration_days integer;

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_contract_duration_days_check;
ALTER TABLE projects ADD CONSTRAINT projects_contract_duration_days_check CHECK (contract_duration_days IS NULL OR contract_duration_days > 0);
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_contractor_duration_days_check;
ALTER TABLE projects ADD CONSTRAINT projects_contractor_duration_days_check CHECK (contractor_duration_days IS NULL OR contractor_duration_days > 0);

CREATE TABLE IF NOT EXISTS project_personnel_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  personnel_id uuid NOT NULL REFERENCES project_personnel(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category varchar(80) NOT NULL DEFAULT 'CERTIFICATE',
  file_name varchar(255) NOT NULL,
  file_type varchar(120),
  file_size bigint NOT NULL,
  sha256 char(64) NOT NULL,
  storage_key varchar(180) NOT NULL,
  uploaded_by uuid REFERENCES users(id),
  uploaded_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (personnel_id, sha256)
);
CREATE INDEX IF NOT EXISTS idx_project_personnel_files_personnel ON project_personnel_files(personnel_id);
CREATE INDEX IF NOT EXISTS idx_project_personnel_files_project ON project_personnel_files(project_id);

ALTER TABLE daily_logs DROP CONSTRAINT IF EXISTS daily_logs_project_id_log_date_shift_key;
DROP INDEX IF EXISTS uq_daily_logs_project_date_shift;
CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_logs_project_date_shift_author
  ON daily_logs(project_id, log_date, shift, created_by);

COMMIT;
