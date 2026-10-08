const express = require('express');
const auth = require('../middleware/auth');
const rbac = require('../middleware/rbac');
const access = require('../middleware/projectAccess');
const service = require('../services/projectPersonnelService');
const permissionService = require('../services/permissionService');
const biddingPackageService = require('../services/biddingPackageService');
const { sendStoredFile } = require('../utils/fileSafety');

const router = express.Router();
router.use(auth.verifyToken);

const managers = [rbac.ROLES.ADMIN, rbac.ROLES.DIRECTOR];

function sendError(res, error) {
  if (error.status) return res.status(error.status).json({ error: error.message, code: error.code });
  if (error.code === '23503') return res.status(404).json({ error: 'Công trình hoặc tài khoản không tồn tại trên máy chủ' });
  console.error('project-personnel:', error.message);
  return res.status(500).json({ error: 'Không xử lý được nhân sự công trình' });
}

function validPermissions(value) {
  return value === undefined || value === null ||
    (Array.isArray(value) && value.every(v => permissionService.ALL.includes(v)));
}

// Công trình đã khai báo Gói thầu → bắt buộc chọn đúng 1 gói thầu của công trình đó cho nhân sự.
// Chưa có gói thầu nào → không áp dụng, bỏ qua.
async function validatePackageAssignment(projectId, packageId) {
  const packages = await biddingPackageService.listForProject(projectId);
  if (!packages.length) return null;
  if (!packageId) return 'Công trình này đã khai báo Gói thầu — hãy chọn gói thầu phụ trách cho nhân sự';
  if (!packages.some(p => p.id === packageId)) return 'Gói thầu đã chọn không thuộc công trình này';
  return null;
}

// Chuyển giao TVGS trưởng: ghi dấu vết kết thúc phân công của người cũ.
async function auditLeadTransfer(req, replaced, row) {
  for (const old of replaced || []) {
    await req.audit('project_personnel', old.personnel_id || old.user_id, 'TRANSFER_LEAD',
      old, { to_personnel_id: row.id, to_name: row.full_name }, req.user.userId);
  }
}

// Danh sách hợp nhất (mỗi người một dòng) — dùng cho trang Nhân sự, Chi tiết công trình, Quản lý quyền.
router.get('/project/:projectId/team', access.projectParam, async (req, res) => {
  try {
    const rows = await service.team(req.params.projectId);
    const me = await permissionService.forUser(req.user.userId, req.params.projectId);
    if (['ADMIN', 'DIRECTOR'].includes(me.role)) return res.json(rows);
    // Nhân viên: chỉ thấy quyền truy cập của CHÍNH MÌNH; thành viên khác chỉ hiện tên, chức danh, chứng chỉ
    res.json(rows.map(r => r.user_id === req.user.userId ? { ...r, is_me: true } : {
      key: r.key, personnel_id: r.personnel_id, full_name: r.full_name, assignment_title: r.assignment_title,
      certificate: r.certificate, role_name: r.role_name, account_status: r.account_status === 'LINKED' ? 'LINKED' : 'NO_ACCOUNT',
      access_permissions: [], permission_source: 'HIDDEN'
    }));
  }
  catch (error) { sendError(res, error); }
});

router.get('/project/:projectId/unassigned-authors', access.projectParam, rbac.checkRole(managers), async (req, res) => {
  try { res.json(await service.unassignedAuthors(req.params.projectId)); }
  catch (error) { sendError(res, error); }
});

// Giữ API cũ (chỉ hồ sơ nhân sự).
router.get('/project/:projectId', access.projectParam, async (req, res) => {
  try { res.json(await service.list(req.params.projectId)); }
  catch (error) { sendError(res, error); }
});

// Tra cứu nhân sự đã có ở công trình khác, để chọn lại khi thêm mới thay vì gõ tên trùng lặp.
router.get('/search', rbac.checkRole(managers), async (req, res) => {
  try { res.json(await service.searchNames(req.query.q, req.query.limit)); }
  catch (error) { sendError(res, error); }
});

router.post('/', access.body, rbac.checkRole(managers), async (req, res) => {
  try {
    const { project_id, full_name, assignment_title } = req.body;
    if (!project_id || !service.cleanName(full_name) || !String(assignment_title || '').trim()) {
      return res.status(400).json({ error: 'Thiếu công trình, họ tên hoặc chức danh' });
    }
    if (String(full_name).length > 255 || String(assignment_title).length > 120) return res.status(400).json({ error: 'Thông tin nhân sự vượt giới hạn' });
    const packageError = await validatePackageAssignment(project_id, req.body.bidding_package_id || null);
    if (packageError) return res.status(400).json({ error: packageError });
    const { row, created, replaced } = await service.upsert({ ...req.body, created_by: req.user.userId });
    await req.audit('project_personnel', row.id, created ? 'CREATE' : 'UPDATE', null, row, req.user.userId);
    await auditLeadTransfer(req, replaced, row);
    res.status(created ? 201 : 200).json(row);
  } catch (error) { sendError(res, error); }
});

