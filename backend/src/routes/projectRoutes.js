const { sendEditError } = require('../utils/editConflict');
const express = require('express');
const projectService = require('../services/projectService');
const auth = require('../middleware/auth');
const rbac = require('../middleware/rbac');
const access = require('../middleware/projectAccess');
const projectProgressService = require('../services/projectProgressService');
const { sendStoredFile } = require('../utils/fileSafety');

const router = express.Router();
const creators = [rbac.ROLES.ADMIN, rbac.ROLES.DIRECTOR];
// Sửa công trình/tệp hợp đồng/bảng tiến độ: Admin/Giám đốc, hoặc người có quyền Duyệt TẠI đúng công trình này
// (khớp canEditProject(pid) ở giao diện). Trước đây xét loại tài khoản chung TVGS_LEAD nên: GS viên làm "TVGS trưởng"
// ở công trình khác thấy nút Sửa nhưng bị 403; tài khoản loại TVGS_LEAD chỉ là GS viên tại công trình vẫn sửa được qua API.
const permissionService = require('../services/permissionService');
const canEditHere = permissionService.requirePermission('APPROVE');
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validProject(data) {
  return data &&
    typeof data.name === 'string' && data.name.trim() &&
    typeof data.contract_no === 'string' && data.contract_no.trim() &&
    (data.id === undefined || uuidPattern.test(data.id)) &&
    (data.progress === undefined || (Number.isFinite(Number(data.progress)) && Number(data.progress) >= 0 && Number(data.progress) <= 100)) &&
    (data.contract_duration_days == null || (Number.isInteger(Number(data.contract_duration_days)) && Number(data.contract_duration_days) > 0)) &&
    (data.contractor_duration_days == null || (Number.isInteger(Number(data.contractor_duration_days)) && Number(data.contractor_duration_days) > 0));
}

function sendError(res, error) {
  if (sendEditError(res, error)) return;
  if (error.code === '23505') return res.status(409).json({ error: 'Mã hoặc số hợp đồng đã tồn tại' });
  if (error.code === '22P02') return res.status(400).json({ error: 'ID không hợp lệ' });
  if (error.code === '23514') return res.status(400).json({ error: 'Dữ liệu vi phạm ràng buộc (ngày/tỷ lệ không hợp lệ)' });
  console.error('projects:', error.message);
  return res.status(500).json({ error: 'Không xử lý được yêu cầu công trình' });
}

router.use(auth.verifyToken);

router.get('/', async (req, res) => {
  try {
    res.json(await projectService.getAllProjects(req.user.userId));
  } catch (error) {
    sendError(res, error);
  }
});

