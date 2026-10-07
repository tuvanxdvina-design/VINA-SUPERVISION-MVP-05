const { sendEditError } = require('../utils/editConflict');
const express = require('express');
const authMiddleware = require('../middleware/auth');
const rbac = require('../middleware/rbac');
const dailyLogService = require('../services/dailyLogService');
const access = require('../middleware/projectAccess');
const attachments = require('../services/attachmentService');
const permissionService = require('../services/permissionService');
const { sendStoredFile } = require('../utils/fileSafety');
const reviewService = require('../services/reviewService');
const recycleService = require('../services/recycleService');
const pool = require('../utils/db');

const router = express.Router();

router.use(authMiddleware.verifyToken);
// ---------------------------------------------------------------------------
// QUY TRÌNH NHẬT KÝ: DRAFT (nháp) → SUBMITTED (chờ duyệt) → APPROVED (đã duyệt) → LOCKED (đã khóa)
//   Gửi duyệt : người lập (có quyền Thêm) hoặc người có quyền Sửa / Admin / Giám đốc
//   Duyệt / Trả lại / Khóa / Trình công ty : người có quyền "Duyệt" TẠI CÔNG TRÌNH (Trưởng TVGS), Giám đốc, Admin
// ---------------------------------------------------------------------------
const TRANSITIONS = {
  submit: { from: 'DRAFT', run: (id, uid) => dailyLogService.submitDailyLog(id, uid), audit: 'SUBMIT' },
  // Xác nhận thẳng: người lập chính là người có quyền Duyệt tại công trình đó (Trưởng TVGS tự lập nhật ký của mình)
  // -> DRAFT chuyển thẳng APPROVED, không qua SUBMITTED. Vẫn ghi lịch sử duyệt (CONFIRM) để có dấu vết.
  confirm: { from: 'DRAFT', run: (id, uid) => dailyLogService.confirmDailyLog(id, uid), audit: 'CONFIRM' },
  approve: { from: 'SUBMITTED', run: (id, uid) => dailyLogService.approveDailyLog(id, uid), audit: 'APPROVE' },
  reject: { from: 'SUBMITTED', run: id => dailyLogService.rejectDailyLog(id), audit: 'REJECT' },
  lock: { from: 'APPROVED', run: id => dailyLogService.lockDailyLog(id), audit: 'LOCK' },
  // Vượt thẩm quyền: trạng thái giữ "Chờ duyệt", chuyển sang Giám đốc/Admin quyết định
  escalate: { from: 'SUBMITTED', run: id => dailyLogService.getDailyLogById(id), audit: 'ESCALATE' }
};
const STATUS_VI = { DRAFT: 'nháp', SUBMITTED: 'chờ duyệt', APPROVED: 'đã duyệt', LOCKED: 'đã khóa' };

async function transition(action, logId, userId, rawComment) {
  const t = TRANSITIONS[action];
  if (!t) return { status: 400, error: 'Thao tác không hợp lệ' };
  const comment = reviewService.cleanComment(rawComment);
  if (action === 'reject' && (!comment || comment.length < 3)) return { status: 400, error: 'Nhập nội dung yêu cầu chỉnh sửa, bổ sung' };
  if (action === 'escalate' && (!comment || comment.length < 3)) return { status: 400, error: 'Nhập nội dung cần công ty quyết định' };
  const log = await dailyLogService.getDailyLogById(logId);
  if (!log) return { status: 404, error: 'Không tìm thấy báo cáo ngày' };
  const p = await permissionService.forUser(userId, log.project_id);
  const manager = ['ADMIN', 'DIRECTOR'].includes(p.role);
  if (!manager && !p.permissions.includes('VIEW')) return { status: 403, error: 'Không có quyền tại công trình này' };
  // Bản nháp là của riêng người lập (người khác không thấy) → chỉ người lập (hoặc Admin/Giám đốc) gửi duyệt/xác nhận.
  if (log.status === 'DRAFT' && !manager && log.created_by !== userId) return { status: 404, error: 'Không tìm thấy báo cáo ngày' };
  if (action === 'submit') {
    const ok = manager || (log.created_by === userId && p.permissions.includes('CREATE'));
    if (!ok) return { status: 403, error: 'Chỉ người lập báo cáo ngày được gửi duyệt' };
  } else if (action === 'confirm') {
    const ok = manager || (log.created_by === userId && p.permissions.includes('CREATE'));
    if (!ok) return { status: 403, error: 'Chỉ người lập báo cáo ngày được xác nhận' };
    if (!permissionService.canApprove(p)) return { status: 403, error: 'Chỉ áp dụng khi bạn có quyền Duyệt tại công trình này — hãy dùng Gửi duyệt' };
  } else if (!permissionService.canApprove(p)) {
    return { status: 403, error: 'Chỉ Trưởng TVGS của công trình (người có quyền Duyệt), Giám đốc hoặc Admin được duyệt/trả lại/khóa báo cáo ngày' };
  } else if (action === 'escalate') {
    if (manager) return { status: 400, error: 'Giám đốc/Admin quyết định trực tiếp, không cần trình công ty' };
    if (await reviewService.lastAction('daily_logs', logId) === 'ESCALATE') return { status: 409, error: 'Báo cáo ngày này đã được trình công ty' };
  } else if (!manager && (action === 'approve' || action === 'reject') && await reviewService.lastAction('daily_logs', logId) === 'ESCALATE') {
    return { status: 409, error: 'Báo cáo ngày đã trình công ty — chờ Giám đốc/Admin quyết định' };
  }
  if (log.status !== t.from) return { status: 409, error: `Báo cáo ngày đang ở trạng thái "${STATUS_VI[log.status] || log.status}", không thực hiện được` };
  const updated = await t.run(logId, userId);
  if (!updated) return { status: 409, error: 'Trạng thái báo cáo ngày vừa thay đổi, hãy tải lại' };
  await reviewService.addNote({ entityType: 'daily_logs', entityId: logId, projectId: log.project_id, action: t.audit, comment, actorId: userId });
  return { log: updated, before: log, audit: t.audit, comment };
}