async function loadPersonnel(req, res, next) {
  try {
    const row = await service.getById(req.params.id);
    if (!row || row.status !== 'ACTIVE') return res.status(404).json({ error: 'Không tìm thấy nhân sự công trình' });
    req.personnel = row;
    next();
  } catch (error) { sendError(res, error); }
}

router.put('/:id', rbac.checkRole(managers), loadPersonnel, async (req, res) => {
  try {
    if (req.body.full_name !== undefined && String(req.body.full_name).length > 255) return res.status(400).json({ error: 'Họ tên tối đa 255 ký tự' });
    if (req.body.assignment_title !== undefined && String(req.body.assignment_title).length > 120) return res.status(400).json({ error: 'Chức danh tối đa 120 ký tự' });
    const effectivePackageId = req.body.bidding_package_id !== undefined ? req.body.bidding_package_id : req.personnel.bidding_package_id;
    const packageError = await validatePackageAssignment(req.personnel.project_id, effectivePackageId || null);
    if (packageError) return res.status(400).json({ error: packageError });
    const { row, replaced } = await service.update(req.params.id, req.body);
    await req.audit('project_personnel', row.id, 'UPDATE', req.personnel, row, req.user.userId);
    await auditLeadTransfer(req, replaced, row);
    res.json(row);
  } catch (error) { sendError(res, error); }
});

router.post('/:id/link-account', rbac.checkRole(managers), loadPersonnel, async (req, res) => {
  try {
    if (!req.body.user_id) return res.status(400).json({ error: 'Cần chọn tài khoản' });
    if (!validPermissions(req.body.access_permissions)) return res.status(400).json({ error: 'Quyền truy cập không hợp lệ' });
    const result = await service.linkAccount(req.params.id, { ...req.body, actorId: req.user.userId });
    await req.audit('project_personnel', req.params.id, 'LINK_ACCOUNT', req.personnel, result, req.user.userId);
    res.json(result);
  } catch (error) { sendError(res, error); }
});

router.post('/:id/unlink-account', rbac.checkRole(managers), loadPersonnel, async (req, res) => {
  try {
    const row = await service.unlinkAccount(req.params.id);
    await req.audit('project_personnel', req.params.id, 'UNLINK_ACCOUNT', req.personnel, row, req.user.userId);
    res.json(row);
  } catch (error) { sendError(res, error); }
});

const MAX_CERT_FILE = 15 * 1024 * 1024;
router.get('/:id/files', loadPersonnel, async (req, res) => {
  try {
    if (!await access.allowed(req.user, req.personnel.project_id)) return res.status(403).json({ error: 'Không có quyền truy cập công trình' });
    res.json(await service.listFiles(req.params.id));
  } catch (error) { sendError(res, error); }
});

router.post('/:id/files', rbac.checkRole(managers), loadPersonnel, express.raw({ type: () => true, limit: MAX_CERT_FILE + 1024 }), async (req, res) => {
  try {
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Tệp rỗng' });
    if (req.body.length > MAX_CERT_FILE) return res.status(413).json({ error: 'Mỗi tệp chứng chỉ tối đa 15 MB' });
    const name = String(req.query.name || 'chung-chi').slice(0, 255);
    const file = await service.addFile(req.personnel, 'CERTIFICATE', name, String(req.headers['content-type'] || 'application/octet-stream').slice(0, 120), req.body, req.user.userId);
    if (file.created) await req.audit('project_personnel_files', file.id, 'CREATE', null, { personnel_id: req.params.id, name, size: req.body.length }, req.user.userId);
    res.status(file.created ? 201 : 200).json(file);
  } catch (error) {
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Mỗi tệp chứng chỉ tối đa 15 MB' });
    sendError(res, error);
  }
});

router.get('/:id/files/:fileId', loadPersonnel, (req, res, next) => {
  req.projectId = req.personnel.project_id;
  next();
}, permissionService.requirePermission('DOWNLOAD'), async (req, res) => {
  try {
    if (!await access.allowed(req.user, req.personnel.project_id)) return res.status(403).json({ error: 'Không có quyền truy cập công trình' });
    const file = await service.getFile(req.params.id, req.params.fileId);
    if (!file) return res.status(404).json({ error: 'Không tìm thấy tệp chứng chỉ' });
    sendStoredFile(res, file, req.query.download);
  } catch (error) { sendError(res, error); }
});

router.delete('/:id/files/:fileId', rbac.checkRole(managers), loadPersonnel, async (req, res) => {
  try {
    const row = await service.removeFile(req.params.id, req.params.fileId);
    await req.audit('project_personnel_files', row.id, 'DELETE', { personnel_id: req.params.id, name: row.file_name }, null, req.user.userId);
    res.json({ ok: true });
  } catch (error) { sendError(res, error); }
});

router.delete('/:id', rbac.checkRole(managers), loadPersonnel, async (req, res) => {
  try {
    const row = await service.remove(req.params.id);
    await req.audit('project_personnel', row.id, 'REMOVE', req.personnel, null, req.user.userId);
    res.json(row);
  } catch (error) { sendError(res, error); }
});

module.exports = router;
