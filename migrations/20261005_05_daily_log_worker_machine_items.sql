BEGIN;

ALTER TABLE daily_logs
  ADD COLUMN IF NOT EXISTS worker_items jsonb,
  ADD COLUMN IF NOT EXISTS machine_items jsonb;

COMMIT;
