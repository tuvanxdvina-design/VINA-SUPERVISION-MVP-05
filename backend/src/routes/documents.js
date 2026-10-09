const { sendEditError } = require('../utils/editConflict');
const express = require('express');
const authMiddleware = require('../middleware/auth');
const rbac = require('../middleware/rbac');
const documentService = require('../services/documentService');
const permissionService = require('../services/permissionService');
const access = require('../middleware/projectAccess');
const { sendStoredFile } = require('../utils/fileSafety');
const reviewService = require('../services/reviewService');
const recycleService = require('../services/recycleService');

const router = express.Router();
const MAX_FILE = 15 * 1024 * 1024;

router.use(authMiddleware.verifyToken);
router.use('/:id', access.record('documents'));
router.use('/:id/certificate-snapshots',require('./certificateSnapshots')('documents'));

function fail(res, err) {
  if (sendEditError(res, err)) return;
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error('documents:', err.message);
  return res.status(500).json({ error: 'Không xử lý được hồ sơ' });
}

// Quyền sửa một hồ sơ: Admin/Giám đốc; người có quyền "Sửa"; người lập (có quyền "Thêm") — chỉ khi còn NHÁP.
// Hồ sơ đã gửi duyệt/đã duyệt phải "Trả lại" (hoặc mở lại) rồi mới sửa, để nội dung đã duyệt không bị đổi ngầm.
async function canModify(req, doc) {
  if (doc.status === 'LOCKED') return false;
  const p = await permissionService.forUser(req.user.userId, doc.project_id);
  if (['ADMIN', 'DIRECTOR'].includes(p.role)) return true;
  if (doc.status !== 'DRAFT') return false;
  return p.permissions.includes('EDIT') || (doc.created_by === req.user.userId && p.permissions.includes('CREATE'));
}
async function loadDoc(req, res, next) {
  try {
    const doc = await documentService.getDocumentById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Không tìm thấy hồ sơ' });
    req.doc = doc;
    next();
  } catch (err) { fail(res, err); }
}
function validBody(b, creating) {
  if (creating && !String(b.name || '').trim()) return 'Nhập tên hồ sơ';
  if (b.name && String(b.name).length > 255) return 'Tên hồ sơ tối đa 255 ký tự';
  if (b.details !== undefined && (typeof b.details !== 'object' || Array.isArray(b.details) || JSON.stringify(b.details).length > 3000000)) return 'Thông tin chi tiết không hợp lệ';
  return null;
}

// GET /api/documents?project_id=...
router.get('/', access.query, async (req, res) => {
  try { res.json(await documentService.getDocumentsByProject(req.query.project_id, { type: req.query.type, status: req.query.status })); }
  catch (err) { fail(res, err); }
});

router.get('/:id', loadDoc, (req, res) => res.json(req.doc));

// Tạo hồ sơ: quyền "Thêm" tại công trình. Mã hồ sơ do máy chủ cấp.
router.post('/', access.body, permissionService.requirePermission('CREATE'), async (req, res) => {
  const err = validBody(req.body || {}, true);
  if (err) return res.status(400).json({ error: err });
  try {
    const doc = await documentService.createDocument({ ...req.body, name: String(req.body.name).trim(), created_by: req.user.userId });
    await req.audit('documents', doc.id, 'CREATE', null, { auto_code: doc.auto_code, name: doc.name }, req.user.userId);
    res.status(201).json(doc);
  } catch (e) { fail(res, e); }
});

router.patch('/:id', loadDoc, async (req, res) => {
  const err = validBody(req.body || {}, false);
  if (err) return res.status(400).json({ error: err });
  try {
    if (!await canModify(req, req.doc)) return res.status(403).json({ error: 'Không có quyền sửa hồ sơ này' });
    const doc = await documentService.updateDocument(req.params.id, req.body, req.user.userId);
    await req.audit('documents', doc.id, req.doc.status === 'LOCKED' ? 'UPDATE_LOCKED' : 'UPDATE', { name: req.doc.name, details: req.doc.details }, { name: doc.name, details: doc.details }, req.user.userId);
    res.json(doc);
  } catch (e) { fail(res, e); }
});

// Tải tệp lên: gửi nội dung nhị phân (không base64) — tên và nhóm tài liệu qua tham số URL.
router.post('/:id/files', loadDoc, express.raw({ type: () => true, limit: MAX_FILE + 1024 }), async (req, res) => {
  try {
    if (!await canModify(req, req.doc)) return res.status(403).json({ error: 'Không có quyền tải tệp cho hồ sơ này' });
    const buffer = req.body;
    if (!Buffer.isBuffer(buffer) || !buffer.length) return res.status(400).json({ error: 'Tệp rỗng' });
    if (buffer.length > MAX_FILE) return res.status(413).json({ error: 'Mỗi tệp tối đa 15 MB' });
    const name = String(req.query.name || 'tai-lieu').slice(0, 255);
    const file = await documentService.addFile(req.params.id, {
      category: String(req.query.category || 'Tài liệu').slice(0, 120), name,
      type: String(req.headers['content-type'] || 'application/octet-stream').slice(0, 120), buffer
    }, req.user.userId);
    await req.audit('documents', req.params.id, 'ADD_FILE', null, { file: name, size: buffer.length }, req.user.userId);
    res.status(file.created ? 201 : 200).json(file);
  } catch (e) {
    if (e.type === 'entity.too.large') return res.status(413).json({ error: 'Mỗi tệp tối đa 15 MB' });
    fail(res, e);
  }
});

