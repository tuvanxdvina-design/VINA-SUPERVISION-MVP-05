-- ============================================================================
-- 20261005_06 — TVGS trưởng tự lập nhật ký của chính mình thì "Xác nhận" thẳng, không qua Chờ duyệt
--   Thêm thao tác CONFIRM (DRAFT -> APPROVED trực tiếp) vào lịch sử duyệt, dùng khi người lập
--   nhật ký chính là người có quyền Duyệt tại công trình đó (Trưởng TVGS/Giám đốc/Admin tự lập).
-- ============================================================================
BEGIN;

ALTER TABLE review_notes DROP CONSTRAINT IF EXISTS review_notes_action_check;
ALTER TABLE review_notes ADD CONSTRAINT review_notes_action_check
  CHECK (action IN ('SUBMIT', 'APPROVE', 'REJECT', 'LOCK', 'REOPEN', 'ESCALATE', 'CONFIRM'));

COMMIT;
