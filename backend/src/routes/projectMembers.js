const express = require('express');
const projectMemberService = require('../services/projectMemberService');
const permissionService = require('../services/permissionService');
const auth = require('../middleware/auth');
const rbac = require('../middleware/rbac');
const access = require('../middleware/projectAccess');

const router = express.Router();
router.use(auth.verifyToken);

const managers = [rbac.ROLES.ADMIN, rbac.ROLES.DIRECTOR];

function sendError(res, err) {
  if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
  if (err.code === '23503') return res.status(404).json({ error: 'Công trình hoặc tài khoản không tồn tại trên máy chủ' });
  console.error('project-members:', err.message);
  return res.status(500).json({ error: 'Không xử lý được phân công' });
}

function validateAccessFields(body) {
  if (body.access_permissions !== undefined && body.access_permissions !== null) {
    if (!Array.isArray(body.access_permissions) || body.access_permissions.some(item => !permissionService.ALL.includes(item))) {
      return 'Quyền truy cập không hợp lệ';
    }
  }
  if (body.work_scope !== undefined && String(body.work_scope).length > 240) return 'Phạm vi làm việc tối đa 240 ký tự';
  if (body.assignment_title && String(body.assignment_title).length > 120) return 'Chức danh tại công trình tối đa 120 ký tự';
  return null;
}

// Quyền hiệu lực của chính người đăng nhập trên từng công trình (frontend dùng để ẩn/hiện nút).
router.get('/my-permissions', async (req, res) => {
  try { res.json(await permissionService.allForUser(req.user.userId)); }
  catch (err) { sendError(res, err); }
});

router.get('/project/:projectId', access.projectParam, async (req, res) => {
  try { res.json(await projectMemberService.getMembersByProject(req.params.projectId)); }
  catch (err) { sendError(res, err); }
});

router.post('/', access.body, rbac.checkRole(managers), async (req, res) => {
  try {
    if (!req.body.user_id) return res.status(400).json({ error: 'Cần chọn tài khoản' });
    const accessError = validateAccessFields(req.body);
    if (accessError) return res.status(400).json({ error: accessError });
    const member = await projectMemberService.addMember({ ...req.body, assigned_by: req.user.userId });
    await req.audit('project_members', member.id, 'ASSIGN', null, member, req.user.userId);
    res.status(201).json(member);
  } catch (err) { sendError(res, err); }
});

router.use('/:id', access.record('project_members'));

router.get('/:id', async (req, res) => {
  try {
    const member = await projectMemberService.getMemberById(req.params.id);
    if (!member) return res.status(404).json({ error: 'Không tìm thấy phân công' });
    res.json(member);
  } catch (err) { sendError(res, err); }
});

router.put('/:id', rbac.checkRole(managers), async (req, res) => {
  try {
    const accessError = validateAccessFields(req.body);
    if (accessError) return res.status(400).json({ error: accessError });
    const before = await projectMemberService.getMemberById(req.params.id);
    const member = await projectMemberService.updateMember(req.params.id, req.body);
    if (!member) return res.status(404).json({ error: 'Không tìm thấy phân công đang hoạt động' });
    await req.audit('project_members', member.id, 'UPDATE_ACCESS', before, member, req.user.userId);
    res.json(member);
  } catch (err) { sendError(res, err); }
});

router.delete('/:id', rbac.checkRole(managers), async (req, res) => {
  try {
    const member = await projectMemberService.removeMember(req.params.id);
    if (!member) return res.status(404).json({ error: 'Không tìm thấy phân công đang hoạt động' });
    await req.audit('project_members', member.id, 'END_ASSIGNMENT', null, member, req.user.userId);
    res.json(member);
  } catch (err) { sendError(res, err); }
});

module.exports = router;
