BEGIN;
-- Phiên bản kỹ thuật độc lập với version của quy trình duyệt.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1;
ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1;

COMMIT;
