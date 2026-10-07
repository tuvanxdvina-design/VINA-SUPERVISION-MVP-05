const { sendEditError } = require('../utils/editConflict');
const express = require('express');
const authMiddleware = require('../middleware/auth');
const rbac = require('../middleware/rbac');
const issueService = require('../services/issueService');
const access = require('../middleware/projectAccess');
const pool = require('../utils/db');
const { sendStoredFile } = require('../utils/fileSafety');

const router = express.Router();

const permissionService = require('../services/permissionService');

// Dùng chung bộ quyền hiệu lực (tùy chỉnh hoặc mặc định theo vai trò) với các phân hệ khác.
async function memberPermission(userId, projectId) {
  const p = await permissionService.forUser(userId, projectId);
  return { role: p.role, permissions: p.permissions };
}
async function canCreateIssue(userId, projectId){const a=await memberPermission(userId,projectId);return a.permissions.includes('CREATE')||a.permissions.includes('EDIT')}
async function canEditIssue(userId, issue){const a=await memberPermission(userId,issue.project_id);if(['ADMIN','DIRECTOR'].includes(a.role))return true;if(['RESOLVED','CLOSED','SIGNED','ISSUED'].includes(String(issue.status||'').toUpperCase()))return a.permissions.includes('EDIT');return (issue.created_by===userId&&a.permissions.includes('CREATE'))||a.permissions.includes('EDIT')}

function detailsError(details) {
  if (details === undefined) return '';
  if (details === null || typeof details !== 'object' || Array.isArray(details)) return 'Thông tin chi tiết không hợp lệ';
  if (JSON.stringify(details).length > 3000000) return 'Thông tin chi tiết quá lớn';
  return '';
}

router.use(authMiddleware.verifyToken);
router.use('/:id', access.record('issues'));