router.get('/:id/files/:fileId', loadDoc, permissionService.requirePermission('DOWNLOAD'), async (req, res) => {
  try {
    const f = await documentService.getFile(req.params.id, req.params.fileId);
    if (!f) return res.status(404).json({ error: 'Không tìm thấy tệp' });
    sendStoredFile(res, { name: f.file_name, type: f.file_type, buffer: f.content }, req.query.download);
  } catch (e) { fail(res, e); }
});

router.delete('/:id/files/:fileId', loadDoc, async (req, res) => {
  try {
    if (!await canModify(req, req.doc)) return res.status(403).json({ error: 'Không có quyền xóa tệp của hồ sơ này' });
    const f = await documentService.removeFile(req.params.id, req.params.fileId, req.user.userId);
    if (!f) return res.status(404).json({ error: 'Không tìm thấy tệp' });
    await req.audit('documents', req.params.id, 'REMOVE_FILE', { file: f.file_name }, null, req.user.userId);
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

// ---- Quy trình duyệt ----
// Mỗi bước ghi kèm ý kiến (body.comment). "Trả lại" (yêu cầu chỉnh sửa, bổ sung) bắt buộc ghi nội dung
// để người lập biết phải sửa gì; "Mở khóa" bắt buộc ghi lý do; "Trình công ty" bắt buộc ghi nội dung cần quyết định.
// Duyệt/Trả lại/Khóa/Mở khóa/Trình công ty: người có quyền "Duyệt" TẠI CÔNG TRÌNH (Trưởng TVGS), Giám đốc, Admin.
const REQUIRED_COMMENT = { reject: 'Nhập nội dung yêu cầu chỉnh sửa, bổ sung', reopen: 'Nhập lý do mở khóa', escalate: 'Nhập nội dung cần công ty quyết định' };
function workflow(action, fn) {
  router.post('/:id/' + action, loadDoc, async (req, res) => {
    try {
      const comment = reviewService.cleanComment(req.body?.comment ?? req.body?.reason);
      if (REQUIRED_COMMENT[action] && (!comment || comment.length < 3)) return res.status(400).json({ error: REQUIRED_COMMENT[action] });
      if (action === 'submit') {
        if (!await canModify(req, req.doc)) return res.status(403).json({ error: 'Chỉ người lập hoặc người có quyền Sửa được gửi duyệt' });
      } else {
        const p = await permissionService.forUser(req.user.userId, req.doc.project_id);
        if (!permissionService.canApprove(p)) return res.status(403).json({ error: 'Chỉ Trưởng TVGS của công trình (người có quyền Duyệt), Giám đốc hoặc Admin được thực hiện' });
        if (action === 'escalate') {
          if (['ADMIN', 'DIRECTOR'].includes(p.role)) return res.status(400).json({ error: 'Giám đốc/Admin quyết định trực tiếp, không cần trình công ty' });
          if (req.doc.status !== 'SUBMITTED') return res.status(409).json({ error: 'Chỉ trình công ty bản đang chờ duyệt' });
          if (await reviewService.lastAction('documents', req.params.id) === 'ESCALATE') return res.status(409).json({ error: 'Bản này đã được trình công ty' });
        } else if (!['ADMIN', 'DIRECTOR'].includes(p.role) && (action === 'approve' || action === 'reject')
          && await reviewService.lastAction('documents', req.params.id) === 'ESCALATE') {
          return res.status(409).json({ error: 'Bản này đã trình công ty — chờ Giám đốc/Admin quyết định' });
        }
      }
      if (action === 'reopen') req.body = { ...req.body, reason: comment };
      const doc = await fn(req);
      if (!doc) return res.status(409).json({ error: 'Trạng thái hồ sơ không cho phép thao tác này' });
      await reviewService.addNote({ entityType: 'documents', entityId: req.params.id, projectId: req.doc.project_id, action: action.toUpperCase(), comment, actorId: req.user.userId });
      await req.audit('documents', req.params.id, action.toUpperCase(), { status: req.doc.status }, { status: doc.status, comment }, req.user.userId);
      res.json(await documentService.getDocumentById(req.params.id));
    } catch (e) { fail(res, e); }
  });
}
const R = rbac.ROLES;
workflow('submit', req => documentService.submitDocument(req.params.id, req.user.userId));
workflow('approve', req => documentService.approveDocument(req.params.id, req.user.userId));
workflow('reject', req => documentService.rejectDocument(req.params.id));
workflow('lock', req => documentService.lockDocument(req.params.id));
workflow('reopen', req => documentService.reopenDocument(req.params.id, req.user.userId, req.body?.reason));
workflow('escalate', async req => req.doc);

// Xóa hồ sơ/báo cáo: quyền "Xóa" tại công trình (mặc định Admin/Giám đốc), bắt buộc lý do → Thùng rác (khôi phục được)
router.delete('/:id', loadDoc, async (req, res) => {
  try {
    const p = await permissionService.forUser(req.user.userId, req.doc.project_id);
    if (!p.permissions.includes('DELETE')) return res.status(403).json({ error: 'Tài khoản chưa được cấp quyền "Xóa" tại công trình này' });
    const reason = reviewService.cleanComment(req.body?.reason);
    if (!reason || reason.length < 3) return res.status(400).json({ error: 'Nhập lý do xóa' });
    const { recycleId } = await recycleService.archive('documents', req.params.id, reason, req.user.userId);
    await req.audit('documents', req.params.id, 'DELETE', { auto_code: req.doc.auto_code, name: req.doc.name, status: req.doc.status }, { recycle_id: recycleId, reason }, req.user.userId);
    res.json({ ok: true, recycle_id: recycleId });
  } catch (e) { fail(res, e); }
});

module.exports = router;