// POST /api/daily-logs/bulk { action, ids[] } — gửi duyệt / duyệt / khóa nhiều nhật ký một lần
router.post('/bulk', async (req, res) => {
  const { action, ids, comment } = req.body || {};
  if (!TRANSITIONS[action] || !Array.isArray(ids) || !ids.length || ids.length > 500) return res.status(400).json({ error: 'Yêu cầu không hợp lệ' });
  const done = [], failed = [];
  for (const id of ids) {
    try {
      if (!/^[0-9a-f-]{36}$/i.test(String(id))) { failed.push({ id, error: 'ID không hợp lệ' }); continue; }
      const log = await dailyLogService.getDailyLogById(id);
      if (!log || !(await access.allowed(req.user, log.project_id))) { failed.push({ id, error: 'Không có quyền hoặc không tồn tại' }); continue; }
      const r = await transition(action, id, req.user.userId, comment);
      if (r.error) { failed.push({ id, error: r.error }); continue; }
      await req.audit('daily_logs', id, r.audit, { status: r.before.status }, { status: r.log.status, comment: r.comment }, req.user.userId);
      done.push(r.log);
    } catch (err) { failed.push({ id, error: err.message }); }
  }
  res.json({ done, failed });
});

router.use('/:id', access.record('daily_logs'));

