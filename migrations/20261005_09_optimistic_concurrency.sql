BEGIN;
-- Phiên bản kỹ thuật độc lập với version của quy trình duyệt.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1;
ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1;

-- Mọi UPDATE (kể cả đổi trạng thái/tiến độ) làm biểu mẫu cũ hết hiệu lực.
CREATE OR REPLACE FUNCTION vina_bump_row_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.row_version := OLD.row_version + 1;
  RETURN NEW;
END;
$$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['projects', 'daily_logs', 'documents', 'issues'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS vina_row_version ON %I', t);
    EXECUTE format('CREATE TRIGGER vina_row_version BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION vina_bump_row_version()', t);
  END LOOP;
END;
$$;
COMMIT;