// GET /api/issues?project_id=xxx&status=xxx
router.get('/', access.query, async (req, res) => {
  try {
    const { project_id, status } = req.query;
    const issues = await issueService.getAllIssues(project_id, { status });
    res.json(issues);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/issues/:id
router.get('/:id', async (req, res) => {
  try {
    const issue = await issueService.getIssueById(req.params.id);
    res.json(issue || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/issues
router.post('/', access.body, async (req, res) => {
  try {
    if (!(await canCreateIssue(req.user.userId, req.body.project_id))) return res.status(403).json({ error: 'Tài khoản chưa được cấp quyền Thêm nội dung chất lượng tại công trình' });
    if (req.body.id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.body.id)) {
      return res.status(400).json({ error: 'ID vấn đề không hợp lệ' });
    }
    if (typeof req.body.title !== 'string' || !req.body.title.trim()) {
      return res.status(400).json({ error: 'Cần nhập nội dung vấn đề' });
    }
    const detailError = detailsError(req.body.details);
    if (detailError) return res.status(400).json({ error: detailError });
    const { issue, created } = await issueService.createIssue({
      ...req.body,
      created_by: req.user.userId
    });
    if (issue.project_id !== req.body.project_id) {
      return res.status(409).json({ error: 'ID vấn đề đã được dùng ở công trình khác' });
    }
    if (created) await req.audit('issues', issue.id, 'CREATE', null, issue, req.user.userId);
    res.status(created ? 201 : 200).json(issue);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Mã vấn đề đã tồn tại' });
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/issues/:id
router.patch('/:id', async (req, res) => {
  try {
    const current = await issueService.getIssueById(req.params.id);
    if (!current) return res.status(404).json({ error: 'Không tìm thấy vấn đề' });
    if (!(await canEditIssue(req.user.userId, current))) return res.status(403).json({ error: 'Chỉ người lập khi văn bản chưa đóng hoặc người được cấp quyền Sửa mới được cập nhật' });
    const detailError = detailsError(req.body.details);
    if (detailError) return res.status(400).json({ error: detailError });
    const issue = await issueService.updateIssue(req.params.id, req.body);
    await req.audit('issues', req.params.id, 'UPDATE', null, issue, req.user.userId);
    res.json(issue);
  } catch (err) {
    if (sendEditError(res, err)) return;
    res.status(500).json({ error: err.message });
  }
});

// Tệp đính kèm (bản ký/scan) — quyền truy cập công trình đã được kiểm ở router.use('/:id', access.record('issues')) phía trên.
const MAX_ISSUE_FILE = 15 * 1024 * 1024;

// GET /api/issues/:id/files
router.get('/:id/files', async (req, res) => {
  try {
    res.json(await issueService.listFiles(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/issues/:id/files?name=...
router.post('/:id/files', express.raw({ type: () => true, limit: MAX_ISSUE_FILE + 1024 }), async (req, res) => {
  try {
    const current = await issueService.getIssueById(req.params.id);
    if (!current) return res.status(404).json({ error: 'Không tìm thấy vấn đề' });
    if (!(await canEditIssue(req.user.userId, current))) return res.status(403).json({ error: 'Chỉ người lập khi văn bản chưa đóng hoặc người được cấp quyền Sửa mới được tải tệp' });
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Tệp rỗng' });
    if (req.body.length > MAX_ISSUE_FILE) return res.status(413).json({ error: 'Tệp đính kèm tối đa 15 MB' });
    const name = String(req.query.name || 'ban-ky').slice(0, 255);
    const file = await issueService.addFile(current, 'SIGNED', name, String(req.headers['content-type'] || 'application/octet-stream').slice(0, 120), req.body, req.user.userId);
    if (file.created) await req.audit('issue_files', file.id, 'CREATE', null, { issue_id: req.params.id, name, size: req.body.length }, req.user.userId);
    res.status(file.created ? 201 : 200).json(file);
  } catch (err) {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Tệp đính kèm tối đa 15 MB' });
    res.status(500).json({ error: err.message });
  }
});

// GET /api/issues/:id/files/:fileId
router.get('/:id/files/:fileId', permissionService.requirePermission('DOWNLOAD'), async (req, res) => {
  try {
    const file = await issueService.getFile(req.params.id, req.params.fileId);
    if (!file) return res.status(404).json({ error: 'Không tìm thấy tệp' });
    sendStoredFile(res, file, req.query.download);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/issues/:id/assign
router.post('/:id/assign', rbac.checkRole([rbac.ROLES.ADMIN, rbac.ROLES.DIRECTOR, rbac.ROLES.TVGS_LEAD]), async (req, res) => {
  try {
    const assigned_to = req.body?.assigned_to || null;
    if (assigned_to) {
      if (!/^[0-9a-f-]{36}$/i.test(String(assigned_to))) return res.status(400).json({ error: 'Tài khoản được giao không hợp lệ' });
      if (!await access.allowed({ userId: assigned_to }, req.projectId)) return res.status(400).json({ error: 'Người được giao không thuộc công trình này' });
    }
    const issue = await issueService.assignIssue(req.params.id, assigned_to);
    await req.audit('issues', req.params.id, 'ASSIGN', null, issue, req.user.userId);
    res.json(issue);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/issues/:id/resolve
router.post('/:id/resolve', async (req, res) => {
  try {
    const current = await issueService.getIssueById(req.params.id);
    if (!current) return res.status(404).json({ error: 'Không tìm thấy vấn đề' });
    if (!(await canEditIssue(req.user.userId, current))) return res.status(403).json({ error: 'Chỉ người được cấp quyền Sửa mới được đóng văn bản' });
    const { resolution_note } = req.body;
    const { issue, changed } = await issueService.resolveIssue(req.params.id, req.user.userId, resolution_note, req.body);
    if (!issue) return res.status(404).json({ error: 'Không tìm thấy vấn đề' });
    if (changed) await req.audit('issues', req.params.id, 'RESOLVE', null, issue, req.user.userId);
    res.json(issue);
  } catch (err) {
    if (sendEditError(res, err)) return;
    res.status(500).json({ error: err.message });
  }
});

// POST /api/issues/:id/reopen
router.post('/:id/reopen', async (req, res) => {
  try {
    const current=await issueService.getIssueById(req.params.id); if(!current)return res.status(404).json({error:'Không tìm thấy vấn đề'});
    const a=await memberPermission(req.user.userId,current.project_id);
    if(!['ADMIN','DIRECTOR'].includes(a.role)&&!a.permissions.includes('EDIT'))return res.status(403).json({error:'Chỉ người được cấp quyền Sửa mới được mở lại văn bản'});
    const issue=await issueService.reopenIssue(req.params.id, req.user.userId, req.body); await req.audit('issues',req.params.id,'REOPEN',current,issue,req.user.userId); res.json(issue);
  } catch(err){if(sendEditError(res,err))return;res.status(500).json({error:err.message})}
});

// DELETE /api/issues/:id
// Xóa văn bản chất lượng: quyền "Xóa" tại công trình (mặc định Admin/Giám đốc), bắt buộc lý do → Thùng rác
router.delete('/:id', async (req, res) => {
  try {
    const current = await issueService.getIssueById(req.params.id);
    if (!current) return res.status(404).json({ error: 'Không tìm thấy vấn đề' });
    const p = await permissionService.forUser(req.user.userId, current.project_id);
    if (!p.permissions.includes('DELETE')) return res.status(403).json({ error: 'Tài khoản chưa được cấp quyền "Xóa" tại công trình này' });
    const reason = String(req.body?.reason || '').trim();
    if (reason.length < 3) return res.status(400).json({ error: 'Nhập lý do xóa' });
    const { recycleId } = await require('../services/recycleService').archive('issues', req.params.id, reason.slice(0, 4000), req.user.userId);
    await req.audit('issues', req.params.id, 'DELETE', { title: current.title, status: current.status }, { recycle_id: recycleId, reason }, req.user.userId);
    res.json({ ok: true, recycle_id: recycleId });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