router.get('/:id', access.projectParam, async (req, res) => {
  if (!uuidPattern.test(req.params.id)) return res.status(400).json({ error: 'ID không hợp lệ' });
  try {
    const project = await projectService.getProjectById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Không tìm thấy công trình' });
    res.json(project);
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/', rbac.checkRole(creators), async (req, res) => {
  if (!validProject(req.body)) return res.status(400).json({ error: 'Thiếu hoặc sai thông tin công trình' });
  try {
    const { project, created } = await projectService.createProject({ ...req.body, created_by: req.user.userId });
    if (!created && !await access.allowed(req.user, project.id)) {
      return res.status(403).json({ error: 'Không có quyền truy cập công trình' });
    }
    if (created) await req.audit('projects', project.id, 'CREATE', null, project, req.user.userId);
    res.status(created ? 201 : 200).json(project);
  } catch (error) {
    sendError(res, error);
  }
});

router.patch('/:id', access.projectParam, canEditHere, async (req, res) => {
  if (!uuidPattern.test(req.params.id) || !validProject(req.body)) {
    return res.status(400).json({ error: 'Thiếu hoặc sai thông tin công trình' });
  }
  try {
    const before = await projectService.getProjectById(req.params.id);
    if (!before) return res.status(404).json({ error: 'Không tìm thấy công trình' });
    const project = await projectService.updateProject(req.params.id, req.body);
    await req.audit('projects', project.id, 'UPDATE', before, project, req.user.userId);
    res.json(project);
  } catch (error) {
    sendError(res, error);
  }
});

const MAX_PROJECT_FILE = 25 * 1024 * 1024;
router.post('/:id/files', access.projectParam, canEditHere, express.raw({ type: () => true, limit: MAX_PROJECT_FILE + 1024 }), async (req, res) => {
  try {
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Tệp rỗng' });
    if (req.body.length > MAX_PROJECT_FILE) return res.status(413).json({ error: 'Mỗi tệp công trình tối đa 25 MB' });
    const category = String(req.query.category || 'PROJECT_DOCUMENT').slice(0, 80);
    const name = String(req.query.name || 'tai-lieu').slice(0, 255);
    const file = await projectService.addFile(req.params.id, category, name, String(req.headers['content-type'] || 'application/octet-stream').slice(0, 120), req.body, req.user.userId);
    if (file.created) await req.audit('project_files', file.id, 'CREATE', null, { project_id: req.params.id, category, name, size: req.body.length }, req.user.userId);
    res.status(file.created ? 201 : 200).json(file);
  } catch (error) {
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Mỗi tệp công trình tối đa 25 MB' });
    sendError(res, error);
  }
});

router.get('/:id/files/:fileId', access.projectParam, async (req, res) => {
  try {
    const file = await projectService.getFile(req.params.id, req.params.fileId);
    if (!file) return res.status(404).json({ error: 'Không tìm thấy tệp' });
    sendStoredFile(res, file, req.query.download);
  } catch (error) { sendError(res, error); }
});


// ---------------------------------------------------------------------------
// BẢNG TIẾN ĐỘ
// ---------------------------------------------------------------------------
const scheduleParser = require('../services/scheduleParser');
const { readXlsx } = require('../services/xlsxReader');
const dateText = /^\d{4}-\d{2}-\d{2}$/;

function validItems(items) {
  if (items === undefined) return null;
  if (!Array.isArray(items)) return 'Danh sách hạng mục không hợp lệ';
  if (items.length > 2000) return 'Tối đa 2.000 hạng mục';
  for (const [i, it] of items.entries()) {
    const n = i + 1;
    if (!it || !String(it.name || '').trim()) return `Hạng mục ${n}: thiếu tên`;
    if (!dateText.test(it.start_date || '') || !dateText.test(it.end_date || '')) return `Hạng mục ${n} "${it.name}": ngày không hợp lệ`;
    if (it.end_date < it.start_date) return `Hạng mục ${n} "${it.name}": ngày kết thúc trước ngày bắt đầu`;
    if (it.weight !== null && it.weight !== undefined && !(Number(it.weight) >= 0)) return `Hạng mục ${n} "${it.name}": giá trị/tỷ trọng không hợp lệ`;
  }
  return null;
}
function validPlan(data, creating) {
  const pct = v => v === undefined || (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 100);
  if (creating && !String(data.plan_name || '').trim()) return 'Nhập tên bảng tiến độ';
  if (data.report_date !== undefined && !dateText.test(data.report_date)) return 'Ngày lập bảng không hợp lệ';
  if (!pct(data.planned_percent) || !pct(data.actual_percent)) return 'Tỷ lệ phải trong khoảng 0–100%';
  if (data.attachment?.data && String(data.attachment.data).length > 14 * 1024 * 1024) return 'Tệp tiến độ quá lớn; giới hạn 10 MB';
  return validItems(data.items);
}

router.get('/:id/progress-plans', access.projectParam, async (req, res) => {
  try { res.json(await projectProgressService.list(req.params.id)); }
  catch (error) { sendError(res, error); }
});

// Đọc bảng tiến độ từ Excel (.xlsx) hoặc văn bản dán từ Excel — trả bản xem trước, CHƯA lưu
router.post('/:id/progress-plans/parse', access.projectParam, async (req, res) => {
  try {
    const { file, text, sheet } = req.body || {};
    let parsed, sheets = [];
    if (file?.data) {
      const m = String(file.data).match(/^data:[^,]*;base64,(.*)$/s);
      const buffer = Buffer.from(m ? m[1] : file.data, 'base64');
      if (buffer.length > 10 * 1024 * 1024) return res.status(400).json({ error: 'Tệp Excel tối đa 10 MB' });
      if (!/\.xlsx$/i.test(file.name || '')) return res.status(400).json({ error: 'Chỉ đọc được tệp .xlsx. Tệp .xls cũ hãy mở bằng Excel và Lưu thành .xlsx; PDF/ảnh chỉ lưu làm bản gốc.' });
      const book = readXlsx(buffer, sheet);
      sheets = book.sheets;
      parsed = scheduleParser.parseRows(book.rows);
    } else if (typeof text === 'string' && text.trim()) {
      parsed = scheduleParser.parseText(text);
    } else {
      return res.status(400).json({ error: 'Chọn tệp .xlsx hoặc dán bảng từ Excel' });
    }
    res.json({ ...parsed, sheets });
  } catch (error) {
    res.status(400).json({ error: 'Không đọc được bảng tiến độ: ' + error.message });
  }
});

router.get('/:id/progress-plans/:planId', access.projectParam, async (req, res) => {
  try {
    if (req.query.as_of && !dateText.test(req.query.as_of)) return res.status(400).json({ error: 'Ngày so sánh không hợp lệ' });
    const d = await projectProgressService.detail(req.params.id, req.params.planId, req.query.as_of);
    if (!d) return res.status(404).json({ error: 'Không tìm thấy bảng tiến độ' });
    res.json(d);
  } catch (error) { sendError(res, error); }
});

// Tệp gốc: trả nội dung nhị phân để trình duyệt mở/tải (không dùng data: URL — Chrome chặn mở tab mới)
router.get('/:id/progress-plans/:planId/file', access.projectParam, async (req, res) => {
  try {
    const f = await projectProgressService.getFile(req.params.id, req.params.planId);
    if (!f) return res.status(404).json({ error: 'Bảng tiến độ chưa có tệp đính kèm' });
    sendStoredFile(res, f, req.query.download);
  } catch (error) { sendError(res, error); }
});

router.post('/:id/progress-plans', access.projectParam, canEditHere, async (req, res) => {
  const data = req.body || {};
  const err = validPlan(data, true);
  if (err) return res.status(400).json({ error: err });
  try {
    const result = await projectProgressService.create(req.params.id, data, req.user.userId);
    await req.audit('project_progress_plans', result.plan.id, 'CREATE', null, { ...result.plan, item_count: data.items?.length || 0 }, req.user.userId);
    res.status(201).json(result);
  } catch (error) { sendError(res, error); }
});

router.patch('/:id/progress-plans/:planId', access.projectParam, canEditHere, async (req, res) => {
  const data = req.body || {};
  const err = validPlan(data, false);
  if (err) return res.status(400).json({ error: err });
  try {
    const before = await projectProgressService.getPlan(req.params.id, req.params.planId);
    const result = await projectProgressService.update(req.params.id, req.params.planId, data, req.user.userId);
    if (!result) return res.status(404).json({ error: 'Không tìm thấy bảng tiến độ' });
    await req.audit('project_progress_plans', req.params.planId, 'UPDATE', before, { ...result.plan, item_count: data.items?.length }, req.user.userId);
    res.json(result);
  } catch (error) { sendError(res, error); }
});

// Xóa bảng tiến độ: quyền "Xóa" tại công trình, bắt buộc lý do → Thùng rác (kèm hạng mục và số liệu thực tế)
router.delete('/:id/progress-plans/:planId', access.projectParam, permissionService.requirePermission('DELETE'), async (req, res) => {
  try {
    const before = await projectProgressService.getPlan(req.params.id, req.params.planId);
    if (!before) return res.status(404).json({ error: 'Không tìm thấy bảng tiến độ' });
    const reason = String(req.body?.reason || '').trim();
    if (reason.length < 3) return res.status(400).json({ error: 'Nhập lý do xóa' });
    const { recycleId } = await require('../services/recycleService').archive('project_progress_plans', req.params.planId, reason.slice(0, 4000), req.user.userId);
    await projectProgressService.syncProjectSafe(req.params.id);
    await req.audit('project_progress_plans', req.params.planId, 'DELETE', { plan_name: before.plan_name }, { recycle_id: recycleId, reason }, req.user.userId);
    res.json({ ok: true, recycle_id: recycleId });
  } catch (error) { if (error.status) return res.status(error.status).json({ error: error.message }); sendError(res, error); }
});

// Cập nhật % thực tế theo hạng mục tại một ngày báo cáo (người có quyền "Thêm" tại công trình)
router.post('/:id/progress-plans/:planId/actuals', access.projectParam, permissionService.requirePermission('CREATE'), async (req, res) => {
  const { report_date, rows } = req.body || {};
  if (!dateText.test(report_date || '')) return res.status(400).json({ error: 'Ngày báo cáo không hợp lệ' });
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'Chưa nhập số liệu thực tế' });
  if (rows.some(r => !(Number(r.actual_percent) >= 0 && Number(r.actual_percent) <= 100))) return res.status(400).json({ error: 'Tỷ lệ thực tế phải trong khoảng 0–100%' });
  try {
    const result = await projectProgressService.saveActuals(req.params.id, req.params.planId, report_date, rows, req.user.userId);
    if (!result) return res.status(404).json({ error: 'Không tìm thấy bảng tiến độ' });
    await req.audit('project_progress_plans', req.params.planId, 'UPDATE_ACTUALS', null, { report_date, rows: rows.length, actual_percent: result.detail.summary.actual_percent }, req.user.userId);
    res.json(result);
  } catch (error) { sendError(res, error); }
});

module.exports = router;
