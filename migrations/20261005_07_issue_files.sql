-- ============================================================================
-- 20261005_07 — Tệp đính kèm (bản ký/scan) cho "Chất lượng công trình" (issues)
--   Trước đây file "isignedFile" chỉ lưu base64 trong details JSONB, chỉ tồn tại trên trình duyệt
--   (api.js issueDetailsPayload() cắt bỏ .data trước khi đồng bộ) — mất khi đổi thiết bị, cùng lỗi
--   đã sửa cho Hồ sơ ở Đợt 3. Nay lưu nhị phân qua fileStore (giống project_personnel_files).
-- ============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS issue_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category varchar(80) NOT NULL DEFAULT 'SIGNED',
  file_name varchar(255) NOT NULL,
  file_type varchar(120),
  file_size bigint NOT NULL,
  sha256 char(64) NOT NULL,
  storage_key varchar(180) NOT NULL,
  uploaded_by uuid REFERENCES users(id),
  uploaded_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (issue_id, sha256)
);
CREATE INDEX IF NOT EXISTS idx_issue_files_issue ON issue_files(issue_id);
CREATE INDEX IF NOT EXISTS idx_issue_files_project ON issue_files(project_id);

COMMIT;
