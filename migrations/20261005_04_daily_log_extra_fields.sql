BEGIN;

ALTER TABLE daily_logs
  ADD COLUMN IF NOT EXISTS contractor_unit varchar(255),
  ADD COLUMN IF NOT EXISTS item_category varchar(255),
  ADD COLUMN IF NOT EXISTS technical_staff_count int,
  ADD COLUMN IF NOT EXISTS recommendation text;

COMMIT;