// Bản nháp chỉ người lập thấy: mọi đường đọc theo id (xem, ảnh, tệp, sửa, thêm tệp) trả 404 với người khác
// như thể không tồn tại. Admin/Giám đốc thấy hết. (Danh sách lọc trong getDailyLogsByProject.)
router.use('/:id', async (req, res, next) => {
  try {
    if (req.params.id === 'bulk' || !/^[0-9a-f-]{36}$/i.test(req.params.id)) return next();
    const row = (await pool.query('SELECT status, created_by FROM daily_logs WHERE id = $1', [req.params.id])).rows[0];
    if (!row || row.status !== 'DRAFT' || row.created_by === req.user.userId) return next();
    const p = await permissionService.forUser(req.user.userId, req.projectId);
    if (['ADMIN', 'DIRECTOR'].includes(p.role)) return next();
    return res.status(404).json({ error: 'Không tìm thấy báo cáo ngày' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/daily-logs?project_id=xxx&status=xxx
router.get('/', access.query, async (req, res) => {
  try {
    const { project_id, status, log_date } = req.query;
    const permissions = await permissionService.forUser(req.user.userId, req.projectId);
    const logs = await dailyLogService.getDailyLogsByProject(project_id, { status, log_date, userId: req.user.userId, permissions });
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/daily-logs/:id
router.get('/:id', async (req, res) => {
  try {
    const log = await dailyLogService.getDailyLogById(req.params.id);
    res.json(log || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/attachments', async (req, res) => {
  try { res.json(await attachments.list(req.params.id)); }
  catch (error) { res.status(500).json({ error: 'Không tải được ảnh báo cáo ngày' }); }
});

router.get('/:id/attachments/:attachmentId', permissionService.requirePermission('DOWNLOAD'), async (req, res) => {
  try {
    const photo = await attachments.content(req.params.id, req.params.attachmentId);
    if (!photo) return res.status(404).json({ error: 'Không tìm thấy ảnh' });
    res.json(photo);
  } catch (error) { res.status(500).json({ error: 'Không đọc được ảnh' }); }
});

router.post('/:id/attachments', permissionService.requirePermission('CREATE'), async (req, res) => {
  try {
    const { attachment, created } = await attachments.save(req.params.id, req.user.userId, req.body.file_name, req.body.data_url);
    if (created) await req.audit('attachments', attachment.id, 'CREATE', null, attachment, req.user.userId);
    res.status(created ? 201 : 200).json(attachment);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Không lưu được ảnh' });
  }
});

router.post('/:id/attachments-binary', permissionService.requirePermission('CREATE'), express.raw({ type: () => true, limit: 8 * 1024 * 1024 + 1024 }), async (req, res) => {
  try {
    const { attachment, created } = await attachments.saveBuffer(req.params.id, req.user.userId, String(req.query.name || 'anh-hien-truong').slice(0, 255), String(req.headers['content-type'] || ''), req.body);
    if (created) await req.audit('attachments', attachment.id, 'CREATE', null, attachment, req.user.userId);
    res.status(created ? 201 : 200).json(attachment);
  } catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : 'Không lưu được ảnh' }); }
});

// POST /api/daily-logs (create DRAFT)
// Lập nhật ký: theo quyền "Thêm" tại công trình (tùy chỉnh hoặc mặc định theo vai trò).
router.post('/', access.body, permissionService.requirePermission('CREATE'), async (req, res) => {
  try {
    if (req.body.id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.body.id)) {
      return res.status(400).json({ error: 'ID báo cáo ngày không hợp lệ' });
    }
    const { log, created } = await dailyLogService.createDailyLog({
      ...req.body,
      created_by: req.user.userId
    });
    if (log.project_id !== req.body.project_id) {
      return res.status(409).json({ error: 'ID báo cáo ngày đã được dùng ở công trình khác' });
    }
    if (created) await req.audit('daily_logs', log.id, 'CREATE', null, log, req.user.userId);
    res.status(created ? 201 : 200).json(log);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Tài khoản này đã có báo cáo ngày trong cùng ngày và ca' });
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/daily-logs/:id (update DRAFT)
router.patch('/:id', async (req, res) => {
  try {
    const perms = await permissionService.forUser(req.user.userId, req.projectId);
    const current = await dailyLogService.getDailyLogById(req.params.id);
    if (current?.status === 'LOCKED') return res.status(409).json({ error: 'Báo cáo ngày đã khóa; cần mở lại trước khi sửa' });
    if (current && !['ADMIN', 'DIRECTOR'].includes(perms.role) &&
        (current.created_by !== req.user.userId || !perms.permissions.includes('CREATE'))) {
      return res.status(403).json({ error: 'Chỉ người lập có quyền Thêm được sửa báo cáo ngày còn là bản nháp' });
    }
    if (current && !['ADMIN', 'DIRECTOR'].includes(perms.role) && current.status !== 'DRAFT') {
      return res.status(409).json({ error: 'Báo cáo ngày không còn là bản nháp; cần trả lại hoặc mở lại trước khi sửa' });
    }
    const log = await dailyLogService.updateDailyLog(req.params.id, req.body, req.user.userId, perms);
    if (!log) {
      return res.status(409).json({ error: 'Báo cáo ngày không tồn tại hoặc không còn ở trạng thái DRAFT' });
    }
    await req.audit('daily_logs', req.params.id, log.status === 'LOCKED' ? 'UPDATE_LOCKED' : 'UPDATE', null, log, req.user.userId);
    res.json(log);
  } catch (err) {
    if (sendEditError(res, err)) return;
    if (err.code === '23505') return res.status(409).json({ error: 'Tài khoản này đã có báo cáo ngày trong cùng ngày và ca' });
    res.status(500).json({ error: err.message });
  }
});

for (const action of Object.keys(TRANSITIONS)) {
  router.post('/:id/' + action, async (req, res) => {
    try {
      const r = await transition(action, req.params.id, req.user.userId, req.body?.comment);
      if (r.error) return res.status(r.status).json({ error: r.error });
      await req.audit('daily_logs', req.params.id, r.audit, { status: r.before.status }, { status: r.log.status, comment: r.comment }, req.user.userId);
      res.json(r.log);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
}

// POST /api/daily-logs/:id/reopen — mở lại về Nháp từ Chờ duyệt/Đã duyệt/Đã khóa, để người lập sửa và
// gửi duyệt lại. Cùng khuôn mẫu với reopen hồ sơ/văn bản chất lượng: người có quyền Sửa tại công trình
// (mặc định gồm TVGS trưởng) hoặc Admin/Giám đốc — không giới hạn chỉ Admin/Giám đốc như sửa trực tiếp.
router.post('/:id/reopen', async (req, res) => {
  try {
    const current = await dailyLogService.getDailyLogById(req.params.id);
    if (!current) return res.status(404).json({ error: 'Không tìm thấy báo cáo ngày' });
    const p = await permissionService.forUser(req.user.userId, current.project_id);
    if (!['ADMIN', 'DIRECTOR'].includes(p.role) && !p.permissions.includes('EDIT')) {
      return res.status(403).json({ error: 'Chỉ người được cấp quyền Sửa tại công trình này hoặc Admin/Giám đốc được mở lại báo cáo ngày' });
    }
    if (current.status === 'DRAFT') return res.status(409).json({ error: 'Báo cáo ngày đang là bản nháp, không cần mở lại' });
    const log = await dailyLogService.reopenDailyLog(req.params.id);
    await req.audit('daily_logs', req.params.id, 'REOPEN', { status: current.status }, { status: log.status }, req.user.userId);
    res.json(log);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---- Tài liệu kèm theo nhật ký (PDF/Word/Excel/ảnh…) lưu trong CSDL, tối đa 15 MB/tệp ----
const MAX_FILE = 15 * 1024 * 1024;
router.get('/:id/files', async (req, res) => {
  try { res.json(await dailyLogService.listFiles(req.params.id)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/:id/files', express.raw({ type: () => true, limit: MAX_FILE + 1024 }), async (req, res) => {
  try {
    const log = await dailyLogService.getDailyLogById(req.params.id);
    if (!log) return res.status(404).json({ error: 'Không tìm thấy báo cáo ngày' });
    const p = await permissionService.forUser(req.user.userId, log.project_id);
    const manager = ['ADMIN', 'DIRECTOR'].includes(p.role);
    if (log.status === 'LOCKED') return res.status(409).json({ error: 'Báo cáo ngày đã khóa; cần mở lại trước khi thêm tệp' });
    if (!(manager || (log.created_by === req.user.userId && p.permissions.includes('CREATE')))) return res.status(403).json({ error: 'Không có quyền thêm tệp cho báo cáo ngày này' });
    if (!manager && log.status !== 'DRAFT') return res.status(409).json({ error: 'Chỉ thêm tệp khi báo cáo ngày còn là bản nháp' });
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Tệp rỗng' });
    if (req.body.length > MAX_FILE) return res.status(413).json({ error: 'Mỗi tệp tối đa 15 MB' });
    const f = await dailyLogService.addFile(req.params.id, String(req.query.name || 'tai-lieu').slice(0, 255), String(req.headers['content-type'] || 'application/octet-stream').slice(0, 120), req.body, req.user.userId);
    res.status(f.created ? 201 : 200).json(f);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.get('/:id/files/:fileId', permissionService.requirePermission('DOWNLOAD'), async (req, res) => {
  try {
    const f = await dailyLogService.getFile(req.params.id, req.params.fileId);
    if (!f) return res.status(404).json({ error: 'Không tìm thấy tệp' });
    sendStoredFile(res, { name: f.file_name, type: f.file_type, buffer: f.content }, req.query.download);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/daily-logs/:id { reason } — chỉ người có quyền "Xóa" tại công trình (mặc định Admin/Giám đốc).
// Nhật ký cùng ảnh/tệp chuyển vào Thùng rác, khôi phục được.
router.delete('/:id', async (req, res) => {
  try {
    const log = await dailyLogService.getDailyLogById(req.params.id);
    if (!log) return res.status(404).json({ error: 'Không tìm thấy báo cáo ngày' });
    const p = await permissionService.forUser(req.user.userId, log.project_id);
    if (!p.permissions.includes('DELETE')) return res.status(403).json({ error: 'Tài khoản chưa được cấp quyền "Xóa" tại công trình này' });
    const reason = reviewService.cleanComment(req.body?.reason);
    if (!reason || reason.length < 3) return res.status(400).json({ error: 'Nhập lý do xóa' });
    const { recycleId } = await recycleService.archive('daily_logs', req.params.id, reason, req.user.userId);
    await req.audit('daily_logs', req.params.id, 'DELETE', { status: log.status, log_date: log.log_date_text, shift: log.shift }, { recycle_id: recycleId, reason }, req.user.userId);
    res.json({ ok: true, recycle_id: recycleId });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

module.exports = router;
