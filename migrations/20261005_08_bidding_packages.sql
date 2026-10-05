-- ============================================================================
-- 20261005_08 — Gói thầu: một công trình có thể có nhiều gói thầu, mỗi gói thầu có
--   nhiều nhà thầu, mỗi nhà thầu thi công một số hạng mục (tên + đơn vị tính).
--   Tùy chọn: công trình đơn giản (1 gói/1 nhà thầu) vẫn dùng ô "Tên nhà thầu" cũ,
--   không bắt buộc khai báo Gói thầu. Khi phân công GS viên vào công trình ĐÃ CÓ
--   gói thầu, bắt buộc chọn đúng 1 gói thầu cho người đó (ấn định phạm vi phụ trách).
-- ============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS bidding_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name varchar(255) NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, name)
);
CREATE INDEX IF NOT EXISTS idx_bidding_packages_project ON bidding_packages(project_id);

-- Nhà thầu trong gói; items = [{"name":"Hạng mục...","unit":"m3"}, ...]
CREATE TABLE IF NOT EXISTS bidding_package_contractors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES bidding_packages(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name varchar(255) NOT NULL,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (package_id, name)
);
CREATE INDEX IF NOT EXISTS idx_bidding_package_contractors_package ON bidding_package_contractors(package_id);

ALTER TABLE project_personnel ADD COLUMN IF NOT EXISTS bidding_package_id uuid REFERENCES bidding_packages(id) ON DELETE SET NULL;
ALTER TABLE project_members ADD COLUMN IF NOT EXISTS bidding_package_id uuid REFERENCES bidding_packages(id) ON DELETE SET NULL;

COMMIT;
