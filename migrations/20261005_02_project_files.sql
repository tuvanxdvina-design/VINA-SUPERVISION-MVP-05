BEGIN;

CREATE TABLE IF NOT EXISTS project_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category varchar(80) NOT NULL,
  file_name varchar(255) NOT NULL,
  file_type varchar(120),
  file_size bigint NOT NULL,
  sha256 char(64) NOT NULL,
  storage_key varchar(180) NOT NULL,
  uploaded_by uuid REFERENCES users(id),
  uploaded_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, category, sha256)
);
CREATE INDEX IF NOT EXISTS idx_project_files_project ON project_files(project_id);

COMMIT;
