const pool = require('../utils/db');
const permissionService = require('../services/permissionService');

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const tables = new Set(['daily_logs', 'documents', 'issues', 'project_members']);

async function allowed(user, projectId) {
  // Phân công còn hiệu lực chưa đủ: tùy chỉnh [] cũng phải chặn mọi đường đọc/ghi.
  const p = await permissionService.forUser(user.userId, projectId);
  return p.permissions.includes('VIEW');
}

function check(resolveProjectId) {
  return async (req, res, next) => {
    try {
      const projectId = await resolveProjectId(req);
      if (!projectId) return res.status(400).json({ error: 'Thiếu ID công trình' });
      if (!uuid.test(projectId)) return res.status(400).json({ error: 'ID công trình không hợp lệ' });
      if (!await allowed(req.user, projectId)) {
        return res.status(403).json({ error: 'Không có quyền truy cập công trình' });
      }
      req.projectId = projectId;
      next();
    } catch (error) {
      console.error('Project access check:', error.message);
      res.status(503).json({ error: 'Không kiểm tra được quyền công trình' });
    }
  };
}

const query = check(req => req.query.project_id);
const body = check(req => req.body?.project_id);
const projectParam = check(req => req.params.id || req.params.projectId);

function record(table) {
  if (!tables.has(table)) throw new Error('Unsupported project table');
  return check(async req => {
    if (!uuid.test(req.params.id)) return req.params.id;
    const result = await pool.query(`SELECT project_id FROM ${table} WHERE id = $1`, [req.params.id]);
    if (!result.rows[0]) return null;
    return result.rows[0].project_id;
  });
}

module.exports = { allowed, query, body, projectParam, record };
